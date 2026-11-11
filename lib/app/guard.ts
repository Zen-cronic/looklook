/**
 * The price guard: after a yes, LookLook keeps looking. A Channel3
 * subscription scoped to the store the item was bought at reports price
 * changes; when that store lowers the price inside its return window, the
 * sandbox test store (the seller of every charge here) refunds the
 * difference on the receipt's capture.
 *
 * Money only moves back: nothing in this file creates an order or a charge.
 * A refund is planned, sent and recorded under one lock per capture, so two
 * price events arriving together can never both refund against the same
 * starting price, and its PayPal-Request-Id comes from the capture and the
 * new price, so a redelivered event gets PayPal's first answer back.
 */
import type { Channel3Event } from "../channel3/webhooks";
import { currentPrice } from "../channel3/webhooks";
import { FALLBACK_RETAILER_ID, findRetailer, openedReturnPolicy, sameStoreDomain, storeDomain } from "../policies";
import type { PayPalClient } from "../paypal/client";
import { PayPalApiError } from "../paypal/errors";
import { buildRequestId } from "../paypal/idempotency";
import { refundCapture } from "../paypal/refunds";
import { budgetGroupOf } from "../shelf/categories";
import { addDays, appToday } from "./dates";
import { formatCents } from "./money";
import { applyRefund } from "./payments";
import { indexAdd, loadSession, updateSession, withLock } from "./store";
import type { PriceGuard, Receipt, SessionState } from "./types";

/** Smaller differences are not worth a refund. */
export const MIN_GUARD_REFUND_CENTS = 50;
/** A price under this share of what was paid is read as a listing error, never a drop. */
export const MIN_PLAUSIBLE_PRICE_SHARE = 0.5;
/** Labelled test drops allowed on one receipt. */
export const MAX_TEST_DROPS = 5;
const KEEP_EVENT_IDS = 20;

/** PayPal is still working on an earlier refund for this capture: try again later (not "done"). */
export class GuardBusyError extends Error {
  constructor() {
    super("PayPal is still working on an earlier refund for this charge.");
    this.name = "GuardBusyError";
  }
}

// Which store, for how long

/** The store a receipt's item was bought at, as a domain and as the app names it. */
export function guardSubject(state: SessionState, r: Receipt): { domain: string; store: string } | undefined {
  let store: string | undefined;
  let offerDomain: string | undefined;
  let domain: string | undefined;
  if (r.source.kind === "check") {
    const id = r.source.checkId;
    const c = state.checks.find((x) => x.id === id);
    store = c?.store;
    offerDomain = c?.product?.offerDomain;
  } else if (r.source.kind === "watch") {
    const id = r.source.watchId;
    const w = state.watch.find((x) => x.id === id);
    const c = w?.checkId ? state.checks.find((x) => x.id === w.checkId) : undefined;
    domain = w?.domain;
    store = c?.store;
    offerDomain = w?.product.offerDomain;
  } else {
    const id = r.source.shelfItemId;
    store = state.shelf.find((i) => i.id === id)?.store;
  }
  domain ??= storeDomain(store, offerDomain);
  if (!domain) return undefined;
  // Named as the store's returns policy names it ("Sephora"), else as the shopper saw it.
  const retailer = findRetailer(store ?? domain);
  return { domain, store: retailer.id !== FALLBACK_RETAILER_ID ? retailer.name : store?.trim() || domain };
}

export type GuardWindow = { ok: true; days: number } | { ok: false; why: NonNullable<PriceGuard["noGuard"]> };

/**
 * How long a drop counts: as long as the store takes this item back opened,
 * by its cited return policy. Inside that window the shopper could return it
 * and buy it again for less, so the difference is theirs to get back. With no
 * such window on record there is no guard.
 */
