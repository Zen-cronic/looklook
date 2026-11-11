import type { PriceBand } from "../channel3/band";
import type { BudgetGroup, Category } from "../shelf/categories";
import type { ShelfItem } from "../shelf/types";
import type { Decision, ProductFacts } from "../verdict/types";
import type { ScreenshotFields } from "../vision/schema";

/** A catalogue product as the app shows it (no raw responses are kept). */
export interface ProductCard {
  id: string;
  title: string;
  brand: string;
  imageUrl?: string;
  /** Channel3 buy link (an affiliate link: show the commission notice next to it). */
  offerUrl?: string;
  offerDomain?: string;
  offerPrice?: number;
  category?: Category;
}

export interface CheckCandidate {
  product: ProductCard;
  confidence: number;
}

/** One screenshot or link checked by the shopper. */
export interface CheckRecord {
  id: string;
  createdAt: string;
  /** The (possibly simulated) date the verdict was decided on. */
  decidedOn: string;
  input: { kind: "screenshot"; imageHash: string; sample?: string } | { kind: "link"; url: string; picture?: boolean };
  fields: ScreenshotFields;
  candidates: CheckCandidate[];
  product?: ProductCard;
  needsConfirmation: boolean;
  confirmWhy: string[];
  facts: ProductFacts;
  store?: string;
  /** Cleaned 90-day price band of the matched product; null when there is no usable history. */
  band: PriceBand | null;
  decision: Decision;
  reason: { text: string; source: "model" | "template" };
  watchId?: string;
  /** "Remind me" on a wait: when the budget restarts, or when the one you own is nearly used up. */
  reminder?: { kind: "budget" | "run-out"; on: string; setAt: string; doneAt?: string };
  purchasedReceiptId?: string;
  /** Offers for the same product at other stores, from the catalogue (derived fields only). */
  offers?: StoreOffer[];
}

/** One store's offer for a product, as the verdict shows it. */
export interface StoreOffer {
  domain: string;
  price: number;
  url?: string;
}

export type MethodType = "card" | "paypal";

/** A payment method saved with PayPal after the shopper agreed to the save-for-later terms. */
export interface SavedMethod {
  id: string;
  type: MethodType;
  /** PayPal payment token (vault) id. */
  vaultId: string;
  customerId?: string;
  label: string;
  capCents: number;
  currency: string;
  consentText: string;
  consentedAt: string;
  firstOrderId: string;
  status: "active" | "removed";
  removedAt?: string;
  /** PayPal answered 404 for the token after the delete (checked twice). */
  revokeConfirmed?: boolean;
  /** Removed here (no rebuy can use it), but PayPal hasn't confirmed the delete yet: retry. */
  revokePending?: boolean;
  /** Set when PayPal declined this method on a rebuy; the shopper is asked to approve another. */
  declinedAt?: string;
}

/** Something waiting for a lower price (from a wait verdict). */
export interface WatchItem {
  id: string;
  checkId?: string;
  product: ProductCard;
  category?: Category;
  /** Price when the watch started. */
  startPrice: number;
  targetPrice: number;
  currentPrice: number;
  /** Shelf item this would restock, if any. */
  shelfItemId?: string;
  /** The store the price was seen at: only its price events count. Watches started before this field count every store. */
  domain?: string;
  subscription: { status: "active"; id: string } | { status: "unavailable"; reason: string } | { status: "cancelled"; id: string };
  createdAt: string;
  /** The linked staple's run-out date when the watch started: a drop buys that cycle. */
  cycle?: string;
  /** Set when a price event brought the price to the target or lower; cleared when it rises again or the drop is bought. */
  droppedAt?: string;
  lastEventId?: string;
  /** Time of the newest price event applied (events older than this are ignored). */
  lastEventAt?: string;
  closedAt?: string;
  /** The receipt that ended this watch (its own purchase, or the staple's rebuy). */
  closedBy?: string;
}

export type PurchaseSource =
  | { kind: "check"; checkId: string }
  | { kind: "staple"; shelfItemId: string; cycle: string }
  | { kind: "watch"; watchId: string };

