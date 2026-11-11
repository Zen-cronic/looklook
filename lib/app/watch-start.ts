import { createSubscription } from "@/lib/channel3/api";
import { channel3Client, fetchProduct } from "@/lib/app/services";
import { HttpError } from "@/lib/app/http";
import { indexAdd, loadSession, updateSession } from "@/lib/app/store";
import type { WatchItem } from "@/lib/app/types";
import { newWatch, watchDomain } from "@/lib/app/watch";

/**
 * Start watching a wait item: a Channel3 product subscription sends price
 * changes to our webhook. Used by the check's Watch button and by a week's
 * yes. Watching an item already watched returns that watch.
 */
export async function startWatch(sid: string, checkId: string): Promise<{ watchId: string; subscription: WatchItem["subscription"] }> {
  const state = loadSession(sid);
  const check = state.checks.find((c) => c.id === checkId);
  if (!check) throw new HttpError(404, "No such check.");
  if (!check.product) throw new HttpError(400, "Confirm the product first.");
  if (check.decision.rule === "over-budget") throw new HttpError(409, "This one waits for your budget, not the price. Ask for a reminder when next month's budget starts.");
  const already = state.watch.find((w) => w.checkId === checkId && !w.closedAt);
  if (already) return { watchId: already.id, subscription: already.subscription };
  let subscription: WatchItem["subscription"];
  try {
    const product = await fetchProduct(check.product.id);
    const selected = (product.variants as { selected?: unknown } | undefined)?.selected;
    const domain = watchDomain(check);
    // Only the store the price was seen at: a price elsewhere isn't one the shopper can pay here.
    const sub = await createSubscription(channel3Client(), { productId: check.product.id, events: ["offer.price.changed"], ...(selected ? { selection: selected } : {}), ...(domain ? { domains: [domain] } : {}) });
    subscription = { status: "active", id: sub.subscription_id };
  } catch (e) {
    subscription = { status: "unavailable", reason: e instanceof Error ? e.message.slice(0, 160) : "subscription failed" };
  }
  const watch = newWatch(check, subscription, new Date(), state.shelf);
  await updateSession(sid, (s) => {
    s.watch.push(watch);
    const c = s.checks.find((x) => x.id === checkId);
    if (c) c.watchId = watch.id;
  });
  if (subscription.status === "active") await indexAdd("subscription", subscription.id, sid);
  return { watchId: watch.id, subscription };
}
