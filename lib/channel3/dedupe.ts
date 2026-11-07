import type { Offer, Product } from "./types";

const FILLER = new Set(["the", "a", "an", "new", "by", "for", "with", "and", "of", "in", "size", "full", "pack", "count", "ct"]);

/**
 * A comparable key for a product title: lowercase, accents and trademark signs
 * removed, sizes joined to their unit ("16 fl. oz." -> "16oz"), filler words
 * and the brand name dropped, and the remaining words sorted.
 */
export function normalizeTitle(title: string, brand?: string): string {
  let t = title
    .replace(/[\u00ae\u2122\u00a9\u2120]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d)\s*,\s*(\d{3})/g, "$1$2");
  t = t
    .replace(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz\.?|fluid\s+ounces?|ounces?|oz\.?)(?![a-z])/g, "$1oz")
    .replace(/(\d+(?:\.\d+)?)\s*(?:ml|milliliters?|millilitres?)(?![a-z])/g, "$1ml")
    .replace(/(\d+(?:\.\d+)?)\s*(?:g|grams?)(?![a-z])/g, "$1g")
    .replace(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)(?![a-z])/g, "$1lb");
  t = t.replace(/[^a-z0-9.]+/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ");
  const brandWords = new Set(brand ? normalizeWords(brand) : []);
  const words = t.split(/\s+/).filter((w) => w && !FILLER.has(w) && !brandWords.has(w));
  return [...new Set(words)].sort().join(" ");
}

function normalizeWords(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function brandOf(p: Product): string {
  return p.brands?.[0]?.name ?? "";
}

export function productKey(p: Product): string {
  const brand = brandOf(p);
  return `${normalizeWords(brand).join(" ")}|${normalizeTitle(p.title, brand)}`;
}

export interface ProductGroup {
  key: string;
  /** The listing with the most offers. */
  product: Product;
  ids: string[];
  /** Cheapest offer per seller across the group. */
  offers: Offer[];
}

/** Merge listings of the same item that come back under different product ids. */
export function dedupeProducts(products: Product[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const p of products) {
    const key = productKey(p);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, product: p, ids: [p.id], offers: [...(p.offers ?? [])] });
      continue;
    }
    if (!g.ids.includes(p.id)) g.ids.push(p.id);
    if ((p.offers?.length ?? 0) > (g.product.offers?.length ?? 0)) g.product = p;
    g.offers.push(...(p.offers ?? []));
  }
  for (const g of groups.values()) {
    const bySeller = new Map<string, Offer>();
    for (const o of g.offers) {
      const cur = bySeller.get(o.domain);
      if (!cur || o.price.price < cur.price.price) bySeller.set(o.domain, o);
    }
    g.offers = [...bySeller.values()].sort((a, b) => a.price.price - b.price.price);
  }
  return [...groups.values()];
}
