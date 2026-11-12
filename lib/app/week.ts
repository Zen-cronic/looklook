/**
 * "Hand it your week": several posts in, each decided by the same engine,
 * then one slip that lists every payment the week needs (the buys and the
 * staples coming due), one yes, and each line paid on the saved method.
 *
 * The slip never merges charges: each line keeps its own approval key and
 * PayPal-Request-Id (lib/app/pay.ts), so a line paid once is never paid
 * again, a failed line doesn't stop the others, and a price that moved
 * after the slip was shown stops the whole yes before anything is charged.
 */
import { createHash } from "node:crypto";
import type { PayPalClient } from "../paypal/client";
import { budgetGroupOf, type BudgetGroup } from "../shelf/categories";
import { remainingBudgets } from "./budgets";
import { appToday } from "./dates";
import { HttpError } from "./http";
import { payWithSavedMethod } from "./pay";
import { activeMethod, approvalKey, approvalVersion, boughtFor, dueStaples, openDecline } from "./payments";
import { waitAction } from "./reminders";
import { guardView, type GuardView } from "./guard";
import { singleFlight } from "./single-flight";
import { loadSession, updateSession } from "./store";
import type { CheckRecord, SessionState, SlipLine, WeekInput, WeekLineOutcome, WeekLineStatus, WeekRun } from "./types";
import { targetFor } from "./watch";

/** The one-line promise, on the landing page and the week page. */
export const WEEK_TAGLINE = "Stop buying what you already own. Pay for the rest with one PayPal yes.";

/** The sample week's posts, in the order a shopper would have seen them. */
export const SAMPLE_WEEK_POSTS = ["week-spf", "week-vitc", "week-retinol", "week-peptide"];

/** At most this many posts in one week. */
export const WEEK_MAX_POSTS = 6;
const KEEP_RUNS = 5;

const cents = (dollars: number) => Math.round(dollars * 100);

// Grouping

function inputFor(c: CheckRecord, today: string): WeekInput {
  const d = c.decision;
  const base = {
    checkId: c.id,
    rule: d.rule,
    title: `${c.facts.brand} ${c.facts.name}`.trim(),
    brand: c.facts.brand,
    category: c.facts.category,
    imageUrl: c.product?.imageUrl,
    productId: c.product?.id,
    reason: c.reason.text,
    ...(c.facts.priceShown !== null ? { priceCents: cents(c.facts.priceShown) } : {}),
  };
  if (d.verdict === "skip") return { ...base, group: "skip", ...(c.facts.priceShown !== null ? { keptCents: cents(c.facts.priceShown) } : {}) };
  if (d.verdict === "buy") return { ...base, group: "buy" };
  if (d.verdict === "wait") {
    const a = waitAction(c, today);
    return {
      ...base,
      group: "wait",
      waitKind: a?.kind,
      ...(a && "on" in a ? { waitUntil: a.on } : {}),
      ...(a?.kind === "price" && c.product ? { targetPrice: targetFor(c) } : {}),
    };
  }
  return { ...base, group: "ask" };
}

/** The posts as they were decided when the week was handed over (later re-decisions don't move them). */
export function groupWeek(state: SessionState, checkIds: string[], today: string): WeekInput[] {
  return checkIds.map((id) => {
    const c = state.checks.find((x) => x.id === id);
    if (!c) throw new HttpError(404, "One of these checks is gone.");
    return inputFor(c, today);
  });
}

