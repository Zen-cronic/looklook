/**
 * Product categories the app understands, with the attributes that make
 * two items "the same job" and the groups used for return policies and budgets.
 */

export const CATEGORIES = [
  "serum",
  "moisturizer",
  "sunscreen",
  "cleanser",
  "foundation",
  "concealer",
  "lipstick",
  "lip-oil",
  "blush",
  "setting-spray",
  "mascara",
  "shampoo",
  "headphones",
  "blender",
  "coffee-maker",
  "air-fryer",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Return policies are written per group, not per category. */
export type PolicyGroup = "beauty" | "electronics" | "general";

/** Budgets are set per group of categories. */
export type BudgetGroup = "skincare" | "makeup" | "haircare" | "kitchen" | "electronics";

export type AttributeValue = string | string[];
export type Attributes = Partial<Record<string, AttributeValue>>;

export interface AttributeWeight {
  key: string;
  weight: number;
  /** "equal" compares single values; "overlap" scores shared values (Jaccard). */
  kind: "equal" | "overlap";
}

interface CategorySpec {
  policyGroup: PolicyGroup;
  budgetGroup: BudgetGroup;
  /** Weights sum to 1. */
  attributes: AttributeWeight[];
}

/**
 * Key attributes per category. Weights reflect what decides whether a second
 * item does the same job: the main active for serums, the filter and area for
 * sunscreen, the shade family for colour cosmetics, the form for appliances.
 */
export const CATEGORY_SPECS: Record<Category, CategorySpec> = {
  serum: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    attributes: [
      { key: "primaryActive", weight: 0.7, kind: "equal" },
      { key: "actives", weight: 0.3, kind: "overlap" },
    ],
  },
  moisturizer: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    attributes: [
      { key: "texture", weight: 0.6, kind: "equal" },
      { key: "actives", weight: 0.4, kind: "overlap" },
    ],
  },
  sunscreen: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    attributes: [
      { key: "filter", weight: 0.35, kind: "equal" },
      { key: "area", weight: 0.3, kind: "equal" },
      { key: "spfBand", weight: 0.2, kind: "equal" },
      { key: "finish", weight: 0.15, kind: "equal" },
    ],
  },
  cleanser: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    attributes: [
      { key: "form", weight: 0.6, kind: "equal" },
      { key: "actives", weight: 0.4, kind: "overlap" },
    ],
  },
  foundation: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "finish", weight: 0.4, kind: "equal" },
      { key: "coverage", weight: 0.3, kind: "equal" },
      { key: "form", weight: 0.3, kind: "equal" },
    ],
  },
  concealer: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "finish", weight: 0.5, kind: "equal" },
      { key: "coverage", weight: 0.5, kind: "equal" },
    ],
  },
  lipstick: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "shadeFamily", weight: 0.7, kind: "equal" },
      { key: "finish", weight: 0.3, kind: "equal" },
    ],
  },
  "lip-oil": {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "tint", weight: 0.5, kind: "equal" },
      { key: "shadeFamily", weight: 0.5, kind: "equal" },
    ],
  },
  blush: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "shadeFamily", weight: 0.6, kind: "equal" },
      { key: "form", weight: 0.4, kind: "equal" },
    ],
  },
  "setting-spray": {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [{ key: "finish", weight: 1, kind: "equal" }],
  },
  mascara: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    attributes: [
      { key: "effect", weight: 0.6, kind: "equal" },
      { key: "formula", weight: 0.4, kind: "equal" },
    ],
  },
  shampoo: {
    policyGroup: "beauty",
    budgetGroup: "haircare",
    attributes: [{ key: "purpose", weight: 1, kind: "equal" }],
  },
  headphones: {
    policyGroup: "electronics",
    budgetGroup: "electronics",
    attributes: [
      { key: "style", weight: 0.6, kind: "equal" },
      { key: "noiseCancelling", weight: 0.4, kind: "equal" },
    ],
  },
  blender: {
    policyGroup: "general",
    budgetGroup: "kitchen",
    attributes: [{ key: "type", weight: 1, kind: "equal" }],
  },
  "coffee-maker": {
    policyGroup: "general",
    budgetGroup: "kitchen",
    attributes: [{ key: "type", weight: 1, kind: "equal" }],
  },
  "air-fryer": {
    policyGroup: "general",
    budgetGroup: "kitchen",
    attributes: [{ key: "type", weight: 1, kind: "equal" }],
  },
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function policyGroupOf(category: Category): PolicyGroup {
  return CATEGORY_SPECS[category].policyGroup;
}

export function budgetGroupOf(category: Category): BudgetGroup {
  return CATEGORY_SPECS[category].budgetGroup;
}

/** Catalogue category slugs mapped to ours. Unmapped slugs return undefined (the user is asked). */
const SLUG_MAP: Record<string, Category> = {
  "face-serums": "serum",
  "face-moisturizers": "moisturizer",
  moisturizers: "moisturizer",
  sunscreen: "sunscreen",
  "facial-cleansers": "cleanser",
  foundations: "foundation",
  concealers: "concealer",
  "foundations-concealers": "concealer",
  lipstick: "lipstick",
  "lip-oils": "lip-oil",
  blushes: "blush",
  "makeup-finishing-sprays": "setting-spray",
  mascara: "mascara",
  shampoo: "shampoo",
  shampoos: "shampoo",
  headphones: "headphones",
  "in-ear-headphones": "headphones",
  "over-ear-headphones": "headphones",
  "on-ear-headphones": "headphones",
  blenders: "blender",
  "countertop-blenders": "blender",
  "coffee-makers": "coffee-maker",
  "drip-coffee-makers": "coffee-maker",
  "air-fryers": "air-fryer",
};

export function categoryFromSlug(slug: string | undefined, path: string[] = []): Category | undefined {
  for (const s of [slug, ...[...path].reverse()]) {
    if (s && SLUG_MAP[s]) return SLUG_MAP[s];
  }
  return undefined;
}
