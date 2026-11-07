import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { PriceBand } from "../channel3/band";
import { brandOf } from "../channel3/dedupe";
import type { Product } from "../channel3/types";
import { categoryFromSlug, isCategory } from "../shelf/categories";
import type { ShelfItem } from "../shelf/types";
import { decide } from "../verdict/engine";
import { writeReason } from "../verdict/reason";
import type { ProductFacts } from "../verdict/types";
import { pickMatch, searchQuery, toProductFacts, type MatchResult } from "../vision/match";
import { readListing, readScreenshot, type ScreenshotImage } from "../vision/read";
import type { ScreenshotFields } from "../vision/schema";
import { remainingBudgets } from "./budgets";
import { reasonKey } from "./refresh";
import type { Budgets, CheckCandidate, CheckRecord, ProductCard } from "./types";

/** Everything the check pipeline talks to, so tests can stand in for the model and the catalogue. */
export interface CheckServices {
  anthropic: Pick<Anthropic, "messages">;
  search(query: string): Promise<Product[]>;
  lookup(url: string): Promise<Product>;
  /** Cleaned price band, or null when the history isn't usable. */
  priceBand(productId: string): Promise<PriceBand | null>;
  cache?: { get<T>(kind: string, key: string): T | undefined; set(kind: string, key: string, value: unknown): void };
  modelReason?: boolean;
}

/** What the reader and the catalogue said, before any shopper data is used. Safe to cache. */
export interface Reading {
  fields: ScreenshotFields;
  products: Product[];
}


export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Keep only what the app shows or matches on. */
export function trimProduct(p: Product): Product {
  const main = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brands: p.brands?.slice(0, 1),
    category: p.category ? { slug: p.category.slug, path: p.category.path?.map((x) => ({ slug: x.slug })) } : undefined,
    offers: p.offers?.slice(0, 3).map((o) => ({ url: o.url, domain: o.domain, price: o.price, availability: o.availability })),
    images: main ? [{ url: main.url, is_main_image: true }] : undefined,
    variants: p.variants,
  };
}

/** The offer at the store the shopper saw, when the catalogue has one. */
function offerFor(p: Product, store?: string) {
  const key = store?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[ .]/)[0];
  return (key && p.offers?.find((o) => o.domain.toLowerCase().startsWith(key))) || p.offers?.[0];
}

export function productCard(p: Product, store?: string): ProductCard {
  const offer = offerFor(p, store);
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brand: brandOf(p),
    imageUrl: image?.url,
    offerUrl: offer?.url,
    offerDomain: offer?.domain,
    offerPrice: offer?.price.price,
    category: categoryFromSlug(p.category?.slug, p.category?.path?.map((x) => x.slug)),
  };
}

export async function readImage(image: ScreenshotImage, services: CheckServices): Promise<Reading> {
  const key = sha256(image.data);
  const hit = services.cache?.get<Reading>("reading", key);
  if (hit) return hit;
  const { fields } = await readScreenshot(image, { client: services.anthropic });
  const query = searchQuery(fields);
  const products = fields.isProduct && query ? (await services.search(query)).map(trimProduct) : [];
  const reading = { fields, products };
  services.cache?.set("reading", key, reading);
  return reading;
}

export function normaliseLink(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CheckInputError("That doesn't look like a link. Paste the full store address, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new CheckInputError("Only web links (https://) can be checked.");
  return url;
}

export class CheckInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckInputError";
  }
}

export async function readLink(raw: string, services: CheckServices): Promise<Reading> {
  const url = normaliseLink(raw);
  const key = sha256(url.toString());
  const hit = services.cache?.get<Reading>("reading", key);
  if (hit) return hit;
  let product: Product;
  try {
    product = trimProduct(await services.lookup(url.toString()));
  } catch {
    throw new CheckInputError("We couldn't find that link in the product catalogue. Try a screenshot of the page instead.");
  }
  const host = url.hostname.replace(/^www\./, "");
  const offer = product.offers?.find((o) => host.endsWith(o.domain)) ?? product.offers?.[0];
  const { fields } = await readListing(
    {
      title: product.title,
      brand: brandOf(product),
      category: product.category?.slug,
      price: offer ? { amount: offer.price.price, currency: offer.price.currency } : undefined,
      store: host,
    },
    { client: services.anthropic },
  );
  const reading = { fields: { ...fields, store: fields.store ?? host }, products: [product] };
  services.cache?.set("reading", key, reading);
  return reading;
}

