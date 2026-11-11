import { createSubscription } from "@/lib/channel3/api";
import { channel3Client, fetchProduct } from "@/lib/app/services";
import { ensureGuards, type StartDeps } from "@/lib/app/guard";

/** Channel3 subscription for one product, at one store only (variant products name their selection). */
async function subscribeAtStore({ productId, domain }: { productId: string; domain: string }): Promise<string> {
  const product = await fetchProduct(productId);
  const selected = (product.variants as { selected?: unknown } | undefined)?.selected;
  const sub = await createSubscription(channel3Client(), { productId, events: ["offer.price.changed"], domains: [domain], ...(selected ? { selection: selected } : {}) });
  return sub.subscription_id;
}

/** The answer to a payment never waits more than this for Channel3. */
export const GUARD_START_TIMEOUT_MS = 3000;

export const guardStartDeps: StartDeps = { subscribe: subscribeAtStore, timeoutMs: GUARD_START_TIMEOUT_MS };

/** Start price guards on these receipts after they were paid; never throws. */
export async function startGuards(sid: string, receiptIds: string[] | undefined): Promise<void> {
  await ensureGuards(sid, receiptIds, guardStartDeps).catch(() => undefined);
}
