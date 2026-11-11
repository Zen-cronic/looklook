import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { handleEvent, loadSession, updateSession } from "@/lib/app/store";
import { applyPriceEvent, simulatedDropEvent } from "@/lib/app/watch";

/**
 * A labelled test: build a price-change event in Channel3's shape and run it
 * through the same handler a real delivery uses. It is logged as simulated.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/watch/[id]/drop">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const { price } = await readJsonBody<{ price?: number }>(request).catch(() => ({ price: undefined }));
    const w = loadSession(sid).watch.find((x) => x.id === id && !x.closedAt);
    if (!w) throw new HttpError(404, "No such watched item.");
    const to = typeof price === "number" && price > 0 ? price : Math.round(w.targetPrice * 0.98 * 100) / 100;
    const event = simulatedDropEvent(w, to);
    let effects: string[] = [];
    const handled = await handleEvent({ source: "channel3", simulated: true, eventId: event.id, type: event.type, verification: "simulated" }, async () => {
      effects = await updateSession(sid, (s) => applyPriceEvent(s, event));
      return effects.join(" ") || "No open watch matched.";
    });
    if (handled.outcome === "failed") throw new HttpError(500, "The price drop couldn't be applied. Try again.");
    return Response.json({ eventId: event.id, price: to, effects });
  });
}
