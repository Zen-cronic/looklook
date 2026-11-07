import type { PriceBand } from "../channel3/band";
import type { OpenedReturnPolicy } from "../policies";
import type { Attributes, BudgetGroup, Category } from "../shelf/categories";
import type { ShelfItem } from "../shelf/types";

export type Verdict = "skip" | "wait" | "buy" | "ask";

/** Every rule that can decide a verdict. The first one that fires decides. */
export type RuleId =
  | "identity-unconfirmed"
  | "owns-unopened"
  | "run-out-unknown"
  | "not-needed-yet"
  | "owns-similar"
  | "overlap-non-returnable"
  | "price-unknown"
  | "over-budget"
  | "no-price-history"
  | "above-usual-price"
  | "replacing-run-out"
  | "clear-to-buy";

/** Structured facts about the item being considered. Nothing here is free text from a model. */
export interface ProductFacts {
  brand: string;
  name: string;
  /** Undefined when the category could not be resolved. */
  category: Category | undefined;
  attributes: Attributes;
  /** The price on the screenshot or listing; null when none was shown. */
  priceShown: number | null;
  /** 0..1: how sure the reader and catalogue match are about which product this is. */
  identityConfidence: number;
  /** The user confirmed the product; overrides a low confidence. */
  identityConfirmed?: boolean;
}

export interface VerdictInput {
  product: ProductFacts;
  /** Store id, name, domain or URL; unknown stores use the brand-site fallback policy. */
  store: string | undefined;
  shelf: ShelfItem[];
  /** Money left this period per budget group. A group that is missing here has no limit set. */
  budgets?: Partial<Record<BudgetGroup, number>>;
  priceBand?: PriceBand | null;
  /** YYYY-MM-DD. */
  today: string;
}

export interface ShelfEvidence {
  itemId: string;
  brand: string;
  name: string;
  /** same-product, or the similarity tier. */
  relation: "same-product" | "near-duplicate" | "overlap" | "different";
  score: number;
  matched: string[];
  opened: boolean;
  runOutDate: string | null;
}

export interface Evidence {
  /** The rules checked, in order, ending with the one that fired. */
  trace: RuleId[];
  shelf?: ShelfEvidence;
  /** The shelf item this purchase would replace, when one runs out soon. */
  replaces?: ShelfEvidence & { daysLeft: number };
  policy?: Pick<OpenedReturnPolicy, "retailerId" | "retailerName" | "group" | "returnableOpened" | "windowDays" | "sourceUrl" | "checkedOn" | "fallback">;
  budget?: { group: BudgetGroup; remaining: number; price: number };
  price?: { shown: number; typical?: number; low?: number; target?: number; usable: boolean; asOf?: string };
  /** For wait: the date to look again, and the latest date to buy by when replacing. */
  waitUntil?: string;
  buyBy?: string;
}

export interface Decision {
  verdict: Verdict;
  rule: RuleId;
  /** Extra facts worth showing (e.g. "non-returnable-opened"); they never change the verdict. */
  flags: string[];
  evidence: Evidence;
}
