import { cancelSubscription } from "@/lib/channel3/api";
import { handle, HttpError, sessionIdOrThrow } from "@/lib/app/http";
import { channel3Client } from "@/lib/app/services";
import { loadSession, updateSession } from "@/lib/app/store";

/** Stop watching: cancel the Channel3 subscription. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/watch/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const w = loadSession(sid).watch.find((x) => x.id === id);
    if (!w) throw new HttpError(404, "No such watched item.");
    if (w.subscription.status === "active") {
      try {
        await cancelSubscription(channel3Client(), w.subscription.id);
      } catch {
        // Already cancelled or unknown at Channel3; the item is closed either way.
      }
    }
    await updateSession(sid, (s) => {
      const x = s.watch.find((y) => y.id === id);
      if (!x) return;
      x.closedAt = new Date().toISOString();
      if (x.subscription.status === "active") x.subscription = { status: "cancelled", id: x.subscription.id };
    });
    return Response.json({ closed: id });
  });
}