function candidatesOf(match: MatchResult, store?: string): CheckCandidate[] {
  return [match.best, ...match.alternatives].filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ product: productCard(c.product, store), confidence: c.confidence }));
}

export interface ShopperContext {
  shelf: ShelfItem[];
  budgets: Budgets;
  today: string;
}

async function bandFor(productId: string | undefined, services: CheckServices): Promise<PriceBand | null> {
  if (!productId) return null;
  try {
    return await services.priceBand(productId);
  } catch {
    return null;
  }
}

/** Decide and word the verdict for facts the shopper has (or the matcher has) settled. */
export async function verdictFor(
  facts: ProductFacts,
  store: string | undefined,
  band: PriceBand | null,
  ctx: ShopperContext,
  services: Pick<CheckServices, "anthropic" | "modelReason" | "cache">,
) {
  const decision = decide({ product: facts, store, shelf: ctx.shelf, budgets: remainingBudgets(ctx.budgets, ctx.today), priceBand: band, today: ctx.today });
  const key = reasonKey(decision, facts);
  const cached = services.cache?.get<{ text: string; source: "model" | "template" }>("reason", key);
  if (cached) return { decision, reason: cached };
  const reason = await writeReason(decision, facts, services.modelReason ? { client: services.anthropic } : {});
  if (reason.source === "model") services.cache?.set("reason", key, reason);
  return { decision, reason };
}

/** Turn a reading into a stored check for one shopper. */
export async function buildCheck(
  reading: Reading,
  input: CheckRecord["input"],
  ctx: ShopperContext,
  services: CheckServices,
  now = new Date(),
): Promise<CheckRecord> {
  const match = pickMatch(reading.fields, reading.products);
  const facts = toProductFacts(reading.fields, match);
  const best = match.best && !match.needsConfirmation ? match.best.product : undefined;
  const band = await bandFor(best?.id, services);
  const store = reading.fields.store ?? best?.offers?.[0]?.domain ?? undefined;
  const { decision, reason } = await verdictFor(facts, store, band, ctx, services);
  return {
    id: crypto.randomUUID().slice(0, 12),
    createdAt: now.toISOString(),
    decidedOn: ctx.today,
    input,
    fields: reading.fields,
    candidates: candidatesOf(match, reading.fields.store ?? undefined),
    product: best ? productCard(best, reading.fields.store ?? undefined) : undefined,
    needsConfirmation: match.needsConfirmation,
    confirmWhy: match.why,
    facts,
    store,
    band,
    decision,
    reason,
  };
}

/** The shopper picked which product it is: decide again with the identity confirmed. */
export async function confirmCheck(check: CheckRecord, card: ProductCard, ctx: ShopperContext, services: CheckServices): Promise<CheckRecord> {
  const category = card.category ?? (isCategory(check.fields.category) ? check.fields.category : undefined);
  const facts: ProductFacts = {
    ...check.facts,
    brand: card.brand || check.facts.brand,
    name: check.fields.productName ?? card.title,
    category,
    priceShown: check.facts.priceShown ?? card.offerPrice ?? null,
    identityConfidence: 1,
    identityConfirmed: true,
  };
  const band = await bandFor(card.id, services);
  const store = check.store ?? card.offerDomain;
  const { decision, reason } = await verdictFor(facts, store, band, ctx, services);
  return { ...check, product: card, needsConfirmation: false, facts, band, store, decision, reason, decidedOn: ctx.today };
}

/** Decide again with the current shelf, budgets and date (or a price the shopper typed in). */
export async function redecideCheck(check: CheckRecord, ctx: ShopperContext, services: CheckServices, priceShown?: number): Promise<CheckRecord> {
  const facts = priceShown !== undefined ? { ...check.facts, priceShown } : check.facts;
  const { decision, reason } = await verdictFor(facts, check.store, check.band, ctx, services);
  return { ...check, facts, decision, reason, decidedOn: ctx.today };
}
