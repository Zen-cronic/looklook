import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { consentText } from "@/lib/app/payments";
import { removeSavedMethod } from "@/lib/app/methods";
import { updateSession } from "@/lib/app/store";
import { getPayPalClient } from "@/lib/paypal";

/** Change the per-rebuy cap (a new agreement, stored with its date). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/methods/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const { capCents } = await readJsonBody<{ capCents?: number }>(request);
    if (!(Number.isInteger(capCents) && capCents! >= 100 && capCents! <= 100000)) throw new HttpError(400, "Set a cap between $1 and $1,000.");
    const method = await updateSession(sid, (s) => {
      const m = s.methods.find((x) => x.id === id && x.status === "active");
      if (!m) throw new HttpError(404, "No such saved method.");
      m.capCents = capCents!;
      m.consentText = consentText(capCents!, m.currency);
      m.consentedAt = new Date().toISOString();
      return m;
    });
    return Response.json({ method });
  });
}

/** Remove a saved method: unusable at once, then deleted at PayPal and confirmed gone. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/methods/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    return Response.json(await removeSavedMethod(sid, id, { client: getPayPalClient }));
  });
}
