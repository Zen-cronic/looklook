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
  "conditioner",
  "hair-oil",
  "lip-balm",
  "headphones",
  "blender",
  "coffee-maker",
  "air-fryer",
  "kettle",
  "toaster",
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
  /**
   * "equal" compares single values, with half credit for neighbouring values
   * on the attribute's scale or near list. "overlap" compares lists by the
   * share of the new item's values that the owned item already has.
   */
  kind: "equal" | "overlap";
  /** Ordered values; one step apart scores 0.5, two or more 0. */
  scale?: string[];
  /** Pairs that score 0.5 although they are not on a scale. */
  near?: Array<[string, string]>;
  /** Spellings folded onto a scale value before comparing. */
  aliases?: Record<string, string>;
  /** Values that stand for several at once (face-body is face and body), expanded before comparing. */
  expand?: Record<string, string[]>;
}

interface CategorySpec {
  policyGroup: PolicyGroup;
  budgetGroup: BudgetGroup;
  /**
   * The attribute that names the product type (what it is used for), worth
   * TYPE_WEIGHT. Absent: the category itself is the type, as for products
   * used one at a time (a cleanser, a setting spray).
   */
  type?: AttributeWeight;
  /** Details that refine the match. Weights sum to 1 - TYPE_WEIGHT. */
  details: AttributeWeight[];
}

/** Doing the same kind of job is half of "the same item"; the details are the other half. */
export const TYPE_WEIGHT = 0.5;

const FINISH = {
  scale: ["matte", "natural", "radiant"],
  aliases: { "soft-matte": "matte", satin: "natural", sheer: "natural", demi: "natural", dewy: "radiant", glow: "radiant", glowy: "radiant", luminous: "radiant", shine: "radiant", glossy: "radiant" },
};
const COVERAGE = { scale: ["sheer", "light", "medium", "full"] };
const SHADE_NEAR: Array<[string, string]> = [
  ["pink", "peach"],
  ["peach", "coral"],
  ["pink", "coral"],
  ["pink", "berry"],
  ["red", "berry"],
  ["nude", "brown"],
];
const unknownDetail = (key: string, weight: number): AttributeWeight => ({ key, weight, kind: "equal" });

/**
 * What decides whether a second item does the same job. The type is the main
 * active for serums (a hyaluronic serum and a retinol serum do different
 * jobs), where a sunscreen goes (a body sunscreen doesn't do a face
 * sunscreen's job; a face-and-body one does both), the shade family for
 * colour cosmetics people keep several of, the style for headphones and the
 * kind of appliance for kitchen tools. For
 * products used one at a time the category is the type. Details then compare
 * actives, finish, form, coverage and the like, with half credit for
 * neighbours (matte and natural, gel and gel cream, on-ear and over-ear).
 * Some details (a foundation's shade, a blender's capacity) are rarely
 * known; they still count, so knowing only the type never adds up to a
 * near-duplicate.
 */