export function guardWindow(store: string, category: Receipt["category"]): GuardWindow {
  if (!category) return { ok: false, why: "no-rules" };
  const p = openedReturnPolicy(store, category);
  if (p.fallback) return { ok: false, why: "no-rules" };
  if (p.returnableOpened === "no") return { ok: false, why: "not-opened" };
  if (p.returnableOpened !== "yes") return { ok: false, why: "sometimes" };
  if (!p.windowDays || p.windowDays <= 0) return { ok: false, why: "no-days" };
  return { ok: true, days: p.windowDays };
}

/** Can this receipt be guarded at all? A paid capture of a catalogue product, at a store we can name. */
export function guardable(r: Receipt): boolean {
  return Boolean(r.captureId && r.productId && !r.reversedAt && (r.status === "completed" || r.status === "partly-refunded") && r.amountCents > 0);
}

export function newGuard(state: SessionState, r: Receipt, today: string, now = new Date()): PriceGuard | undefined {
  if (!guardable(r)) return undefined;
  const subject = guardSubject(state, r);
  if (!subject) return undefined;
  const w = guardWindow(subject.store, r.category);
  const on = r.on ?? today;
  return {
    status: w.ok ? "starting" : "unavailable",
    domain: subject.domain,
    store: subject.store,
    productId: r.productId!,
    paidCents: r.amountCents,
    until: w.ok ? addDays(on, w.days) : on,
    windowDays: w.ok ? w.days : 0,
    ...(w.ok ? {} : { noGuard: w.why }),
    eventIds: [],
    refunds: [],
    startedAt: now.toISOString(),
  };
}

// Deciding on one price event

/** The lowest price the shopper is already covered down to: what they paid, or the last refund's price. */
export function guardFloorCents(g: PriceGuard): number {
  return Math.min(g.paidCents, g.lowCents ?? g.paidCents);
}

/** Refunded on this capture so far (completed or pending), from the receipt's own records. */
function refundedCents(r: Receipt): number {
  return (r.refunds ?? []).filter((x) => x.status !== "FAILED" && x.status !== "CANCELLED").reduce((n, x) => n + x.amountCents, 0);
}

function previousPrice(event: Channel3Event): number | undefined {
  const p = event.data.previous;
  if (p && typeof p === "object" && typeof p.price === "number") return p.price;
  return undefined;
}

export type GuardPlan =
  | { kind: "refund"; amountCents: number; priceCents: number; requestId: string }
  | { kind: "ignore"; why: string; silent: boolean; ends?: boolean };

/**
 * What one price event means for one guarded receipt. Only a real drop at
 * the same store, inside the window, below both what was paid and the
 * lowest price already refunded to, refunds; and never more than is left
 * on the capture.
 */
export function planGuardRefund(r: Receipt, event: Channel3Event, today: string): GuardPlan {
  const g = r.guard;
  const silent = (why: string): GuardPlan => ({ kind: "ignore", why, silent: true });
  if (!g || g.status !== "on") return silent("no guard on");
  if (event.type !== "offer.price.changed") return silent("not a price event");
  const subId = event.data.subscription_id;
  const sameFeed = (subId && g.subscriptionId === subId) || event.data.subject?.product_id === g.productId;
  if (!sameFeed) return silent("another product");
  const domain = event.data.subject?.domain;
  // Money moves on this, so the store must be named and must be the one bought at.
  if (!domain || !sameStoreDomain(domain, g.domain)) return silent("another store");
  if (g.eventIds.includes(event.id)) return silent("already handled");
  const at = Date.parse(event.timestamp ?? "");
  if (g.lastEventAt && Number.isFinite(at) && at < Date.parse(g.lastEventAt)) return silent("older than the newest price applied");
  const price = currentPrice(event);
  if (price === undefined) return silent("no price");
  const ignore = (why: string, ends = false): GuardPlan => ({ kind: "ignore", why, silent: false, ends });
  if (today > g.until) return ignore("after the return window", true);
  if (!guardable(r)) return ignore("the charge isn't a completed payment any more", true);
  const priceCents = Math.round(price * 100);
  if (priceCents < g.paidCents * MIN_PLAUSIBLE_PRICE_SHARE) return ignore(`${formatCents(priceCents)} is under half of the ${formatCents(g.paidCents)} paid, so it looks like a listing error`);
  const prev = previousPrice(event);
  if (prev !== undefined && priceCents >= Math.round(prev * 100)) return ignore(`${formatCents(priceCents)} isn't a drop`);
  const floor = guardFloorCents(g);
  if (priceCents >= floor) return ignore(`${formatCents(priceCents)} isn't below the ${formatCents(floor)} already covered`);
  const left = r.amountCents - refundedCents(r);
  const amountCents = Math.min(floor - priceCents, left);
  if (amountCents < MIN_GUARD_REFUND_CENTS) return ignore(left <= 0 ? "nothing left to refund on this charge" : "the difference is under 50 cents", left <= 0);
  return { kind: "refund", amountCents, priceCents, requestId: buildRequestId("guard", r.captureId!, priceCents) };
}

