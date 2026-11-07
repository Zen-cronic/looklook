import { brandOf } from "../channel3/dedupe";
import type { Product } from "../channel3/types";
import { categoryFromSlug, isCategory, type Category } from "../shelf/categories";
import type { ProductFacts } from "../verdict/types";
import { toAttributes, type ScreenshotFields } from "./schema";

/** Below this, or with a close runner-up, the user confirms the product before any verdict. */
export const CONFIRM_BELOW = 0.7;
/** A runner-up within this margin of the best match is a tie. */
export const TIE_MARGIN = 0.05;
/** A barely legible read caps confidence here, whatever the catalogue says. */
export const LOW_LEGIBILITY = 0.5;

const STOP = new Set(["the", "and", "with", "for", "of", "a", "by", "new", "ml", "oz", "fl"]);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/moisturis/g, "moisturiz")
      .split(/[^a-z0-9%+.]+/)
      .map((t) => t.replace(/^[.+]+|[.+]+$/g, ""))
      .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function brandScore(read: string | null, product: Product): number {
  const b = brandOf(product);
  if (!read || !b) return 0;
  const x = [...tokens(read)].join(" ");
  const y = [...tokens(b)].join(" ");
  if (!x || !y) return 0;
  if (x === y) return 1;
  return x.includes(y) || y.includes(x) ? 0.8 : 0;
}

function nameScore(read: string | null, product: Product): number {
  if (!read) return 0;
  const brand = tokens(brandOf(product));
  const title = new Set([...tokens(product.title)].filter((t) => !brand.has(t)));
  const name = new Set([...tokens(read)].filter((t) => !brand.has(t)));
  return jaccard(name, title);
}

function priceScore(price: ScreenshotFields["price"], product: Product): number | undefined {
  const offer = product.offers?.[0]?.price.price;
  if (!price || !offer) return undefined;
  return Math.max(0, 1 - Math.abs(price.amount - offer) / offer);
}

export interface Candidate {
  product: Product;
  confidence: number;
  parts: { brand: number; name: number; price?: number };
}

/** Deterministic score of one catalogue product against the read fields. */
export function scoreCandidate(fields: ScreenshotFields, product: Product): Candidate {
  const brand = brandScore(fields.brand, product);
  const name = nameScore(fields.productName, product);
  const price = priceScore(fields.price, product);
  let confidence = price === undefined ? 0.4 * brand + 0.6 * name : 0.35 * brand + 0.55 * name + 0.1 * price;
  if (fields.legibility < LOW_LEGIBILITY) confidence = Math.min(confidence, fields.legibility);
  return { product, confidence: Math.round(confidence * 1000) / 1000, parts: { brand, name, ...(price === undefined ? {} : { price }) } };
}

export interface MatchResult {
  best?: Candidate;
  alternatives: Candidate[];
  category: Category | undefined;
  needsConfirmation: boolean;
  why: Array<"no-product" | "no-results" | "low-confidence" | "close-runner-up" | "unknown-category">;
}

/**
 * Pick the catalogue product the screenshot shows. The catalogue's category
 * wins over the reader's guess when it maps to one of ours.
 */
export function pickMatch(fields: ScreenshotFields, products: Product[]): MatchResult {
  const why: MatchResult["why"] = [];
  if (!fields.isProduct) return { alternatives: [], category: undefined, needsConfirmation: true, why: ["no-product"] };
  const ranked = products.map((p) => scoreCandidate(fields, p)).sort((a, b) => b.confidence - a.confidence || a.product.id.localeCompare(b.product.id));
  const [best, ...rest] = ranked;
  if (!best) why.push("no-results");
  else {
    if (best.confidence < CONFIRM_BELOW) why.push("low-confidence");
    const runnerUp = rest[0];
    if (runnerUp && best.confidence - runnerUp.confidence < TIE_MARGIN && runnerUp.product.title.toLowerCase() !== best.product.title.toLowerCase()) why.push("close-runner-up");
  }
  const fromCatalogue = best ? categoryFromSlug(best.product.category?.slug, best.product.category?.path?.map((p) => p.slug)) : undefined;
  const category = fromCatalogue ?? (isCategory(fields.category) ? fields.category : undefined);
  if (!category) why.push("unknown-category");
  return { best, alternatives: rest.slice(0, 3), category, needsConfirmation: why.length > 0, why };
}

/** The search query built from the read fields. */
export function searchQuery(fields: ScreenshotFields): string | undefined {
  const q = [fields.brand, fields.productName].filter(Boolean).join(" ").trim();
  return q || undefined;
}

/**
 * Structured facts for the verdict engine. Identity confidence is the match
 * confidence; if the user hasn't confirmed a low-confidence match the engine
 * will answer ask.
 */
export function toProductFacts(fields: ScreenshotFields, match: MatchResult): ProductFacts {
  const p = match.best?.product;
  return {
    brand: (p && brandOf(p)) || fields.brand || "",
    name: fields.productName ?? p?.title ?? "",
    category: match.category,
    attributes: toAttributes(fields.attributes),
    priceShown: fields.price?.amount ?? null,
    identityConfidence: match.needsConfirmation ? Math.min(match.best?.confidence ?? 0, CONFIRM_BELOW - 0.01) : (match.best?.confidence ?? 0),
  };
}
