import Anthropic from "@anthropic-ai/sdk";
import { getPriceHistory, getProduct, lookupUrl, searchProducts } from "../channel3/api";
import { priceBand, type PriceBand } from "../channel3/band";
import { Channel3Client } from "../channel3/client";
import type { CheckServices } from "./checks";
import { realToday } from "./dates";
import { storeOffers } from "./offers";
import { cacheGet, cacheSet } from "./store";
import type { StoreOffer } from "./types";

let anthropic: Anthropic | undefined;
let channel3: Channel3Client | undefined;

export function channel3Client(): Channel3Client {
  channel3 ??= new Channel3Client({ maxCalls: Number(process.env.CHANNEL3_MAX_CALLS ?? 2000) });
  return channel3;
}

export function missingKeys(): string[] {
  return ["ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"].filter((k) => !process.env[k]);
}

/** Live services: Claude for reading, Channel3 for the catalogue and price history. Cached on disk per image, link and day. */
export function liveCheckServices(): CheckServices {
  anthropic ??= new Anthropic();
  const c3 = channel3Client();
  return {
    anthropic,
    modelReason: process.env.MODEL_REASONS !== "0",
    cache: { get: cacheGet, set: cacheSet },
    async search(query) {
      const key = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120);
      const hit = cacheGet<Awaited<ReturnType<typeof searchProducts>>>("search", key);
      if (hit) return hit;
      const products = await searchProducts(c3, query, 10);
      cacheSet("search", key, products);
      return products;
    },
    lookup: (url) => lookupUrl(c3, url),
    async priceBand(productId): Promise<PriceBand | null> {
      const key = `${productId}-${realToday()}`;
      const hit = cacheGet<{ band: PriceBand | null }>("band", key);
      if (hit) return hit.band;
      const history = await getPriceHistory(c3, productId, 90);
      const band = priceBand(history.history) ?? null;
      cacheSet("band", key, { band });
      return band;
    },
  };
}

export async function fetchProduct(productId: string) {
  return getProduct(channel3Client(), productId);
}

/** Store offers for a product (derived fields only), refreshed once a day; empty when the catalogue can't be reached. */
export async function cachedOffers(productId: string): Promise<StoreOffer[]> {
  const key = `${productId}-${realToday()}`;
  const hit = cacheGet<{ offers: StoreOffer[] }>("offers", key);
  if (hit) return hit.offers;
  if (!process.env.CHANNEL3_API_KEY) return [];
  try {
    const offers = storeOffers(await getProduct(channel3Client(), productId));
    cacheSet("offers", key, { offers });
    return offers;
  } catch {
    return [];
  }
}