// Applying it

function remember(g: PriceGuard, event: Channel3Event): void {
  g.eventIds = [...g.eventIds.filter((x) => x !== event.id), event.id].slice(-KEEP_EVENT_IDS);
  const at = Date.parse(event.timestamp ?? "");
  if (Number.isFinite(at) && (!g.lastEventAt || at > Date.parse(g.lastEventAt))) g.lastEventAt = new Date(at).toISOString();
}

export interface GuardDeps {
  client: () => Pick<PayPalClient, "request">;
  simulated: boolean;
  now?: () => Date;
}

/**
 * Apply one price event to one guarded receipt: plan, refund at PayPal and
 * record, all under the capture's lock. Returns what happened, for the event
 * log, or undefined when the event isn't about this receipt.
 */
export async function applyGuardEvent(sid: string, receiptId: string, event: Channel3Event, deps: GuardDeps): Promise<string | undefined> {
  const first = loadSession(sid).receipts.find((x) => x.id === receiptId);
  if (!first?.captureId || !first.guard) return undefined;
  const captureId = first.captureId;
  return withLock(`guard:${captureId}`, async () => {
    const state = loadSession(sid);
    const r = state.receipts.find((x) => x.id === receiptId);
    if (!r?.guard) return undefined;
    const now = deps.now?.() ?? new Date();
    const plan = planGuardRefund(r, event, appToday(state.dayOffset, now));
    const label = `${r.title} at ${r.guard.store}`;
    if (plan.kind === "ignore") {
      if (plan.silent) return undefined;
      await updateSession(sid, (s) => {
        const g = s.receipts.find((x) => x.id === receiptId)?.guard;
        if (!g) return;
        remember(g, event);
        if (plan.ends) g.status = "ended";
      });
      return `${label}: ${plan.why}. Nothing refunded.`;
    }
    let refund: Awaited<ReturnType<typeof refundCapture>>;
    try {
      refund = await refundCapture(deps.client() as PayPalClient, captureId, {
        requestId: plan.requestId,
        amountCents: plan.amountCents,
        currency: r.currency,
        noteToPayer: `The store lowered the price to ${formatCents(plan.priceCents, r.currency)}: the difference back.`,
      });
    } catch (e) {
      if (e instanceof PayPalApiError && e.status === 409) throw new GuardBusyError();
      if (e instanceof PayPalApiError && (e.hasIssue("REFUND_AMOUNT_EXCEEDED") || e.hasIssue("CAPTURE_FULLY_REFUNDED"))) {
        await updateSession(sid, (s) => {
          const g = s.receipts.find((x) => x.id === receiptId)?.guard;
          if (!g) return;
          remember(g, event);
          g.status = "ended";
          g.note = "Nothing is left to refund on this charge.";
        });
        return `${label}: nothing is left to refund on this charge.`;
      }
      throw e;
    }
    await updateSession(sid, (s) => {
      const x = s.receipts.find((y) => y.id === receiptId);
      if (!x?.guard) return;
      applyRefund(s, x, { refundId: refund.refundId, status: refund.status, amountCents: refund.amountCents ?? plan.amountCents }, now);
      const g = x.guard;
      if (!g.refunds.some((y) => y.refundId === refund.refundId)) {
        g.refunds.push({ refundId: refund.refundId, priceCents: plan.priceCents, amountCents: refund.amountCents ?? plan.amountCents, status: refund.status, eventId: event.id, simulated: deps.simulated, at: now.toISOString() });
      }
      g.lowCents = Math.min(g.lowCents ?? g.paidCents, plan.priceCents);
      remember(g, event);
      const total = refund.totalRefundedCents ?? refundedCents(x);
      if (total >= x.amountCents) g.status = "ended";
      s.notices.push({
        id: `nt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        at: now.toISOString(),
        text: `Price dropped to ${formatCents(plan.priceCents, x.currency)} at ${x.guard.store} for ${x.title}. ${formatCents(plan.amountCents, x.currency)} back to ${x.methodLabel}${x.category ? ` and to your ${budgetGroupOf(x.category)} budget` : ""}.`,
        receiptId: x.id,
        ids: [{ label: "PayPal refund", value: refund.refundId }],
      });
    });
    return `${label}: dropped to ${formatCents(plan.priceCents, r.currency)}. The store refunded ${formatCents(plan.amountCents, r.currency)} (PayPal refund ${refund.refundId}, ${refund.status}).`;
  });
}

/** Every guarded receipt in this session that listens to a subscription (or product). */
export function guardsOn(state: SessionState, event: Channel3Event): string[] {
  const subId = event.data.subscription_id;
  const productId = event.data.subject?.product_id;
  return state.receipts.filter((r) => r.guard?.status === "on" && ((subId && r.guard.subscriptionId === subId) || (productId && r.guard.productId === productId))).map((r) => r.id);
}

/** A test drop's price: about an eighth under what is covered now, to the half dollar, never under half of what was paid. */
export function testDropCents(g: PriceGuard): number {
  const floor = guardFloorCents(g);
  const lowest = Math.ceil(g.paidCents * MIN_PLAUSIBLE_PRICE_SHARE);
  const proposed = Math.round((floor * 0.875) / 50) * 50;
  return Math.max(lowest, Math.min(proposed, floor - MIN_GUARD_REFUND_CENTS));
}

/** A labelled test event in Channel3's shape: the store lowers its price. */
export function simulatedStoreDrop(g: PriceGuard, priceCents: number, now = new Date()): Channel3Event {
  return {
    id: `sim_${crypto.randomUUID().replace(/-/g, "")}`,
    timestamp: now.toISOString(),
    type: "offer.price.changed",
    data: {
      subscription_id: g.subscriptionId,
      subject: { product_id: g.productId, domain: g.domain },
      previous: { price: guardFloorCents(g) / 100, currency: "USD" },
      current: { price: priceCents / 100, currency: "USD" },
    },
  };
}

// Starting guards after a payment

export interface StartDeps {
  /** Start a Channel3 subscription for this product at this store; resolves to its id. */
  subscribe: (input: { productId: string; domain: string }) => Promise<string>;
  /** How long the caller waits for Channel3 before answering; the rest finishes on its own. */
  timeoutMs: number;
  now?: () => Date;
}

const starting = new Set<string>();
/** A guard still "starting" after this long is started again (a server restart lost the first try). */
const RESTART_AFTER_MS = 20_000;

/**
 * Put a guard on each paid receipt that can have one, and start its Channel3
 * subscription. Runs after the payments are recorded and never fails or
 * holds up a payment: each subscription runs in parallel, and the caller
 * waits at most `timeoutMs` (a guard still starting finishes on its own, or
 * is tried again the next time the week or receipt is opened).
 */
export async function ensureGuards(sid: string, receiptIds: string[] | undefined, deps: StartDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  let todo: Array<{ receiptId: string; productId: string; domain: string }> = [];
  try {
    todo = await updateSession(sid, (s) => {
      const out: Array<{ receiptId: string; productId: string; domain: string }> = [];
      const today = appToday(s.dayOffset, now);
      for (const r of s.receipts) {
        if (receiptIds && !receiptIds.includes(r.id)) continue;
        if (!r.guard) {
          const g = newGuard(s, r, today, now);
          if (!g) continue;
          r.guard = g;
        }
        const g = r.guard;
        const stale = g.status === "starting" && now.getTime() - Date.parse(g.startedAt) > RESTART_AFTER_MS;
        if ((g.status === "starting" && (stale || g.startedAt === now.toISOString())) && !starting.has(r.id)) {
          if (stale) g.startedAt = now.toISOString();
          out.push({ receiptId: r.id, productId: g.productId, domain: g.domain });
        }
      }
      return out;
    });
  } catch {
    return;
  }
  if (todo.length === 0) return;
  const runs = todo.map(async (t) => {
    starting.add(t.receiptId);
    try {
      const subscriptionId = await deps.subscribe({ productId: t.productId, domain: t.domain });
      await updateSession(sid, (s) => {
        const g = s.receipts.find((x) => x.id === t.receiptId)?.guard;
        if (g && g.status === "starting") {
          g.status = "on";
          g.subscriptionId = subscriptionId;
          g.note = undefined;
        }
      });
      await indexAdd("subscription", subscriptionId, sid);
    } catch (e) {
      await updateSession(sid, (s) => {
        const g = s.receipts.find((x) => x.id === t.receiptId)?.guard;
        if (g && g.status === "starting") {
          g.status = "unavailable";
          g.note = "The price feed didn't take this product, so a lower price on it won't be refunded.";
          console.warn("guard: price feed refused", t.receiptId, e instanceof Error ? e.message.slice(0, 200) : e);
        }
      }).catch(() => undefined);
    } finally {
      starting.delete(t.receiptId);
    }
  });
  await Promise.race([Promise.allSettled(runs), new Promise((r) => setTimeout(r, deps.timeoutMs))]);
}

// What the shopper sees

export interface GuardView {
  receiptId: string;
  title: string;
  brand: string;
  category?: Receipt["category"];
  productId?: string;
  status: PriceGuard["status"];
  store: string;
  until: string;
  windowDays: number;
  noGuard?: PriceGuard["noGuard"];
  /** The budget a refund goes back into ("skincare"). */
  budget?: string;
  paidCents: number;
  coveredCents: number;
  methodLabel: string;
  refunds: PriceGuard["refunds"];
  refundedCents: number;
  /** The price a labelled test drop would use, when one is allowed. */
  testCents?: number;
  note?: string;
}

export function guardView(r: Receipt): GuardView | undefined {
  const g = r.guard;
  if (!g) return undefined;
  const tests = g.refunds.filter((x) => x.simulated).length;
  const test = testDropCents(g);
  return {
    receiptId: r.id,
    title: r.title,
    brand: r.brand,
    category: r.category,
    productId: r.productId,
    status: g.status,
    store: g.store,
    until: g.until,
    windowDays: g.windowDays,
    ...(g.noGuard ? { noGuard: g.noGuard } : {}),
    ...(r.category ? { budget: budgetGroupOf(r.category) } : {}),
    paidCents: g.paidCents,
    coveredCents: guardFloorCents(g),
    methodLabel: r.methodLabel,
    refunds: g.refunds,
    refundedCents: g.refunds.reduce((n, x) => n + x.amountCents, 0),
    ...(g.status === "on" && tests < MAX_TEST_DROPS && test < guardFloorCents(g) ? { testCents: test } : {}),
    ...(g.note ? { note: g.note } : {}),
  };
}
