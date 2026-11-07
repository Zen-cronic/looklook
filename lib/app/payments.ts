import { APP_NAME } from "../brand";
import type { CaptureOutcome } from "../paypal/orders";
import { purchaseUnit } from "../paypal/orders";
import { buildRequestId } from "../paypal/idempotency";
import { budgetGroupOf, type Category } from "../shelf/categories";
import { shelfSku } from "../shelf/import";
import { validateShelfItem } from "../shelf/store";
import type { ShelfItem } from "../shelf/types";
import { recordSpend, refundSpend } from "./budgets";
import { addDays, daysBetween, formatDate } from "./dates";
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

export const SELLER_OF_RECORD = `${APP_NAME} Test Store (PayPal sandbox)`;

/** The save-for-later agreement, word for word as shown and stored with the method. {cap} is the per-rebuy cap. */
export const CONSENT_TEMPLATE = [
  `Save this payment method with PayPal so ${APP_NAME} can rebuy items you approve.`,
  "Each rebuy is charged only after you tap yes on it, at the price shown on that card.",
  "A rebuy above {cap} is refused.",
  "After every charge you get a notice with the PayPal order and capture IDs.",
  "Remove the saved method any time in Saved methods; that deletes it at PayPal.",
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
  /** The idempotency key part: one charge per item per cycle. */
  key: string;
}

export function stapleCycle(item: ShelfItem): string {
  return item.runOutDate ?? "none";
}

export function sourceDetails(state: SessionState, source: PurchaseSource): SourceDetails {
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    if (!item) throw new PaymentFlowError("That shelf item is gone.");
    if (!item.price) throw new PaymentFlowError("Set a price for this item before a rebuy.");
    return { title: `${item.brand} ${item.name}`.trim(), brand: item.brand, category: item.category, amountCents: Math.round(item.price * 100), productId: item.productId, key: `staple:${item.id}:${source.cycle}` };
  }
  if (source.kind === "watch") {
    const w = state.watch.find((x) => x.id === source.watchId);
    if (!w) throw new PaymentFlowError("That watched item is gone.");
    const linked = w.shelfItemId ? state.shelf.find((i) => i.id === w.shelfItemId) : undefined;
    return {
      title: w.product.title.startsWith(w.product.brand) ? w.product.title : `${w.product.brand} ${w.product.title}`.trim(),
      brand: w.product.brand,
      category: w.category,
      imageUrl: w.product.imageUrl,
      amountCents: Math.round(w.currentPrice * 100),
      productId: w.product.id,
      // A drop on a staple and its run-out date share one key: one charge per cycle.
      key: linked ? `staple:${linked.id}:${stapleCycle(linked)}` : `watch:${w.id}`,
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
    key: `check:${c.id}`,
  };
}

export class PaymentFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentFlowError";
  }
}

/**
 * PayPal-Request-Id for a charge on a saved method. Same shopper, same item
 * and cycle, same method: same id, so a double tap or a drop event plus a
 * run-out date charge once. A simulated decline gets its own id.
 */
export function savedMethodRequestId(sessionId: string, key: string, vaultId: string, simulated: boolean): string {
  return buildRequestId("rebuy", sessionId, key, vaultId, simulated ? "sim" : "live");
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

function restock(item: ShelfItem, today: string, amount: number): string {
  const from = item.runOutDate && item.runOutDate > today ? item.runOutDate : today;
  const next = addDays(from, item.cycleDays ?? DEFAULT_CYCLE_DAYS);
  item.runOutDate = next;
  item.lastRestockedOn = today;
  item.price = amount;
  return `Restocked: next run-out ${formatDate(next)}.`;
}

/**
 * Apply a completed payment once. A repeat of the same request (a double tap,
 * a retried call) only counts the attempt and checks PayPal named the same
 * order; the shelf and budget are not touched again.
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
  const amount = (paid.outcome.amountCents ?? details.amountCents) / 100;
  let shelfNote = "";
  if (source.kind === "staple") {
    const item = state.shelf.find((i) => i.id === source.shelfItemId);
    shelfNote = item ? restock(item, today, amount) : "";
  } else {
    const w = source.kind === "watch" ? state.watch.find((x) => x.id === source.watchId) : undefined;
    const linked = w?.shelfItemId ? state.shelf.find((i) => i.id === w.shelfItemId) : undefined;
    if (linked) shelfNote = restock(linked, today, amount);
    else if (details.category) {
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
      shelfNote = "Added to your shelf, unopened.";
    }
    if (w) w.closedAt = now.toISOString();
  }
  let budgetNote: string | undefined;
  if (details.category) {
    const group = budgetGroupOf(details.category);
    recordSpend(state.budgets, today, group, amount);
    const limit = state.budgets.limits[group];
    if (limit !== undefined) {
      const spent = state.budgets.spent[today.slice(0, 7)]?.[group] ?? 0;
      budgetNote = `${formatCents(Math.round(Math.max(0, limit - spent) * 100))} left in ${group} this month.`;
    }
  }
  const receipt: Receipt = {
    id: newId("rc"),
    kind: paid.kind,
    source,
    createdAt: now.toISOString(),
    on: today,
    title: details.title,
    brand: details.brand,
    category: details.category,
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
    shelfNote,
    budgetNote,
    status: paid.outcome.captureStatus === "COMPLETED" ? "completed" : "pending",
  };
  state.receipts.push(receipt);
  if (source.kind === "check") {
    const c = state.checks.find((x) => x.id === source.checkId);
    if (c) c.purchasedReceiptId = receipt.id;
  }
  for (const d of state.declines) if (!d.resolvedByReceiptId && sameSource(d.source, source)) d.resolvedByReceiptId = receipt.id;
  state.notices.push({
    id: newId("nt"),
    at: now.toISOString(),
    text: `Charged ${formatCents(receipt.amountCents, receipt.currency)} to ${receipt.methodLabel} for ${receipt.title}.`,
    receiptId: receipt.id,
    ids: [
      { label: "PayPal order", value: receipt.orderId },
      { label: "Capture", value: receipt.captureId ?? "pending" },
    ],
  });
  return { receipt, repeat: false };
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

export function recordRefund(state: SessionState, receipt: Receipt, refund: { refundId: string; status: string; amountCents?: number }, category: Category | undefined, today: string, now = new Date()): void {
  receipt.refund = { id: refund.refundId, status: refund.status, amountCents: refund.amountCents, at: now.toISOString() };
  if (refund.status === "COMPLETED") {
    receipt.status = "refunded";
    if (category) refundSpend(state.budgets, receipt.on.slice(0, 7) === today.slice(0, 7) ? today : receipt.on, budgetGroupOf(category), (refund.amountCents ?? receipt.amountCents) / 100);
  }
}

/** What a charge was, in the shopper's words: a first purchase is never called a rebuy. */
export function chargeKind(r: Pick<Receipt, "kind" | "source" | "savedMethodId">): string {
  if (r.kind === "first-purchase") return r.savedMethodId ? "First purchase, method saved for rebuys" : "One-time purchase";
  if (r.source.kind === "staple") return "Rebuy";
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