/** What the shopper is about to pay for, before PayPal is involved. */
export interface PurchaseIntent {
  id: string;
  createdAt: string;
  source: PurchaseSource;
  title: string;
  brand: string;
  category?: Category;
  imageUrl?: string;
  amountCents: number;
  currency: string;
  productId?: string;
  /** What this purchase buys, for one charge per approval (see approvalKey). */
  approvalKey?: string;
  /** Re-approval after a decline replaces this saved method. */
  replacesMethodId?: string;
  /** Where checkout returns after paying: the week this was the first payment of. */
  returnTo?: string;
  /** Filled while PayPal checkout runs. */
  order?: { id: string; funding: MethodType; save: boolean; capCents: number };
  receiptId?: string;
}

export type ReceiptStatus = "completed" | "pending" | "refunded" | "partly-refunded" | "failed";

/** One refund on a capture, from the app or from PayPal's webhook. */
export interface RefundRecord {
  id: string;
  status: string;
  amountCents: number;
  at: string;
  /** The amount went back into the month's budget (once per refund). */
  credited?: boolean;
}

/** A completed payment: the shopper's record of it. */
export interface Receipt {
  id: string;
  kind: "first-purchase" | "saved-method";
  source: PurchaseSource;
  createdAt: string;
  /** The (possibly simulated) date it happened on. */
  on: string;
  title: string;
  brand: string;
  category?: Category;
  productId?: string;
  /** What was bought: item and cycle, watch or check. A second yes for the same approval never charges again. */
  approvalKey?: string;
  amountCents: number;
  currency: string;
  methodLabel: string;
  methodId?: string;
  orderId: string;
  captureId?: string;
  captureStatus: string;
  requestId: string;
  /** How many yeses (or retries) arrived for this request, and whether every answer named the same order. */
  attempts: number;
  sameOrderEveryTime: boolean;
  /** Repeats that arrived while the first was still running: merged in the app, never sent to PayPal. */
  mergedInApp?: number;
  /** Later repeats sent to PayPal again with the same PayPal-Request-Id. */
  resentToPayPal?: number;
  shelfNote: string;
  budgetNote?: string;
  savedMethodId?: string;
  webhook?: { eventId: string; type: string; at: string };
  /** The latest refund, as shown on the receipt. */
  refund?: { id: string; status: string; amountCents?: number; at?: string };
  refunds?: RefundRecord[];
  /** What the payment changed on the shelf, so a denied capture can be undone. */
  shelfChange?: { kind: "restock"; itemId: string; before: { runOutDate: string | null; lastRestockedOn?: string; price?: number }; after: string } | { kind: "added"; itemId: string };
  /** Budget spend recorded for this payment (dollars, month of `on`). */
  spent?: number;
  /** Set when a denied capture's shelf and budget changes were undone. */
  reversedAt?: string;
  status: ReceiptStatus;
  /** After the yes: a lower price at the same store, inside its return window, gets the difference back. */
  guard?: PriceGuard;
}

/**
 * The price guard on one paid receipt, for as long as the store takes the
 * item back opened (its cited return policy). A Channel3 subscription scoped
 * to that store reports price changes; a drop below the price paid (or the
 * lowest price already refunded down to) refunds the difference on the
 * receipt's capture, and the refund goes back into the month's budget. Money
 * only moves back: nothing here charges.
 */
export interface PriceGuard {
  status: "starting" | "on" | "unavailable" | "ended";
  /** The store's web domain: only its price events count. */
  domain: string;
  /** The store as the app names it (filming mode rewrites this key). */
  store: string;
  productId: string;
  paidCents: number;
  /** Last day (app date) a drop still counts. */
  until: string;
  /** Days the store takes it back opened, by its cited return policy (0 when there is no guard). */
  windowDays: number;
  /** Why there is no guard: no return rules on record for the store, it doesn't take it back opened, only sometimes, or no number of days. */
  noGuard?: "no-rules" | "not-opened" | "sometimes" | "no-days";
  subscriptionId?: string;
  /** The lowest price a refund has already been made down to. */
  lowCents?: number;
  /** Newest price event applied (older ones are ignored). */
  lastEventAt?: string;
  /** Price events already handled, newest last (a short list). */
  eventIds: string[];
  refunds: Array<{ refundId: string; priceCents: number; amountCents: number; status: string; eventId: string; simulated: boolean; at: string }>;
  startedAt: string;
  note?: string;
}

