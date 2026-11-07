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
  input: { kind: "screenshot"; imageHash: string; sample?: string } | { kind: "link"; url: string };
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
  purchasedReceiptId?: string;
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
  subscription: { status: "active"; id: string } | { status: "unavailable"; reason: string } | { status: "cancelled"; id: string };
  createdAt: string;
  /** Set when a price event brought the price to the target or lower. */
  droppedAt?: string;
  lastEventId?: string;
  closedAt?: string;
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
  /** Re-approval after a decline replaces this saved method. */
  replacesMethodId?: string;
  /** Filled while PayPal checkout runs. */
  order?: { id: string; funding: MethodType; save: boolean; capCents: number };
  receiptId?: string;
}

export type ReceiptStatus = "completed" | "pending" | "refunded";

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
  amountCents: number;
  currency: string;
  methodLabel: string;
  methodId?: string;
  orderId: string;
  captureId?: string;
  captureStatus: string;
  requestId: string;
  /** How many times this request reached PayPal, and whether every answer named the same order. */
  attempts: number;
  sameOrderEveryTime: boolean;
  shelfNote: string;
  budgetNote?: string;
  savedMethodId?: string;
  webhook?: { eventId: string; type: string; at: string };
  refund?: { id: string; status: string; amountCents?: number };
  status: ReceiptStatus;
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
  effect?: string;
}
