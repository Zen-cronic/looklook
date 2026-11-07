import { handle, HttpError, sessionIdOrThrow } from "@/lib/app/http";
import { appToday } from "@/lib/app/dates";
import { recordRefund } from "@/lib/app/payments";
import { singleFlight } from "@/lib/app/single-flight";
import { loadSession, updateSession } from "@/lib/app/store";
import { buildRequestId, getPayPalClient, refundCapture } from "@/lib/paypal";

/** Refund a charge in full (sandbox). */
export async function POST(_request: Request, ctx: RouteContext<"/api/receipts/[id]/refund">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const r = loadSession(sid).receipts.find((x) => x.id === id);
    if (!r || !r.captureId) throw new HttpError(404, "No such charge.");
    if (r.refund?.status === "COMPLETED") return Response.json({ refund: r.refund });
    const requestId = buildRequestId("refund", r.captureId, "full");
    const captureId = r.captureId;
    const refund = await singleFlight(requestId, () => refundCapture(getPayPalClient(), captureId, { requestId }));
    await updateSession(sid, (s) => {
      const x = s.receipts.find((y) => y.id === id);
      if (x) recordRefund(s, x, refund, x.category, appToday(s.dayOffset));
    });
    return Response.json({ refund });
  });
}
