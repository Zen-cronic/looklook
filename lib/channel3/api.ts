import type { Channel3Client } from "./client";
import type { PriceHistory, Product, ProductSubscription, SearchResult, SubscriptionEvent } from "./types";

/** Text search. Channel3 caps limit at 30. */
export async function searchProducts(client: Channel3Client, query: string, limit = 10): Promise<Product[]> {
  const res = await client.request<SearchResult>("POST", "/v1/search", { query, limit: Math.min(Math.max(limit, 1), 30) });
  return res.products ?? [];
}

/** Product detail; returns more offers than search. Refresh prices with this before showing them. */
export async function getProduct(client: Channel3Client, id: string): Promise<Product> {
  return client.request<Product>("GET", `/v1/products/${encodeURIComponent(id)}`, undefined, { cacheable: false });
}

/** Daily price history, at most the last 90 days. */
export async function getPriceHistory(client: Channel3Client, id: string, days = 90): Promise<PriceHistory> {
  const d = Math.min(Math.max(Math.round(days), 1), 90);
  return client.request<PriceHistory>("GET", `/v0/price-tracking/history/${encodeURIComponent(id)}?days=${d}`);
}

/** Look up the catalogue product behind a store page URL. */
export async function lookupUrl(client: Channel3Client, url: string): Promise<Product> {
  const res = await client.request<{ product?: Product } & Partial<Product>>("POST", "/v1/lookup", { url });
  const product = res.product ?? (res.id ? (res as Product) : undefined);
  if (!product) throw new Error("No catalogue product for that link");
  return product;
}

export const PRICE_EVENTS: SubscriptionEvent[] = ["offer.price.changed", "offer.availability.changed"];

/** Watch a product for price and stock changes. Variant products need a selection (size, colour). */
export async function createSubscription(
  client: Channel3Client,
  input: { productId: string; events?: SubscriptionEvent[]; selection?: unknown; domains?: string[] },
): Promise<ProductSubscription> {
  const body: Record<string, unknown> = { product_id: input.productId, events: input.events ?? PRICE_EVENTS };
  if (input.selection) body.selection = input.selection;
  if (input.domains) body.domains = input.domains;
  return client.request<ProductSubscription>("POST", "/v1/product-subscriptions", body, { cacheable: false });
}

/** All subscriptions on the account, following the cursor. */
export async function listSubscriptions(client: Channel3Client): Promise<ProductSubscription[]> {
  const out: ProductSubscription[] = [];
  let cursor: string | null | undefined;
  do {
    const path = `/v1/product-subscriptions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await client.request<{ items?: ProductSubscription[]; next_cursor?: string | null }>("GET", path, undefined, { cacheable: false });
    out.push(...(res.items ?? []));
    cursor = res.next_cursor;
  } while (cursor);
  return out;
}

export async function cancelSubscription(client: Channel3Client, subscriptionId: string): Promise<ProductSubscription> {
  return client.request<ProductSubscription>("DELETE", `/v1/product-subscriptions/${encodeURIComponent(subscriptionId)}`);
}
