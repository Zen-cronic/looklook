import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realToday } from "./dates";
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
async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
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

export function loadSession(id: string): SessionState {
  const existing = readJson<SessionState>(sessionFile(id));
  if (existing && existing.version === 1) return existing;
  return seedState(id, realToday());
}

/** Read-modify-write one session. The updater may be async (PayPal calls happen outside it). */
export async function updateSession<T>(id: string, fn: (s: SessionState) => T | Promise<T>): Promise<T> {
  return withLock(`session:${id}`, async () => {
    const state = loadSession(id);
    const result = await fn(state);
    writeJson(sessionFile(id), state);
    return result;
  });
}

export async function resetSession(id: string): Promise<SessionState> {
  return withLock(`session:${id}`, () => {
    const fresh = seedState(id, realToday());
    writeJson(sessionFile(id), fresh);
    return fresh;
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

/** True when an event id from this source was already handled (redelivery). */
export function eventSeen(source: EventLogEntry["source"], eventId: string): boolean {
  const all = readJson<{ events: EventLogEntry[] }>(eventsFile())?.events ?? [];
  return all.some((e) => e.source === source && e.eventId === eventId && !e.duplicate && (e.verification === "verified" || e.verification === "simulated"));
}

/**
 * Record a delivery. For a verified or simulated event, the duplicate check
 * and the append happen under one lock, so two copies arriving together are
 * handled once. Returns the stored entry (duplicate set when already seen).
 */
export async function appendEvent(entry: Omit<EventLogEntry, "id" | "receivedAt" | "duplicate">): Promise<EventLogEntry> {
  return withLock("events", () => {
    const file = eventsFile();
    const store = readJson<{ events: EventLogEntry[] }>(file) ?? { events: [] };
    const countable = entry.verification === "verified" || entry.verification === "simulated";
    const duplicate =
      countable && !!entry.eventId && store.events.some((e) => e.source === entry.source && e.eventId === entry.eventId && !e.duplicate && (e.verification === "verified" || e.verification === "simulated"));
    const stored: EventLogEntry = { ...entry, id: crypto.randomUUID(), receivedAt: new Date().toISOString(), duplicate };
    store.events.push(stored);
    if (store.events.length > EVENT_LIMIT) store.events = store.events.slice(-EVENT_LIMIT);
    writeJson(file, store);
    return stored;
  });
}

/** Fill in what a handled event did, after the session update. */
export async function setEventEffect(id: string, effect: string): Promise<void> {
  await withLock("events", () => {
    const file = eventsFile();
    const store = readJson<{ events: EventLogEntry[] }>(file);
    const e = store?.events.find((x) => x.id === id);
    if (!store || !e) return;
    e.effect = effect;
    writeJson(file, store);
  });
}

// Cache for model and catalogue work on the same image or link

const cacheFile = (kind: string, key: string) => join(dataDir(), "cache", kind, `${key.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);

export function cacheGet<T>(kind: string, key: string): T | undefined {
  return readJson<T>(cacheFile(kind, key));
}

export function cacheSet(kind: string, key: string, value: unknown): void {
  writeJson(cacheFile(kind, key), value);
}
