/**
 * The search queries that seed the replay's product list, by category.
 * Products are taken in search order, merged by title, and kept only when they
 * have a full, usable 90-day history. The resulting list is frozen in
 * data/replay/products.json and reused on every run.
 */
export interface CategorySeed {
  category: string;
  queries: string[];
  /** Stop once this many usable products are found. */
  target: number;
  /** Most history lookups to spend on this category. */
  maxHistoryCalls: number;
}

export const CATALOG: CategorySeed[] = [
  {
    category: "beauty-staples",
    queries: [
      "CeraVe moisturizing cream",
      "La Roche-Posay sunscreen",
      "Olaplex shampoo",
      "The Ordinary serum",
      "Cetaphil gentle cleanser",
      "Maybelline mascara",
    ],
    target: 16,
    maxHistoryCalls: 55,
  },
  {
    category: "kitchen-appliances",
    queries: ["air fryer", "blender", "drip coffee maker"],
    target: 7,
    maxHistoryCalls: 35,
  },
  {
    category: "headphones",
    queries: ["noise cancelling headphones", "wireless earbuds", "bluetooth speaker"],
    target: 7,
    maxHistoryCalls: 35,
  },
];