/** A rebuy PayPal refused; the approval card offers re-approval. */
export interface DeclinedAttempt {
  id: string;
  at: string;
  source: PurchaseSource;
  title: string;
  amountCents: number;
  methodId: string;
  methodLabel: string;
  issue: string;
  debugId?: string;
  simulated: boolean;
  resolvedByReceiptId?: string;
}

export interface Notice {
  id: string;
  at: string;
  text: string;
  receiptId?: string;
  /** PayPal ids behind the notice, shown under Details. */
  ids?: Array<{ label: string; value: string }>;
}

export interface Budgets {
  currency: string;
  /** Monthly limits per group (dollars). */
  limits: Partial<Record<BudgetGroup, number>>;
  /** Spent per month key (YYYY-MM) per group (dollars). */
  spent: Record<string, Partial<Record<BudgetGroup, number>>>;
}

export interface SessionState {
  version: 1;
  id: string;
  createdAt: string;
  /** Short PayPal customer id for saved methods (PayPal rejects long ones). */
  customerId: string;
  /** Simulated date: days added to the real date. */
  dayOffset: number;
  shelf: ShelfItem[];
  budgets: Budgets;
  checks: CheckRecord[];
  watch: WatchItem[];
  intents: PurchaseIntent[];
  methods: SavedMethod[];
  receipts: Receipt[];
  declines: DeclinedAttempt[];
  notices: Notice[];
  demo: { declineNextRebuy: boolean };
  /** Set when the shopper loaded the sample week (fictional data, labelled where it shows). */
  sample?: { kind: "week"; loadedAt: string };
  /** "Hand it your week" runs, newest last (see lib/app/week.ts). */
  weeks?: WeekRun[];
}

// A week handed over at once: posts in, one slip, one yes

export type WeekGroup = "skip" | "wait" | "buy" | "ask";

/** One post of the week as it was grouped (a snapshot: verdicts are decided again later). */
export interface WeekInput {
  checkId: string;
  group: WeekGroup;
  rule: string;
  waitKind?: "budget" | "price" | "run-out" | "set-run-out";
  waitUntil?: string;
  priceCents?: number;
  keptCents?: number;
  targetPrice?: number;
  title: string;
  brand: string;
  category?: Category;
  imageUrl?: string;
  productId?: string;
  reason: string;
}

/** One payment on the week's slip. */
export interface SlipLine {
  source: PurchaseSource;
  approvalKey: string;
  amountCents: number;
  version: string;
  why: "buy" | "due";
  daysLeft?: number;
  title: string;
  brand: string;
  category?: Category;
  imageUrl?: string;
  productId?: string;
}

export type WeekLineStatus = "queued" | "paid" | "declined" | "price-changed" | "over-cap" | "over-budget" | "stale" | "needs-checkout" | "unconfirmed";

export interface WeekLineOutcome {
  status: Exclude<WeekLineStatus, "queued">;
  receiptId?: string;
  message?: string;
  at: string;
}

export interface WeekRun {
  id: string;
  createdAt: string;
  /** The (simulated) day the week was handed over. */
  on: string;
  from: "sample-week" | "posts";
  inputs: WeekInput[];
  /** Every line a yes was given for (on the slip or at checkout), newest status by approval key. */
  sent: SlipLine[];
  outcomes: Record<string, WeekLineOutcome>;
  watches: Array<{ checkId: string; watchId?: string; status: "armed" | "unavailable"; message?: string }>;
  approvedAt?: string;
  /** Lines the shopper (or the assistant, asked in words) took off this slip for later, by approval key. */
  leftForLater?: string[];
}

export type EventSource = "paypal" | "channel3";

/** One webhook delivery as received, with its verification result and effect. */
export interface EventLogEntry {
  id: string;
  receivedAt: string;
  source: EventSource;
  /** Simulated in the app (not delivered by the provider). */
  simulated: boolean;
  eventId?: string;
  type?: string;
  verification: "verified" | "failed" | "not-configured" | "simulated";
  failureReason?: string;
  duplicate: boolean;
  /** For a verified or simulated event: being applied, applied, or failed (a redelivery is then applied). */
  state?: "processing" | "handled" | "failed";
  effect?: string;
}
