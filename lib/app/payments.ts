import { APP_NAME } from "../brand";
import type { CaptureOutcome } from "../paypal/orders";
import { purchaseUnit } from "../paypal/orders";
import { buildRequestId } from "../paypal/idempotency";
import { budgetGroupOf, type Category } from "../shelf/categories";
import { shelfSku } from "../shelf/import";
import { validateShelfItem } from "../shelf/store";
import type { ShelfItem } from "../shelf/types";
import { recordSpend, refundSpend } from "./budgets";
import { addDays, daysBetween, formatDate, formatDay, realToday } from "./dates";
import { formatCents } from "./money";
import type { DeclinedAttempt, MethodType, PurchaseIntent, PurchaseSource, Receipt, SavedMethod, SessionState } from "./types";

/** A staple shows up for a rebuy this many days before it runs out. */
export const REBUY_LEAD_DAYS = 5;
/** Days one unit lasts when the shopper hasn't said. */
export const DEFAULT_CYCLE_DAYS = 60;
/** Default per-rebuy cap: the first price plus half, rounded up to $5, at least $25. */
export function defaultCapCents(amountCents: number): number {
  return Math.max(2500, Math.ceil((amountCents * 1.5) / 500) * 500);
}

export const SELLER_OF_RECORD = `${APP_NAME} Test Store`;

/** The save-for-later agreement, word for word as shown and stored with the method. {cap} is the per-rebuy cap. */
export const CONSENT_TEMPLATE = [
  "Each reorder is charged only after you tap yes on it, at the price shown.",
  `${APP_NAME} refuses any reorder above {cap}.`,
  "Remove it any time in Payments, which deletes it at PayPal.",
];

export function consentLines(capCents: number, currency = "USD"): string[] {
  return CONSENT_TEMPLATE.map((l) => l.replace("{cap}", formatCents(capCents, currency)));
}

export function consentText(capCents: number, currency = "USD"): string {
  return consentLines(capCents, currency).join(" ");
}

export function methodLabel(outcome: Pick<CaptureOutcome, "payer">, fallback: MethodType): string {
  const p = outcome.payer;
  if (p?.type === "card") return `${p.brand ? p.brand[0] + p.brand.slice(1).toLowerCase() : "Card"} ending ${p.lastDigits ?? "----"}`;
  if (p?.type === "paypal") return p.email ? `PayPal (${p.email})` : "PayPal";
  return fallback === "card" ? "Card" : "PayPal";
}

export function activeMethod(state: SessionState): SavedMethod | undefined {
  return [...state.methods].reverse().find((m) => m.status === "active" && !m.declinedAt) ?? [...state.methods].reverse().find((m) => m.status === "active");
}

// Orders for the PayPal JS SDK buttons

export interface CheckoutOrderOptions {
  funding: MethodType;
  save: boolean;
  customerId: string;
  returnUrl: string;
  cancelUrl: string;
}

export function intentSku(intent: Pick<PurchaseIntent, "id" | "category" | "source">, productId?: string): string {
  return intent.category && productId ? shelfSku(intent.category, productId) : `sl:item:${intent.id}`;
}

/**
 * The order the buttons approve. With save on, PayPal stores the method when
 * the payment succeeds (vault ON_SUCCESS) under the shopper's customer id.
 */
