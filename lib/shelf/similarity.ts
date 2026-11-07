import { CATEGORY_SPECS, TYPE_WEIGHT, type AttributeValue, type AttributeWeight, type Attributes, type Category } from "./categories";
import type { ShelfItem } from "./types";

/** At or above: the shopper already owns something that does the same job. */
export const NEAR_DUPLICATE = 0.8;
/** At or above (and below NEAR_DUPLICATE): a partial overlap. */
export const OVERLAP = 0.6;
/** Credit for a detail that is unknown on either side: neither evidence for nor against. */
export const UNKNOWN_CREDIT = 0.5;

export interface Comparable {
  category: Category;
  attributes: Attributes;
}

export interface SimilarityResult {
  score: number;
  /** Attribute keys that matched fully (the type key, when the category has one, comes first). */
  matched: string[];
  /** Attribute keys unknown on one side (scored at UNKNOWN_CREDIT). */
  missing: string[];
  /** True when both items are the same product type (see CATEGORY_SPECS). */
  sameType: boolean;
}

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function asSet(v: AttributeValue | undefined, spec: AttributeWeight): Set<string> {
  if (v === undefined) return new Set();
  return new Set(
    (Array.isArray(v) ? v : [v])
      .map(norm)
      .filter(Boolean)
      .map((x) => spec.aliases?.[x] ?? x)
      .flatMap((x) => spec.expand?.[x] ?? [x]),
  );
}

/** Share of the new item's values that the owned item already has. */
function coveredShare(candidate: Set<string>, owned: Set<string>): number {
  let shared = 0;
  for (const x of candidate) if (owned.has(x)) shared += 1;
  return shared / candidate.size;
}

function compareValue(a: string, b: string, spec: AttributeWeight): number {
  if (a === b) return 1;
  const ia = spec.scale?.indexOf(a) ?? -1;
  const ib = spec.scale?.indexOf(b) ?? -1;
  if (ia >= 0 && ib >= 0) return Math.max(0, 1 - 0.5 * Math.abs(ia - ib));
  if (spec.near?.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 0.5;
  return 0;
}

/** 0..1 agreement on one attribute (a: the new item, b: the owned one), or undefined when either side doesn't know it. */
export function compareAttribute(spec: AttributeWeight, a: AttributeValue | undefined, b: AttributeValue | undefined): number | undefined {
  const av = asSet(a, spec);
  const bv = asSet(b, spec);
  if (av.size === 0 || bv.size === 0) return undefined;
  if (spec.kind === "overlap") return coveredShare(av, bv);
  if (av.size === 1 && bv.size === 1) return compareValue([...av][0], [...bv][0], spec);
  return av.size === bv.size && [...av].every((x) => bv.has(x)) ? 1 : 0;
}

/**
 * Deterministic similarity of a new item (a) to an owned one (b): does what
 * you own already do this item's job? Different categories score 0.
 * Within a category the score is TYPE_WEIGHT x the type agreement plus the
 * weighted agreement of the details. Neighbouring values (matte and natural,
 * gel and cream cleanser) get half credit; a detail unknown on either side
 * gets UNKNOWN_CREDIT, so an item known only by its type reaches at most
 * 0.75: an overlap, never a near-duplicate. Lists of actives count the share
 * of the new item's actives the owned item already has, so this direction
 * matters; every other attribute compares the same both ways.
 */
export function similarity(a: Comparable, b: Comparable): SimilarityResult {
  if (a.category !== b.category) return { score: 0, matched: [], missing: [], sameType: false };
  const spec = CATEGORY_SPECS[a.category];
  const matched: string[] = [];
  const missing: string[] = [];
  let sum = 0;
  let sameType = true;
  const add = (attr: AttributeWeight) => {
    const s = compareAttribute(attr, a.attributes[attr.key], b.attributes[attr.key]);
    if (s === undefined) {
      missing.push(attr.key);
      sum += attr.weight * UNKNOWN_CREDIT;
      return undefined;
    }
    if (s === 1) matched.push(attr.key);
    sum += attr.weight * s;
    return s;
  };
  if (spec.type) sameType = add(spec.type) === 1;
  else sum += TYPE_WEIGHT;
  for (const d of spec.details) add(d);
  return { score: Math.round(sum * 1000) / 1000, matched, missing, sameType };
}

/**
 * Same product type: the same category and, where the category has a type
 * attribute, the same known value. For a type compared as a list (where a
 * sunscreen goes), a counts as b's type when b already covers all of a's.
 */
export function sameType(a: Comparable, b: Comparable): boolean {
  return similarity(a, b).sameType;
}

/** The new item does the whole job of the one it would replace (a face-and-body sunscreen replaces a face one; a face one doesn't replace a face-and-body one). */
export function replacesJob(newItem: Comparable, owned: Comparable): boolean {
  return sameType(owned, newItem);
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
