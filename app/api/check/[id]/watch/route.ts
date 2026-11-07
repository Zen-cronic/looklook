import { createSubscription } from "@/lib/channel3/api";
import { fetchProduct, channel3Client } from "@/lib/app/services";
import { HttpError, handle, sessionIdOrThrow } from "@/lib/app/http";
import { indexAdd, loadSession, updateSession } from "@/lib/app/store";
import type { WatchItem } from "@/lib/app/types";
import { newWatch } from "@/lib/app/watch";

/** Start watching a wait item: a Channel3 product subscription sends price changes to our webhook. */
export async function POST(_request: Request, ctx: RouteContext<"/api/check/[id]/watch">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const state = loadSession(sid);
    const check = state.checks.find((c) => c.id === id);
    if (!check) throw new HttpError(404, "No such check.");
    if (!check.product) throw new HttpError(400, "Confirm the product first.");
    if (check.decision.rule === "over-budget") throw new HttpError(409, "This one waits for your budget, not the price. Ask for a reminder when next month's budget starts.");
    const already = state.watch.find((w) => w.checkId === id && !w.closedAt);
    if (already) return Response.json({ watchId: already.id, subscription: already.subscription });
    let subscription: WatchItem["subscription"];
    try {
      const product = await fetchProduct(check.product.id);
      const selected = (product.variants as { selected?: unknown } | undefined)?.selected;
      const sub = await createSubscription(channel3Client(), { productId: check.product.id, events: ["offer.price.changed"], ...(selected ? { selection: selected } : {}) });
      subscription = { status: "active", id: sub.subscription_id };
    } catch (e) {
      subscription = { status: "unavailable", reason: e instanceof Error ? e.message.slice(0, 160) : "subscription failed" };
    }
    const watch = newWatch(check, subscription);
    await updateSession(sid, (s) => {
      s.watch.push(watch);
      const c = s.checks.find((x) => x.id === id);
      if (c) c.watchId = watch.id;
    });
    if (subscription.status === "active") await indexAdd("subscription", subscription.id, sid);
    return Response.json({ watchId: watch.id, subscription });
  });
}