export function checkoutOrderBody(intent: PurchaseIntent, opts: CheckoutOrderOptions, productId?: string) {
  const unit = purchaseUnit({
    referenceId: intent.id,
    currency: intent.currency,
    description: `${APP_NAME}: ${intent.title}`.slice(0, 127),
    items: [{ sku: intentSku(intent, productId), name: intent.title, unitCents: intent.amountCents }],
  });
  if (opts.funding === "paypal") {
    const paypal: Record<string, unknown> = {
      experience_context: {
        brand_name: APP_NAME,
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    };
    if (opts.save) {
      paypal.attributes = {
        vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER", permit_multiple_payment_tokens: true },
      };
    }
    return { intent: "CAPTURE", purchase_units: [unit], payment_source: { paypal } };
  }
  const attributes: Record<string, unknown> = { verification: { method: "SCA_WHEN_REQUIRED" } };
  if (opts.save) {
    attributes.vault = { store_in_vault: "ON_SUCCESS" };
    attributes.customer = { id: opts.customerId };
  }
  return { intent: "CAPTURE", purchase_units: [unit], payment_source: { card: { attributes } } };
}

// What a purchase is for

export interface SourceDetails {
  title: string;
  brand: string;
  category?: Category;
  imageUrl?: string;
  amountCents: number;
  productId?: string;
  /** The approval this pays for (see approvalKey): one charge per approval. */
  key: string;
}

export function stapleCycle(item: ShelfItem): string {
  return item.runOutDate ?? "none";
}

/**
 * What a yes buys, fixed when the card was shown and never moved by the
 * payment itself: a staple and its cycle (the run-out date on the card), a
 * drop on a staple (the cycle when the watch started, so the drop and the
 * run-out card for that cycle are one purchase), a watch, or a check.
 */
export function approvalKey(state: SessionState, source: PurchaseSource): string {
  if (source.kind === "staple") return `staple:${source.shelfItemId}:${source.cycle}`;
  if (source.kind === "watch") {
    const w = state.watch.find((x) => x.id === source.watchId);
    if (!w) throw new PaymentFlowError("That watched item is gone.");
    return w.shelfItemId && w.cycle ? `staple:${w.shelfItemId}:${w.cycle}` : `watch:${w.id}`;
  }
  return `check:${source.checkId}`;
}

/** The receipt that already paid for this approval, if any (a denied capture doesn't count). */
export function boughtFor(state: SessionState, key: string): Receipt | undefined {
  return state.receipts.find((r) => r.approvalKey === key && r.status !== "failed");
}

/** How many earlier payments for this approval were denied: a new try needs a new request id. */
export function failedTries(state: SessionState, key: string): number {
  return state.receipts.filter((r) => r.approvalKey === key && r.status === "failed").length;
}

/** The version of the card the shopper saw: a staple's cycle, or when the drop arrived. */
export function approvalVersion(state: SessionState, source: PurchaseSource): string {
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    return item ? stapleCycle(item) : "";
  }
  if (source.kind === "watch") return state.watch.find((x) => x.id === source.watchId)?.droppedAt ?? "";
  return "";
}

/**
 * Is this card still something to say yes to? The staple's cycle is derived
 * here, never taken from the request: it must be the item's current run-out
 * date and inside the rebuy lead time. A drop card needs an open watch with
 * a drop on it.
 */
export function checkApproval(state: SessionState, source: PurchaseSource, today: string): void {
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    if (!item) throw new PaymentFlowError("That shelf item is gone.");
    const cycle = stapleCycle(item);
    if (source.cycle !== cycle || !item.runOutDate) {
      throw new StaleApprovalError(`This reorder is out of date: ${item.brand} ${item.name} now runs out on ${item.runOutDate ? formatDate(item.runOutDate) : "no set date"}. Nothing was charged.`.replace(/\s+/g, " "));
    }
    if (daysBetween(today, item.runOutDate) > REBUY_LEAD_DAYS) {
      throw new StaleApprovalError(`${item.brand} ${item.name} isn't due yet: it shows up for a reorder ${REBUY_LEAD_DAYS} days before it runs out. Nothing was charged.`.replace(/\s+/g, " "));
    }
    return;
  }
  if (source.kind === "watch") {
    const w = state.watch.find((x) => x.id === source.watchId);
    if (!w) throw new PaymentFlowError("That watched item is gone.");
    if (w.closedAt) throw new StaleApprovalError("You're no longer watching this item. Nothing was charged.");
    if (!w.droppedAt) throw new StaleApprovalError("There's no price drop to approve on this item right now. Nothing was charged.");
  }
}

