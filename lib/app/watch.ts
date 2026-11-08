import type { Channel3Event } from "../channel3/webhooks";
import { currentPrice } from "../channel3/webhooks";
import { formatDollars } from "./money";
import type { ShelfItem } from "../shelf/types";
import type { CheckRecord, SessionState, WatchItem } from "./types";

/** A target from the verdict's price band, else 10% under the price seen. */
export function targetFor(check: CheckRecord): number {
  const t = check.decision.evidence.price?.target;
  const shown = check.facts.priceShown ?? check.product?.offerPrice ?? 0;
  if (t && t < shown) return t;
  return Math.round(shown * 0.9 * 100) / 100;
}

export function newWatch(check: CheckRecord, subscription: WatchItem["subscription"], now = new Date(), shelf: ShelfItem[] = []): WatchItem {
  if (!check.product) throw new Error("Confirm the product before watching it.");
  const start = check.facts.priceShown ?? check.product.offerPrice ?? 0;
  const sameShelf = check.decision.evidence.shelf?.relation === "same-product" ? check.decision.evidence.shelf.itemId : undefined;
  const shelfItemId = sameShelf ?? check.decision.evidence.replaces?.itemId;
  // A drop on a staple buys the cycle that was current when the watch started.
  const linked = shelfItemId ? shelf.find((i) => i.id === shelfItemId) : undefined;
  return {
    id: `wt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    checkId: check.id,
    product: check.product,
    category: check.facts.category,
    startPrice: start,
    targetPrice: targetFor(check),
    currentPrice: start,
    shelfItemId,
    ...(linked ? { cycle: linked.runOutDate ?? "none" } : {}),
    subscription,
    createdAt: now.toISOString(),
  };
}

/**
 * Apply a price event to every open watch on that subscription (or product).
 * Returns a short description of what changed, for the event log.
 */
export function applyPriceEvent(state: SessionState, event: Channel3Event, now = new Date()): string[] {
  if (event.type !== "offer.price.changed") return [];
  const price = currentPrice(event);
  if (price === undefined) return [];
  const subId = event.data.subscription_id;
  const productId = event.data.subject?.product_id;
  const effects: string[] = [];
  for (const w of state.watch) {
    if (w.closedAt) continue;
    const bySub = subId && w.subscription.status === "active" && w.subscription.id === subId;
    const byProduct = productId && w.product.id === productId;
    if (!bySub && !byProduct) continue;
    if (w.lastEventId === event.id) continue;
    // Deliveries can arrive out of order: an event older than the newest one applied is ignored.
    const at = Date.parse(event.timestamp);
    if (w.lastEventAt && Number.isFinite(at) && at < Date.parse(w.lastEventAt)) continue;
    w.lastEventId = event.id;
    if (Number.isFinite(at)) w.lastEventAt = new Date(at).toISOString();
    w.currentPrice = price;
    if (price <= w.targetPrice) {
      w.droppedAt ??= now.toISOString();
      effects.push(`${w.product.brand} ${w.product.title}: now ${formatDollars(price)}, at or under the ${formatDollars(w.targetPrice)} target. Asking for a yes.`);
    } else {
      // Back above the target: the drop card goes away until the next drop.
      const hadDrop = Boolean(w.droppedAt);
      w.droppedAt = undefined;
      effects.push(`${w.product.brand} ${w.product.title}: now ${formatDollars(price)}, ${hadDrop ? "back" : "still"} above the ${formatDollars(w.targetPrice)} target.`);
    }
  }
  return effects;
}

/** A labelled test event, built by the app, in Channel3's event shape. */
export function simulatedDropEvent(w: WatchItem, price: number): Channel3Event {
  return {
    id: `sim_${crypto.randomUUID().replace(/-/g, "")}`,
    timestamp: new Date().toISOString(),
    type: "offer.price.changed",
    data: {
      subscription_id: w.subscription.status === "active" ? w.subscription.id : undefined,
      subject: { product_id: w.product.id, domain: w.product.offerDomain },
      previous: { price: w.currentPrice, currency: "USD" },
      current: { price, currency: "USD" },
    },
  };
}
