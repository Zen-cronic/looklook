import { CATEGORY_SPECS, type AttributeValue, type Attributes, type Category } from "./categories";
import type { ShelfItem } from "./types";

/** Same category alone scores this much; key attributes fill the rest. */
export const CATEGORY_BASE = 0.4;
/** At or above: the shopper already owns something that does the same job. */
export const NEAR_DUPLICATE = 0.8;
/** At or above (and below NEAR_DUPLICATE): a partial overlap. */
export const OVERLAP = 0.6;

export interface Comparable {
  category: Category;
  attributes: Attributes;
}

export interface SimilarityResult {
  score: number;
  /** Attribute keys that matched fully. */
  matched: string[];
  /** Attribute keys missing on one side (scored as no match). */
  missing: string[];
}

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function asSet(v: AttributeValue | undefined): Set<string> {
  if (v === undefined) return new Set();
  return new Set((Array.isArray(v) ? v : [v]).map(norm).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Deterministic similarity between two items. Different categories score 0.
 * Within a category: CATEGORY_BASE + (1 - CATEGORY_BASE) x the weighted share
 * of key attributes that match. A missing attribute counts as no match, so a
 * thin description never makes an item look like a duplicate.
 */
export function similarity(a: Comparable, b: Comparable): SimilarityResult {
  if (a.category !== b.category) return { score: 0, matched: [], missing: [] };
  const spec = CATEGORY_SPECS[a.category];
  let sum = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const { key, weight, kind } of spec.attributes) {
    const av = asSet(a.attributes[key]);
    const bv = asSet(b.attributes[key]);
    if (av.size === 0 || bv.size === 0) {
      missing.push(key);
      continue;
    }
    const s = kind === "overlap" ? jaccard(av, bv) : av.size === bv.size && [...av].every((x) => bv.has(x)) ? 1 : 0;
    if (s === 1) matched.push(key);
    sum += weight * s;
  }
  const score = Math.round((CATEGORY_BASE + (1 - CATEGORY_BASE) * sum) * 1000) / 1000;
  return { score, matched, missing };
}

export interface ShelfMatch extends SimilarityResult {
  item: ShelfItem;
}

/** Shelf items in the same category, best first (ties broken by id for a stable order). */
export function rankShelf(target: Comparable, shelf: ShelfItem[]): ShelfMatch[] {
  return shelf
    .map((item) => ({ item, ...similarity(target, item) }))
    .filter((m) => m.score > 0)
    .sort((x, y) => y.score - x.score || x.item.id.localeCompare(y.item.id));
}

const SPELLING: Array<[RegExp, string]> = [
  [/moisturis/g, "moisturiz"],
  [/colour/g, "color"],
];

/**
 * A key for "the same product" across sizes and listings: brand plus the
 * product name without sizes, pack words or the brand repeated in the name.
 */
export function identityKey(brand: string, name: string): string {
  const b = brand.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let n = name.toLowerCase();
  for (const [re, to] of SPELLING) n = n.replace(re, to);
  n = n
    .replace(/\b\d+(\.\d+)?\s*(ml|g|oz|fl\.?\s*oz|l|lb|ct|count|pack)\b/g, " ")
    .replace(/\bwith pump\b|\bpump\b|\btravel size\b|\bmini\b|\brefill\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  if (b && n.trim().startsWith(`${b} `)) n = n.trim().slice(b.length);
  return `${b}|${n.replace(/\s+/g, " ").trim()}`;
}

export function sameProduct(a: { brand: string; name: string }, b: { brand: string; name: string }): boolean {
  return identityKey(a.brand, a.name) === identityKey(b.brand, b.name);
}