export function sourceDetails(state: SessionState, source: PurchaseSource): SourceDetails {
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    if (!item) throw new PaymentFlowError("That shelf item is gone.");
    if (!item.price) throw new PaymentFlowError("Set a price for this item before a reorder.");
    return { title: `${item.brand} ${item.name}`.trim(), brand: item.brand, category: item.category, amountCents: Math.round(item.price * 100), productId: item.productId, key: approvalKey(state, source) };
  }
  if (source.kind === "watch") {
    const w = state.watch.find((x) => x.id === source.watchId);
    if (!w) throw new PaymentFlowError("That watched item is gone.");
    return {
      title: w.product.title.startsWith(w.product.brand) ? w.product.title : `${w.product.brand} ${w.product.title}`.trim(),
      brand: w.product.brand,
      category: w.category,
      imageUrl: w.product.imageUrl,
      amountCents: Math.round(w.currentPrice * 100),
      productId: w.product.id,
      key: approvalKey(state, source),
    };
  }
  const c = state.checks.find((x) => x.id === source.checkId);
  if (!c) throw new PaymentFlowError("That check is gone.");
  if (c.facts.priceShown === null) throw new PaymentFlowError("Add the price first.");
  return {
    title: `${c.facts.brand} ${c.facts.name}`.trim(),
    brand: c.facts.brand,
    category: c.facts.category,
    imageUrl: c.product?.imageUrl,
    amountCents: Math.round(c.facts.priceShown * 100),
    productId: c.product?.id,
    key: approvalKey(state, source),
  };
}

/** What a paid receipt was for, to answer a repeat of the same yes. */
export function receiptDetails(r: Receipt): SourceDetails {
  return { title: r.title, brand: r.brand, category: r.category, amountCents: r.amountCents, productId: r.productId, key: r.approvalKey ?? r.requestId };
}

export class PaymentFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentFlowError";
  }
}

/** The card the shopper tapped no longer matches what is due (answered 409). */
export class StaleApprovalError extends PaymentFlowError {
  constructor(message: string) {
    super(message);
    this.name = "StaleApprovalError";
  }
}

/**
 * PayPal-Request-Id for a charge on a saved method: the shopper, the approval
 * (item and cycle, watch or check), the amount on the card and the method.
 * None of these change when the payment goes through, so the same yes sent
 * again gets the same order back. A simulated decline, or a new try after a
 * denied capture, gets its own id.
 */
export function savedMethodRequestId(sessionId: string, key: string, amountCents: number, vaultId: string, simulated: boolean, retry = 0): string {
  return buildRequestId("rebuy", sessionId, key, amountCents, vaultId, simulated ? "sim" : "live", ...(retry ? [`try${retry + 1}`] : []));
}

// Staples coming due

export interface DueStaple {
  item: ShelfItem;
  daysLeft: number;
  cycle: string;
  amountCents: number;
}