export const CATEGORY_SPECS: Record<Category, CategorySpec> = {
  serum: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    type: { key: "primaryActive", weight: TYPE_WEIGHT, kind: "equal", aliases: { "ascorbic-acid": "vitamin-c", "l-ascorbic-acid": "vitamin-c", "sodium-hyaluronate": "hyaluronic-acid", retinoid: "retinol" } },
    details: [{ key: "actives", weight: 0.5, kind: "overlap" }],
  },
  moisturizer: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    details: [
      { key: "texture", weight: 0.3, kind: "equal", scale: ["gel", "gel-cream", "cream", "balm"], near: [["lotion", "cream"], ["lotion", "gel-cream"]] },
      { key: "actives", weight: 0.2, kind: "overlap" },
    ],
  },
  sunscreen: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    // Where it goes is the job: the share of the new one's areas the owned one already covers.
    type: { key: "area", weight: TYPE_WEIGHT, kind: "overlap", expand: { "face-body": ["face", "body"], "face-and-body": ["face", "body"] } },
    details: [
      { key: "filter", weight: 0.25, kind: "equal" },
      { key: "spfBand", weight: 0.15, kind: "equal", scale: ["under-30", "30-49", "50+"] },
      { key: "finish", weight: 0.1, kind: "equal", ...FINISH },
    ],
  },
  cleanser: {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    details: [
      { key: "form", weight: 0.3, kind: "equal", scale: ["foam", "gel", "cream", "balm"], near: [["milk", "cream"], ["lotion", "cream"], ["oil", "balm"], ["gel-cream", "gel"], ["gel-cream", "cream"]] },
      { key: "actives", weight: 0.2, kind: "overlap" },
    ],
  },
  foundation: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    details: [
      { key: "finish", weight: 0.15, kind: "equal", ...FINISH },
      { key: "coverage", weight: 0.15, kind: "equal", ...COVERAGE },
      { key: "form", weight: 0.1, kind: "equal", near: [["liquid", "cream"], ["cream", "stick"], ["stick", "powder"]] },
      unknownDetail("shade", 0.1),
    ],
  },
  concealer: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    details: [
      { key: "finish", weight: 0.2, kind: "equal", ...FINISH },
      { key: "coverage", weight: 0.2, kind: "equal", ...COVERAGE },
      unknownDetail("shade", 0.1),
    ],
  },
  lipstick: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    type: { key: "shadeFamily", weight: TYPE_WEIGHT, kind: "equal", near: SHADE_NEAR },
    details: [
      { key: "finish", weight: 0.3, kind: "equal", ...FINISH },
      { key: "form", weight: 0.2, kind: "equal", near: [["bullet", "liquid"]] },
    ],
  },
  "lip-oil": {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    details: [
      { key: "tint", weight: 0.25, kind: "equal", scale: ["clear", "tinted"] },
      { key: "shadeFamily", weight: 0.25, kind: "equal", near: SHADE_NEAR },
    ],
  },
  blush: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    type: { key: "shadeFamily", weight: TYPE_WEIGHT, kind: "equal", near: SHADE_NEAR },
    details: [
      { key: "form", weight: 0.3, kind: "equal", near: [["cream", "liquid"], ["cream", "stick"], ["powder", "stick"]] },
      { key: "finish", weight: 0.2, kind: "equal", ...FINISH },
    ],
  },
  "setting-spray": {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    details: [{ key: "finish", weight: 0.3, kind: "equal", ...FINISH }, unknownDetail("hold", 0.2)],
  },
  mascara: {
    policyGroup: "beauty",
    budgetGroup: "makeup",
    details: [
      { key: "effect", weight: 0.3, kind: "equal", near: [["volumizing", "lengthening"], ["lengthening", "curling"]] },
      { key: "formula", weight: 0.2, kind: "equal" },
    ],
  },
  shampoo: {
    policyGroup: "beauty",
    budgetGroup: "haircare",
    details: [{ key: "purpose", weight: 0.3, kind: "equal" }, unknownDetail("hairType", 0.2)],
  },
  conditioner: {
    policyGroup: "beauty",
    budgetGroup: "haircare",
    details: [
      { key: "purpose", weight: 0.25, kind: "equal" },
      // Rinse-out, leave-in or a mask: a neighbouring use is half the job.
      { key: "use", weight: 0.25, kind: "equal", scale: ["leave-in", "rinse-out", "mask"] },
    ],
  },
  "hair-oil": {
    policyGroup: "beauty",
    budgetGroup: "haircare",
    details: [
      { key: "purpose", weight: 0.3, kind: "equal" },
      { key: "form", weight: 0.2, kind: "equal", near: [["oil", "serum"]] },
    ],
  },
  "lip-balm": {
    policyGroup: "beauty",
    budgetGroup: "skincare",
    details: [
      { key: "tint", weight: 0.3, kind: "equal", scale: ["clear", "tinted"] },
      { key: "shadeFamily", weight: 0.2, kind: "equal", near: SHADE_NEAR },
    ],
  },
  headphones: {
    policyGroup: "electronics",
    budgetGroup: "electronics",
    type: { key: "style", weight: TYPE_WEIGHT, kind: "equal", near: [["on-ear", "over-ear"]] },
    details: [{ key: "noiseCancelling", weight: 0.3, kind: "equal" }, unknownDetail("connection", 0.2)],
  },
  blender: {
    policyGroup: "general",
    budgetGroup: "kitchen",
    type: { key: "type", weight: TYPE_WEIGHT, kind: "equal" },
    details: [unknownDetail("capacity", 0.25), unknownDetail("power", 0.25)],
  },
  "coffee-maker": {
    policyGroup: "general",
    budgetGroup: "kitchen",
    type: { key: "type", weight: TYPE_WEIGHT, kind: "equal" },
    details: [unknownDetail("capacity", 0.25), unknownDetail("features", 0.25)],
  },
  "air-fryer": {
    policyGroup: "general",
    budgetGroup: "kitchen",
    type: { key: "type", weight: TYPE_WEIGHT, kind: "equal" },
    details: [unknownDetail("capacity", 0.25), unknownDetail("features", 0.25)],
  },
  kettle: {
    policyGroup: "general",
    budgetGroup: "kitchen",
    type: { key: "type", weight: TYPE_WEIGHT, kind: "equal", aliases: { "electric-kettle": "electric", "stovetop-kettle": "stovetop", "stove-top": "stovetop" } },
    details: [unknownDetail("capacity", 0.25), unknownDetail("features", 0.25)],
  },
  toaster: {
    policyGroup: "general",
    budgetGroup: "kitchen",
    type: { key: "type", weight: TYPE_WEIGHT, kind: "equal", aliases: { "pop-up-toaster": "pop-up", oven: "toaster-oven" } },
    details: [unknownDetail("capacity", 0.25), unknownDetail("features", 0.25)],
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
  conditioner: "conditioner",
  conditioners: "conditioner",
  "hair-conditioners": "conditioner",
  "leave-in-conditioners": "conditioner",
  "hair-oils": "hair-oil",
  "hair-oil": "hair-oil",
  "hair-serums": "hair-oil",
  "hair-oils-serums": "hair-oil",
  "lip-balms": "lip-balm",
  "lip-balm": "lip-balm",
  "lip-care": "lip-balm",
  "lip-treatments": "lip-balm",
  headphones: "headphones",
  "in-ear-headphones": "headphones",
  "over-ear-headphones": "headphones",
  "on-ear-headphones": "headphones",
  blenders: "blender",
  "countertop-blenders": "blender",
  "coffee-makers": "coffee-maker",
  "drip-coffee-makers": "coffee-maker",
  "air-fryers": "air-fryer",
  kettles: "kettle",
  "electric-kettles": "kettle",
  "tea-kettles": "kettle",
  toasters: "toaster",
  "toaster-ovens": "toaster",
};

export function categoryFromSlug(slug: string | undefined, path: string[] = []): Category | undefined {
  for (const s of [slug, ...[...path].reverse()]) {
    if (s && SLUG_MAP[s]) return SLUG_MAP[s];
  }
  return undefined;
}