export function newWeekRun(state: SessionState, checkIds: string[], from: WeekRun["from"], now = new Date()): WeekRun {
  if (checkIds.length === 0) throw new HttpError(400, "Add at least one post.");
  if (checkIds.length > WEEK_MAX_POSTS) throw new HttpError(400, `At most ${WEEK_MAX_POSTS} posts in one week.`);
  const today = appToday(state.dayOffset);
  return {
    id: `wk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    createdAt: now.toISOString(),
    on: today,
    from,
    inputs: groupWeek(state, checkIds, today),
    sent: [],
    outcomes: {},
    watches: [],
  };
}

/** Keep a run in the session (the last few only). */
export function saveRun(state: SessionState, run: WeekRun): void {
  const runs = (state.weeks ??= []).filter((r) => r.id !== run.id);
  runs.push(run);
  state.weeks = runs.slice(-KEEP_RUNS);
}

export function findRun(state: SessionState, runId: string): WeekRun {
  const run = state.weeks?.find((r) => r.id === runId);
  if (!run) throw new HttpError(404, "That week is gone. Hand it over again.");
  return run;
}

// The slip

export interface LeftOffLine extends SlipLine {
  leftOff: "over-cap" | "over-budget" | "for-later";
  note: string;
}

export interface WeekSlip {
  lines: SlipLine[];
  leftOff: LeftOffLine[];
  /** Price waits that start being watched with the yes. */
  watches: Array<{ checkId: string; title: string; brand: string; category?: SlipLine["category"]; productId?: string; targetPrice: number }>;
  totalCents: number;
  methodId?: string;
  methodLabel?: string;
  capCents?: number;
  hash: string;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * What one yes would pay right now: the week's buys not yet paid, then every
 * staple coming due, each at the price its own card would show. A line that
 * the saved method's cap or what's left of its budget can't cover is left
 * off with the reason, never charged.
 */
export function buildSlip(state: SessionState, run: WeekRun, today: string): WeekSlip {
  const candidates: SlipLine[] = [];
  for (const input of run.inputs) {
    if (input.group !== "buy") continue;
    const c = state.checks.find((x) => x.id === input.checkId);
    if (!c || c.facts.priceShown === null) continue;
    const source = { kind: "check" as const, checkId: c.id };
    const key = approvalKey(state, source);
    if (boughtFor(state, key)) continue;
    candidates.push({
      source,
      approvalKey: key,
      amountCents: cents(c.facts.priceShown),
      version: approvalVersion(state, source),
      why: "buy",
      title: input.title,
      brand: input.brand,
      category: input.category,
      imageUrl: input.imageUrl,
      productId: input.productId,
    });
  }
  for (const d of dueStaples(state, today)) {
    const source = { kind: "staple" as const, shelfItemId: d.item.id, cycle: d.cycle };
    const key = approvalKey(state, source);
    if (boughtFor(state, key)) continue;
    candidates.push({
      source,
      approvalKey: key,
      amountCents: d.amountCents,
      version: approvalVersion(state, source),
      why: "due",
      daysLeft: d.daysLeft,
      title: `${d.item.brand} ${d.item.name}`.trim(),
      brand: d.item.brand,
      category: d.item.category,
      productId: d.item.productId,
    });
  }

  const method = activeMethod(state);
  const left: Partial<Record<BudgetGroup, number>> = { ...remainingBudgets(state.budgets, today) };
  const lines: SlipLine[] = [];
  const leftOff: LeftOffLine[] = [];
  const later = new Set(run.leftForLater ?? []);
  for (const line of candidates) {
    if (later.has(line.approvalKey)) {
      leftOff.push({ ...line, leftOff: "for-later", note: "Left for later. It isn't charged now." });
      continue;
    }
    if (method && line.amountCents > method.capCents) {
      leftOff.push({ ...line, leftOff: "over-cap", note: `${money(line.amountCents)} is above your ${money(method.capCents)} cap per payment.` });
      continue;
    }
    const group = line.category ? budgetGroupOf(line.category) : undefined;
    const remaining = group ? left[group] : undefined;
    if (group && remaining !== undefined) {
      if (line.amountCents > cents(remaining)) {
        leftOff.push({ ...line, leftOff: "over-budget", note: `Only ${money(cents(remaining))} left in this month's ${group} budget.` });
        continue;
      }
      left[group] = (cents(remaining) - line.amountCents) / 100;
    }
    lines.push(line);
  }

  const watches = run.inputs
    .filter((i) => i.group === "wait" && i.waitKind === "price" && i.targetPrice !== undefined && !run.watches.some((w) => w.checkId === i.checkId))
    .map((i) => ({ checkId: i.checkId, title: i.title, brand: i.brand, category: i.category, productId: i.productId, targetPrice: i.targetPrice! }));

  const totalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const hash = createHash("sha256")
    .update(JSON.stringify([method?.id ?? null, method?.capCents ?? null, lines.map((l) => [l.approvalKey, l.amountCents, l.version]), watches.map((w) => w.checkId)]))
    .digest("hex")
    .slice(0, 16);
  return { lines, leftOff, watches, totalCents, methodId: method?.id, methodLabel: method?.label, capCents: method?.capCents, hash };
}

// Where each line stands

export interface SentLineView extends SlipLine {
  status: WeekLineStatus;
  receiptId?: string;
  orderId?: string;
  captureId?: string;
  message?: string;
}

