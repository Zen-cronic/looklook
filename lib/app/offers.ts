import type { Product } from "../channel3/types";
import { openedReturnPolicy, type OpenedReturn } from "../policies";
import type { Category } from "../shelf/categories";
import type { StoreOffer } from "./types";

/** At most this many stores are listed on a verdict. */
export const MAX_OFFERS = 5;

/** Keep only what the verdict shows: store, price and link, cheapest per store, in USD. */
export function storeOffers(product: Pick<Product, "offers">): StoreOffer[] {
  const best = new Map<string, StoreOffer>();
  for (const o of product.offers ?? []) {
    if (!o.domain || !(o.price?.price > 0) || (o.price.currency && o.price.currency !== "USD")) continue;
    if (o.availability && /out.?of.?stock|discontinued/i.test(o.availability)) continue;
    const domain = o.domain.toLowerCase().replace(/^www\./, "");
    const prev = best.get(domain);
    if (!prev || o.price.price < prev.price) best.set(domain, { domain, price: Math.round(o.price.price * 100) / 100, url: o.url });
  }
  return [...best.values()].sort((a, b) => a.price - b.price || a.domain.localeCompare(b.domain)).slice(0, MAX_OFFERS);
}

export interface OfferLine extends StoreOffer {
  store: string;
  returns: OpenedReturn;
  /** "takes opened back within 30 days", "takes opened back with a receipt within 60 days", "may refuse opened", ... */
  returnsText: string;
  policyUrl: string | null;
}

/** Each store's offer with what that store does with opened items of this kind. */
export function offerLines(offers: StoreOffer[], category: Category | undefined): OfferLine[] {
  return offers.map((o) => {
    if (!category) return { ...o, store: o.domain, returns: "unknown", returnsText: "return policy not checked", policyUrl: null };
    const p = openedReturnPolicy(o.domain, category);
    const store = p.fallback ? o.domain : p.retailerName;
    const returnsText =
      p.returnableOpened === "yes"
        ? `takes opened back${p.openedNeeds ? ` ${p.openedNeeds}` : ""}${p.windowDays ? ` within ${p.windowDays} days` : ""}`
        : p.returnableOpened === "no"
          ? "may refuse opened"
          : p.returnableOpened === "conditional"
            ? "opened only on conditions"
            : "opened returns not stated";
    return { ...o, store, returns: p.returnableOpened, returnsText, policyUrl: p.fallback ? null : p.sourceUrl };
  });
}