export function dueStaples(state: SessionState, today: string): DueStaple[] {
  return state.shelf
    .filter((i) => i.price && i.runOutDate && daysBetween(today, i.runOutDate) <= REBUY_LEAD_DAYS)
    .map((i) => ({ item: i, daysLeft: daysBetween(today, i.runOutDate!), cycle: stapleCycle(i), amountCents: Math.round(i.price! * 100) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// Recording results

export interface PaidResult {
  outcome: CaptureOutcome;
  /** This call joined one already in flight for the same request (merged in the app). */
  merged?: boolean;
  requestId: string;
  kind: Receipt["kind"];
  methodLabel: string;
  methodId?: string;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function restock(item: ShelfItem, today: string, amount: number, now: Date): string {
  const from = item.runOutDate && item.runOutDate > today ? item.runOutDate : today;
  const next = addDays(from, item.cycleDays ?? DEFAULT_CYCLE_DAYS);
  item.runOutDate = next;
  item.lastRestockedOn = today;
  item.price = amount;
  // A run-out date counted from a simulated today says so.
  const counted = today !== realToday(now) ? ` (counted from the simulated date ${formatDay(today)})` : "";
  return `Restocked: next run-out ${formatDate(next)}${counted}.`;
}

/** Close the open watches on a shelf item once its cycle is bought, so a later drop card can't buy it again. */
function closeWatchesOn(state: SessionState, itemId: string, receiptId: string, at: string): void {
  for (const w of state.watch) {
    if (w.closedAt || w.shelfItemId !== itemId) continue;
    w.closedAt = at;
    w.closedBy = receiptId;
    w.droppedAt = undefined;
  }
}

/**
 * Apply a completed payment once. A repeat of the same request (a double tap,
 * a retried call) only counts the attempt and checks PayPal named the same
 * order; the shelf and budget are not touched again. The receipt is written
 * from PayPal's answer first; if a shelf or budget update fails after that,
 * the receipt stays and says so.
 */
export function recordPaid(state: SessionState, source: PurchaseSource, details: SourceDetails, paid: PaidResult, today: string, now = new Date()): { receipt: Receipt; repeat: boolean } {
  const existing = state.receipts.find((r) => r.requestId === paid.requestId);
  if (existing) {
    existing.attempts += 1;
    if (paid.merged) existing.mergedInApp = (existing.mergedInApp ?? 0) + 1;
    else existing.resentToPayPal = (existing.resentToPayPal ?? 0) + 1;
    existing.sameOrderEveryTime = existing.sameOrderEveryTime && existing.orderId === paid.outcome.orderId;
    return { receipt: existing, repeat: true };
  }
  const at = now.toISOString();
  const receipt: Receipt = {
    id: newId("rc"),
    kind: paid.kind,
    source,
    createdAt: at,
    on: today,
    title: details.title,
    brand: details.brand,
    category: details.category,
    productId: details.productId,
    approvalKey: details.key,
    amountCents: paid.outcome.amountCents ?? details.amountCents,
    currency: paid.outcome.currency ?? "USD",
    methodLabel: paid.methodLabel,
    methodId: paid.methodId,
    orderId: paid.outcome.orderId,
    captureId: paid.outcome.captureId,
    captureStatus: paid.outcome.captureStatus,
    requestId: paid.requestId,
    attempts: 1,
    sameOrderEveryTime: true,
    shelfNote: "",
    status: paid.outcome.captureStatus === "COMPLETED" ? "completed" : "pending",
  };
  state.receipts.push(receipt);
  const amount = receipt.amountCents / 100;
  try {
    applyToShelf(state, source, details, receipt, today, amount, now);
  } catch {
    receipt.shelfNote = "Paid. The shelf couldn't be updated for this item. Add it on the Shelf page.";
  }
  try {
    if (details.category) {
      const group = budgetGroupOf(details.category);
      recordSpend(state.budgets, today, group, amount);
      receipt.spent = amount;
      const limit = state.budgets.limits[group];
      if (limit !== undefined) {
        const spent = state.budgets.spent[today.slice(0, 7)]?.[group] ?? 0;
        receipt.budgetNote = `${formatCents(Math.round(Math.max(0, limit - spent) * 100))} left in ${group} this month.`;
      }
    }
  } catch {
    receipt.budgetNote = undefined;
  }
  if (source.kind === "check") {
    const c = state.checks.find((x) => x.id === source.checkId);
    if (c) c.purchasedReceiptId = receipt.id;
  }
  for (const d of state.declines) if (!d.resolvedByReceiptId && sameSource(d.source, source)) d.resolvedByReceiptId = receipt.id;
  state.notices.push({
    id: newId("nt"),
    at,
    text: `Charged ${formatCents(receipt.amountCents, receipt.currency)} to ${receipt.methodLabel} for ${receipt.title}.`,
    receiptId: receipt.id,
    ids: [
      { label: "PayPal order", value: receipt.orderId },
      { label: "Capture", value: receipt.captureId ?? "pending" },
    ],
  });
  return { receipt, repeat: false };
}

function applyToShelf(state: SessionState, source: PurchaseSource, details: SourceDetails, receipt: Receipt, today: string, amount: number, now: Date): void {
  const at = now.toISOString();
  const restockItem = (item: ShelfItem) => {
    const before = { runOutDate: item.runOutDate, lastRestockedOn: item.lastRestockedOn, price: item.price };
    receipt.shelfNote = restock(item, today, amount, now);
    receipt.shelfChange = { kind: "restock", itemId: item.id, before, after: item.runOutDate! };
    closeWatchesOn(state, item.id, receipt.id, at);
  };
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    if (item) restockItem(item);
    return;
  }
  const w = source.kind === "watch" ? state.watch.find((x) => x.id === source.watchId) : undefined;
  if (w) {
    w.closedAt = at;
    w.closedBy = receipt.id;
    w.droppedAt = undefined;
  }
  const linked = w?.shelfItemId ? state.shelf.find((i) => i.id === w.shelfItemId) : undefined;
  if (linked) return restockItem(linked);
  if (!details.category) return;
  const fromCheck = source.kind === "check" ? state.checks.find((c) => c.id === source.checkId) : w?.checkId ? state.checks.find((c) => c.id === w.checkId) : undefined;
  const added = validateShelfItem({
    id: newId("sh"),
    brand: details.brand,
    name: (fromCheck?.facts.name || details.title.replace(details.brand, "")).trim() || details.title,
    category: details.category,
    attributes: fromCheck?.facts.attributes ?? {},
    opened: false,
    runOutDate: null,
    source: "app-order",
    addedOn: today,
    price: amount,
    productId: details.productId,
    store: fromCheck?.store,
  });
  state.shelf.push(added);
  receipt.shelfChange = { kind: "added", itemId: added.id };
  receipt.shelfNote = "Added to your shelf, unopened.";
}

export function sameSource(a: PurchaseSource, b: PurchaseSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "staple" && b.kind === "staple") return a.shelfItemId === b.shelfItemId;
  if (a.kind === "watch" && b.kind === "watch") return a.watchId === b.watchId;
  if (a.kind === "check" && b.kind === "check") return a.checkId === b.checkId;
  return false;
}

/** Save the method PayPal vaulted with a first purchase, with the agreement the shopper accepted. */
export function recordSavedMethod(
  state: SessionState,
  outcome: CaptureOutcome,
  opts: { funding: MethodType; capCents: number; currency: string; replacesMethodId?: string },
  now = new Date(),
): SavedMethod | undefined {
  if (!outcome.vault?.id) return undefined;
  const existing = state.methods.find((m) => m.vaultId === outcome.vault!.id);
  if (existing) return existing;
  const method: SavedMethod = {
    id: newId("pm"),
    type: outcome.vault.type,
    vaultId: outcome.vault.id,
    customerId: outcome.vault.customerId,
    label: methodLabel(outcome, opts.funding),
    capCents: opts.capCents,
    currency: opts.currency,
    consentText: consentText(opts.capCents, opts.currency),
    consentedAt: now.toISOString(),
    firstOrderId: outcome.orderId,
    status: "active",
  };
  state.methods.push(method);
  return method;
}

export function recordDecline(
  state: SessionState,
  source: PurchaseSource,
  details: SourceDetails,
  method: SavedMethod,
  info: { issue: string; debugId?: string; simulated: boolean },
  now = new Date(),
): DeclinedAttempt {
  const open = state.declines.find((x) => !x.resolvedByReceiptId && x.methodId === method.id && sameSource(x.source, source));
  if (open) return open;
  const d: DeclinedAttempt = {
    id: newId("dc"),
    at: now.toISOString(),
    source,
    title: details.title,
    amountCents: details.amountCents,
    methodId: method.id,
    methodLabel: method.label,
    issue: info.issue,
    debugId: info.debugId,
    simulated: info.simulated,
  };
  state.declines.push(d);
  const m = state.methods.find((x) => x.id === method.id);
  if (m) m.declinedAt = now.toISOString();
  state.notices.push({ id: newId("nt"), at: now.toISOString(), text: `PayPal declined ${method.label} for ${details.title}. Nothing was charged.` });
  return d;
}

export function openDecline(state: SessionState, source: PurchaseSource): DeclinedAttempt | undefined {
  return [...state.declines].reverse().find((d) => !d.resolvedByReceiptId && sameSource(d.source, source));
}

/**
 * Record a refund on a receipt, from the app's refund call or PayPal's
 * webhook. Each refund id is credited back to the month's budget once, for
 * its own amount, when it completes; a pending refund shows as pending.
 */
export function applyRefund(state: SessionState, receipt: Receipt, refund: { refundId: string; status: string; amountCents?: number }, now = new Date()): void {
  const at = now.toISOString();
  const list = (receipt.refunds ??= []);
  const done = () => list.filter((x) => x.status === "COMPLETED").reduce((n, x) => n + x.amountCents, 0);
  let rec = list.find((x) => x.id === refund.refundId);
  if (!rec) {
    rec = { id: refund.refundId, status: refund.status, amountCents: refund.amountCents ?? Math.max(0, receipt.amountCents - done()), at };
    list.push(rec);
  } else {
    rec.status = refund.status;
    if (refund.amountCents !== undefined) rec.amountCents = refund.amountCents;
  }
  receipt.refund = { id: rec.id, status: rec.status, amountCents: rec.amountCents, at: rec.at };
  if (rec.status === "COMPLETED" && !rec.credited) {
    rec.credited = true;
    if (receipt.category && !receipt.reversedAt) refundSpend(state.budgets, receipt.on, budgetGroupOf(receipt.category), rec.amountCents / 100);
  }
  const refunded = done();
  if (refunded >= receipt.amountCents) receipt.status = "refunded";
  else if (refunded > 0) receipt.status = "partly-refunded";
}

/**
 * PayPal denied a capture after the receipt was written: no money moved, so
 * the restock (or the item added to the shelf) and the budget spend are
 * undone, the watch it closed opens again, and the receipt says it failed.
 */
export function reversePayment(state: SessionState, receipt: Receipt, why: string, now = new Date()): boolean {
  if (receipt.reversedAt) return false;
  receipt.reversedAt = now.toISOString();
  receipt.status = "failed";
  const ch = receipt.shelfChange;
  if (ch?.kind === "restock") {
    const item = state.shelf.find((i) => i.id === ch.itemId);
    if (item && item.runOutDate === ch.after) {
      item.runOutDate = ch.before.runOutDate;
      item.lastRestockedOn = ch.before.lastRestockedOn;
      item.price = ch.before.price;
    }
  } else if (ch?.kind === "added") {
    state.shelf = state.shelf.filter((i) => i.id !== ch.itemId);
  }
  const credited = (receipt.refunds ?? []).filter((x) => x.credited).reduce((n, x) => n + x.amountCents, 0) / 100;
  if (receipt.spent && receipt.category) refundSpend(state.budgets, receipt.on, budgetGroupOf(receipt.category), Math.max(0, receipt.spent - credited));
  for (const w of state.watch) {
    if (w.closedBy === receipt.id) {
      w.closedAt = undefined;
      w.closedBy = undefined;
    }
  }
  for (const c of state.checks) if (c.purchasedReceiptId === receipt.id) c.purchasedReceiptId = undefined;
  receipt.shelfNote = `Undone: ${why}. Nothing was charged, so the shelf and budget are back as they were.`;
  receipt.budgetNote = undefined;
  state.notices.push({ id: newId("nt"), at: receipt.reversedAt, text: `${why} for ${receipt.title}. Nothing was charged.`, receiptId: receipt.id });
  return true;
}

/** The receipt's status in words: paid, pending, failed, or how much was refunded. */
export function receiptStatusLabel(r: Pick<Receipt, "status" | "captureStatus" | "refund" | "refunds" | "currency">): string {
  if (r.status === "failed") return "Payment failed, nothing charged";
  const pending = r.refund?.status === "PENDING" ? "; refund pending at PayPal" : "";
  if (r.status === "refunded") return "Refunded";
  if (r.status === "partly-refunded") {
    const back = (r.refunds ?? []).filter((x) => x.status === "COMPLETED").reduce((n, x) => n + x.amountCents, 0);
    return `Paid, ${formatCents(back, r.currency)} refunded${pending}`;
  }
  return `${r.captureStatus === "COMPLETED" ? "Paid" : `Payment ${r.captureStatus.toLowerCase()}`}${pending}`;
}

/** What a charge was, in the shopper's words: a first purchase is never called a rebuy. */
export function chargeKind(r: Pick<Receipt, "kind" | "source" | "savedMethodId">): string {
  if (r.kind === "first-purchase") return r.savedMethodId ? "First purchase, method saved for reorders" : "One-time purchase";
  if (r.source.kind === "staple") return "Reorder";
  if (r.source.kind === "watch") return "Bought after a price drop";
  return "Paid with a saved method";
}

/** The receipt's line about repeats: what happened in the app and at PayPal. */
export function repeatsLine(r: Pick<Receipt, "attempts" | "sameOrderEveryTime" | "mergedInApp" | "resentToPayPal" | "requestId">): string {
  if (r.attempts <= 1) return "Sent to PayPal once.";
  if (!r.sameOrderEveryTime) return `You said yes ${r.attempts} times and a repeat came back with a different PayPal order. Check your PayPal activity.`;
  const merged = r.mergedInApp ?? 0;
  const resent = r.resentToPayPal ?? 0;
  const parts: string[] = [];
  if (merged) parts.push(`${merged} that arrived while the first was still running ${merged === 1 ? "was" : "were"} merged here and never reached PayPal`);
  if (resent) parts.push(`${resent} later ${resent === 1 ? "repeat was" : "repeats were"} sent with the same PayPal-Request-Id, and PayPal returned this same order`);
  if (!parts.length) parts.push("every repeat used the same PayPal-Request-Id and named this same order");
  return `You said yes ${r.attempts} times: ${parts.join("; ")}. One charge.`;
}

/** Record a captured PayPal checkout (first purchase or a re-approval) for its intent. */
export function recordCheckoutCapture(state: SessionState, intent: PurchaseIntent, outcome: CaptureOutcome, requestId: string, today: string, now = new Date()) {
  const order = intent.order!;
  const method = order.save ? recordSavedMethod(state, outcome, { funding: order.funding, capCents: order.capCents, currency: intent.currency, replacesMethodId: intent.replacesMethodId }, now) : undefined;
  // Built from the intent alone: the money has moved, so nothing here may depend on the item still being there.
  const details: SourceDetails = { title: intent.title, brand: intent.brand, category: intent.category, imageUrl: intent.imageUrl, productId: intent.productId, amountCents: intent.amountCents, key: intent.approvalKey ?? `intent:${intent.id}` };
  const label = method?.label ?? (outcome.payer?.type === "card" ? `Card ending ${outcome.payer.lastDigits ?? ""}`.trim() : "PayPal");
  const { receipt } = recordPaid(state, intent.source, details, { outcome, requestId, kind: "first-purchase", methodLabel: label, methodId: method?.id }, today, now);
  receipt.savedMethodId = method?.id;
  const i = state.intents.find((x) => x.id === intent.id);
  if (i) i.receiptId = receipt.id;
  return { receipt, method, vaultStatus: outcome.vault?.status };
}