/** A line's status from the records themselves: a receipt, then an open decline, then what the yes saw. */
export function lineStatus(state: SessionState, run: WeekRun, line: SlipLine): Pick<SentLineView, "status" | "receiptId" | "orderId" | "captureId" | "message"> {
  const paid = boughtFor(state, line.approvalKey);
  if (paid) return { status: "paid", receiptId: paid.id, orderId: paid.orderId, captureId: paid.captureId };
  const o = run.outcomes[line.approvalKey];
  if (o && o.status !== "paid") return { status: o.status, message: o.message };
  if (openDecline(state, line.source)) return { status: "declined" };
  return { status: "queued" };
}

export function weekView(state: SessionState, run: WeekRun) {
  const today = appToday(state.dayOffset);
  const slip = buildSlip(state, run, today);
  // Lines a yes was given for, each with where it stands; a declined one can also be back on the slip for a new yes.
  const sent: SentLineView[] = run.sent.map((l) => ({ ...l, ...lineStatus(state, run, l) }));
  return {
    run: { id: run.id, on: run.on, from: run.from, createdAt: run.createdAt, approvedAt: run.approvedAt, inputs: run.inputs, watches: run.watches },
    sent,
    slip,
    paying: Boolean(run.approvedAt && sent.some((l) => l.status === "queued")),
    keptCents: run.inputs.reduce((sum, i) => sum + (i.keptCents ?? 0), 0),
    budgetsLeft: remainingBudgets(state.budgets, today),
    // After the yes: the price guard on each line that was paid.
    guards: sent.flatMap((l): GuardView[] => {
      const r = l.receiptId ? state.receipts.find((x) => x.id === l.receiptId) : undefined;
      const g = r ? guardView(r) : undefined;
      return g ? [g] : [];
    }),
    sample: Boolean(state.sample),
    today,
  };
}

// The yes

/** How a refused or failed charge shows on its line. */
export function lineOutcome(e: unknown, now = new Date()): WeekLineOutcome {
  const at = now.toISOString();
  if (e instanceof HttpError) {
    const x = e.extra;
    if (e.status === 402) return { status: "declined", message: e.message, at };
    if (x.alreadyBought) return { status: "paid", receiptId: typeof x.receiptId === "string" ? x.receiptId : undefined, message: e.message, at };
    if (x.overCap) return { status: "over-cap", message: e.message, at };
    if (x.priceChanged) return { status: "price-changed", message: e.message, at };
    if (x.overBudget) return { status: "over-budget", message: e.message, at };
    if (x.needsCheckout) return { status: "needs-checkout", message: e.message, at };
    if (x.stale || e.status === 409 || e.status === 400) return { status: "stale", message: e.message, at };
  }
  // A network error after PayPal took the order: the same yes again resends the same request id.
  return { status: "unconfirmed", message: "PayPal didn't answer in time. Saying yes again sends the same request, so it can't charge twice.", at };
}

export interface ApproveDeps {
  client: () => PayPalClient;
  startWatch: (sid: string, checkId: string) => Promise<{ watchId: string; subscription: { status: string } }>;
  /** After the lines are paid: price guards on what was bought (never fails or holds up the yes for long). */
  startGuards?: (sid: string, receiptIds: string[]) => Promise<void>;
}

/**
 * The week's yes, for the slip with this hash. Nothing is charged when the
 * slip changed since it was shown (a price moved, a line was paid, the method
 * changed): the new slip comes back instead. Watches start first, then each
 * line is paid in turn on the method printed on the slip.
 */
export function approveWeek(sid: string, runId: string, hash: string, deps: ApproveDeps) {
  return singleFlight(`week:${sid}:${runId}`, async () => {
    const state = loadSession(sid);
    const run = findRun(state, runId);
    const today = appToday(state.dayOffset);
    const slip = buildSlip(state, run, today);
    if (slip.hash !== hash) throw new HttpError(409, "Something in this week's order changed since you saw it. Nothing was charged. Check it again.", { slipChanged: true });
    if (slip.lines.length === 0 && slip.watches.length === 0) throw new HttpError(409, "Nothing in this week's order is left to pay.", { slipChanged: true });
    if (slip.lines.length > 0 && !slip.methodId) throw new HttpError(409, "No saved payment method yet. Pay the first item with PayPal and tick save.", { needsCheckout: true });

    await updateSession(sid, (s) => {
      const r = findRun(s, runId);
      r.approvedAt = new Date().toISOString();
      for (const line of slip.lines) {
        r.sent = r.sent.filter((l) => l.approvalKey !== line.approvalKey);
        r.sent.push(line);
        delete r.outcomes[line.approvalKey];
      }
    });

    // Watches first: once a buy is paid, a price wait can turn into a budget wait.
    await armWeekWatches(sid, runId, deps.startWatch, slip.watches);

    for (let i = 0; i < slip.lines.length; i++) {
      const line = slip.lines[i];
      let outcome: WeekLineOutcome;
      try {
        const paid = await payWithSavedMethod(sid, { source: line.source, methodId: slip.methodId, approved: { amountCents: line.amountCents, version: line.version } }, { client: deps.client });
        outcome = { status: "paid", receiptId: paid.receiptId, at: new Date().toISOString() };
      } catch (e) {
        outcome = lineOutcome(e);
      }
      await updateSession(sid, (s) => {
        findRun(s, runId).outcomes[line.approvalKey] = outcome;
      });
      if (outcome.status === "needs-checkout") {
        // The method went away: the rest wait for a new yes.
        const rest = slip.lines.slice(i + 1);
        await updateSession(sid, (s) => {
          const r = findRun(s, runId);
          for (const l of rest) r.outcomes[l.approvalKey] = { ...outcome };
        });
        break;
      }
    }
    const paidIds = Object.values(findRun(loadSession(sid), runId).outcomes).flatMap((o) => (o.status === "paid" && o.receiptId ? [o.receiptId] : []));
    if (deps.startGuards && paidIds.length) await deps.startGuards(sid, paidIds).catch(() => undefined);
    return weekView(loadSession(sid), findRun(loadSession(sid), runId));
  });
}

