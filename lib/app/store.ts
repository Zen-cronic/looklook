import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appToday, realToday } from "./dates";
import { reasonKey, refreshChecks } from "./refresh";
import { sampleWeekState } from "./sample-week";
import { seedState } from "./seed";
import type { EventLogEntry, SessionState } from "./types";

/**
 * App data on disk: one JSON file per shopper session, plus a shared event
 * log and an index that routes webhooks (orders, captures, payment tokens,
 * price subscriptions) back to the session they belong to. Writes are atomic
 * (temp file + rename) and serialised per file inside this process.
 */

export function dataDir(): string {
  return process.env.APP_DATA_DIR || join(process.cwd(), ".data");
}

const SESSION_ID = /^[a-zA-Z0-9_-]{8,64}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

function sessionFile(id: string): string {
  if (!isSessionId(id)) throw new Error("bad session id");
  return join(dataDir(), "sessions", `${id}.json`);
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

const locks = new Map<string, Promise<unknown>>();

/** Run fn with exclusive access to one file key. */
export async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Model-written reasons already cached for a decision, so a refreshed verdict keeps its wording. */
function cachedReason(check: { facts: { brand: string; name: string } }, decision: Parameters<typeof reasonKey>[0]) {
  return cacheGet<{ text: string; source: "model" | "template" }>("reason", reasonKey(decision, check.facts));
}

/**
 * One shopper's state, with every open verdict decided again against the
 * current shelf, budgets and date (in memory; writes persist it).
 */
export function loadSession(id: string): SessionState {
  const existing = readJson<SessionState>(sessionFile(id));
  const state = existing && existing.version === 1 ? existing : seedState(id, realToday());
  refreshChecks(state, appToday(state.dayOffset), cachedReason);
  return state;
}

/** Read-modify-write one session. The updater may be async (PayPal calls happen outside it). */
export async function updateSession<T>(id: string, fn: (s: SessionState) => T | Promise<T>): Promise<T> {
  return withLock(`session:${id}`, async () => {
    const state = loadSession(id);
    const result = await fn(state);
    refreshChecks(state, appToday(state.dayOffset), cachedReason);
    writeJson(sessionFile(id), state);
    return result;
  });
}

/** A fresh sample-shelf session; `keepMethods` carries over saved methods whose PayPal delete isn't confirmed. */
export async function resetSession(id: string, keepMethods: SessionState["methods"] = []): Promise<SessionState> {
  return withLock(`session:${id}`, () => {
    const fresh = seedState(id, realToday());
    fresh.methods = keepMethods;
    writeJson(sessionFile(id), fresh);
    return fresh;
  });
}

/** Replace this browser's state with the sample week, keeping its saved payment methods. */
export async function loadSampleWeek(id: string): Promise<SessionState> {
  return withLock(`session:${id}`, () => {
    const previous = readJson<SessionState>(sessionFile(id));
    const state = sampleWeekState(id, realToday(), previous?.version === 1 ? previous : undefined);
    refreshChecks(state, appToday(state.dayOffset), cachedReason);
    writeJson(sessionFile(id), state);
    return state;
  });
}

// Shared index: provider ids -> session id

export type IndexKind = "order" | "capture" | "token" | "subscription";

interface IndexFile {
  entries: Record<string, string[]>;
}

const indexFile = () => join(dataDir(), "index.json");

export async function indexAdd(kind: IndexKind, providerId: string, sessionId: string): Promise<void> {
  await withLock("index", () => {
    const idx = readJson<IndexFile>(indexFile()) ?? { entries: {} };
    const key = `${kind}:${providerId}`;
    const list = idx.entries[key] ?? [];
    if (!list.includes(sessionId)) list.push(sessionId);
    idx.entries[key] = list;
    writeJson(indexFile(), idx);
  });
}

export function indexLookup(kind: IndexKind, providerId: string): string[] {
  const idx = readJson<IndexFile>(indexFile());
  return idx?.entries[`${kind}:${providerId}`] ?? [];
}

// Shared webhook event log

const EVENT_LIMIT = 300;
const eventsFile = () => join(dataDir(), "events.json");

export function listEvents(limit = 100): EventLogEntry[] {
  const all = readJson<{ events: EventLogEntry[] }>(eventsFile())?.events ?? [];
  return all.slice(-limit).reverse();
}

/** An entry still being applied this long after it arrived is treated as abandoned. */
const PROCESSING_TIMEOUT_MS = 60_000;

/** The handled (or still being applied) original of this event, if one exists. */
function originalOf(events: EventLogEntry[], source: EventLogEntry["source"], eventId: string, now = Date.now()): EventLogEntry | undefined {
  return events.find(
    (e) =>
      e.source === source &&
      e.eventId === eventId &&
      !e.duplicate &&
      (e.verification === "verified" || e.verification === "simulated") &&
      // Entries written before states existed count as handled.
      (e.state === "handled" || (e.state === undefined && e.effect !== undefined) || (e.state === "processing" && now - Date.parse(e.receivedAt) < PROCESSING_TIMEOUT_MS)),
  );
}

/** True when an event id from this source was already handled (redelivery). */
export function eventSeen(source: EventLogEntry["source"], eventId: string): boolean {
  const all = readJson<{ events: EventLogEntry[] }>(eventsFile())?.events ?? [];
  return originalOf(all, source, eventId) !== undefined;
}

/**
 * Record a delivery. For a verified or simulated event, the duplicate check
 * and the append happen under one lock, so two copies arriving together are
 * handled once. A new event starts as "processing"; it only counts as handled
 * once markEvent records its effect, so a delivery whose effect failed is
 * applied again when the sender retries.
 */
export async function appendEvent(entry: Omit<EventLogEntry, "id" | "receivedAt" | "duplicate" | "state">): Promise<EventLogEntry & { inProgress?: boolean }> {
  return withLock("events", () => {
    const file = eventsFile();
    const store = readJson<{ events: EventLogEntry[] }>(file) ?? { events: [] };
    const countable = entry.verification === "verified" || entry.verification === "simulated";
    const original = countable && entry.eventId ? originalOf(store.events, entry.source, entry.eventId) : undefined;
    const duplicate = original !== undefined;
    const stored: EventLogEntry = { ...entry, id: crypto.randomUUID(), receivedAt: new Date().toISOString(), duplicate, ...(countable && !duplicate ? { state: "processing" as const } : {}) };
    store.events.push(stored);
    if (store.events.length > EVENT_LIMIT) store.events = store.events.slice(-EVENT_LIMIT);
    writeJson(file, store);
    return { ...stored, inProgress: original?.state === "processing" };
  });
}

/** Record what a handled event did (or why applying it failed). */
export async function markEvent(id: string, outcome: { state: "handled"; effect: string } | { state: "failed"; reason: string }): Promise<void> {
  await withLock("events", () => {
    const file = eventsFile();
    const store = readJson<{ events: EventLogEntry[] }>(file);
    const e = store?.events.find((x) => x.id === id);
    if (!store || !e) return;
    e.state = outcome.state;
    if (outcome.state === "handled") e.effect = outcome.effect;
    else e.failureReason = outcome.reason;
    writeJson(file, store);
  });
}

/** Fill in what a handled event did, after the session update. */
export async function setEventEffect(id: string, effect: string): Promise<void> {
  await markEvent(id, { state: "handled", effect });
}

/**
 * Log a verified delivery and apply it once. Returns "failed" when applying
 * threw (answer non-2xx so the sender retries), "in-progress" when another
 * copy is being applied right now (also non-2xx: retry later), "duplicate"
 * when it was already applied.
 */
export async function handleEvent(
  entry: Omit<EventLogEntry, "id" | "receivedAt" | "duplicate" | "state">,
  apply: () => Promise<string>,
): Promise<{ outcome: "handled" | "duplicate" | "in-progress" | "failed"; effect?: string }> {
  const logged = await appendEvent(entry);
  if (logged.duplicate) return { outcome: logged.inProgress ? "in-progress" : "duplicate" };
  try {
    const effect = await apply();
    await markEvent(logged.id, { state: "handled", effect });
    return { outcome: "handled", effect };
  } catch (e) {
    console.error(`event ${entry.eventId ?? "?"} failed:`, e instanceof Error ? e.message : e);
    await markEvent(logged.id, { state: "failed", reason: "applying it failed; waiting for a redelivery" }).catch(() => undefined);
    return { outcome: "failed" };
  }
}

// Cache for model and catalogue work on the same image or link

const cacheFile = (kind: string, key: string) => join(dataDir(), "cache", kind, `${key.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);

export function cacheGet<T>(kind: string, key: string): T | undefined {
  return readJson<T>(cacheFile(kind, key));
}

export function cacheSet(kind: string, key: string, value: unknown): void {
  writeJson(cacheFile(kind, key), value);
}