/**
 * Start the week's price watches (each tried once). Runs with the yes, before
 * any payment: the slip's own yes, or the week's first payment at checkout.
 */
export async function armWeekWatches(sid: string, runId: string, startWatch: ApproveDeps["startWatch"], watches?: WeekSlip["watches"]): Promise<void> {
  const list = watches ?? (() => {
    const s = loadSession(sid);
    return buildSlip(s, findRun(s, runId), appToday(s.dayOffset)).watches;
  })();
  for (const w of list) {
    let entry: WeekRun["watches"][number];
    try {
      const res = await startWatch(sid, w.checkId);
      entry = res.subscription.status === "active" ? { checkId: w.checkId, watchId: res.watchId, status: "armed" } : { checkId: w.checkId, watchId: res.watchId, status: "unavailable", message: "The price feed didn't accept this product." };
    } catch (e) {
      entry = { checkId: w.checkId, status: "unavailable", message: e instanceof Error ? e.message : "Couldn't start watching the price." };
    }
    await updateSession(sid, (s) => {
      const r = findRun(s, runId);
      r.watches = r.watches.filter((x) => x.checkId !== w.checkId);
      r.watches.push(entry);
    });
  }
}

/**
 * Take a line off this week's slip, or put it back. Only a line the slip
 * itself lists (to pay, or already left for later) can be named, so this can
 * shrink the slip or restore it but never add anything to it. It never pays:
 * the slip's hash changes, so a yes given for the old slip charges nothing.
 */
export async function setLeftForLater(sid: string, runId: string, approvalKey: string, action: "leave" | "back"): Promise<WeekView> {
  return updateSession(sid, (s) => {
    const run = findRun(s, runId);
    const slip = buildSlip(s, run, appToday(s.dayOffset));
    const onSlip = slip.lines.some((l) => l.approvalKey === approvalKey);
    const later = run.leftForLater ?? [];
    if (action === "leave") {
      if (!onSlip) throw new HttpError(404, "That item isn't in this week's order.", { notOnSlip: true });
      run.leftForLater = [...later.filter((k) => k !== approvalKey), approvalKey];
    } else {
      const wasLeft = slip.leftOff.some((l) => l.leftOff === "for-later" && l.approvalKey === approvalKey);
      if (!wasLeft) throw new HttpError(404, "That item wasn't left for later in this week's order.", { notOnSlip: true });
      run.leftForLater = later.filter((k) => k !== approvalKey);
    }
    return weekView(s, run);
  });
}

/** A checkout may only return to a week of this browser: `/week?run=<id>`. */
export function parseReturnTo(raw: unknown): { returnTo: string; runId: string } | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const m = typeof raw === "string" ? /^\/week\?run=(wk_[a-z0-9]{12})$/.exec(raw) : null;
  if (!m) throw new HttpError(400, "Checkout can only return to a week.");
  return { returnTo: raw as string, runId: m[1] };
}

/** Note a line paid at checkout as part of this week (the first payment of a fresh session). */
export function noteCheckoutLine(state: SessionState, runId: string, line: SlipLine): void {
  const run = findRun(state, runId);
  run.sent = run.sent.filter((l) => l.approvalKey !== line.approvalKey);
  run.sent.push(line);
}

export type WeekView = ReturnType<typeof weekView>;
