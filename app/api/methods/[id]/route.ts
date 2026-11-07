import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { consentText } from "@/lib/app/payments";
import { loadSession, updateSession } from "@/lib/app/store";
import { singleFlight } from "@/lib/app/single-flight";
import { getPayPalClient, revokePaymentToken } from "@/lib/paypal";

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

/** Remove a saved method: delete the payment token at PayPal and confirm it stays gone. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/methods/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const m = loadSession(sid).methods.find((x) => x.id === id);
    if (!m) throw new HttpError(404, "No such saved method.");
    const result = await singleFlight(`revoke:${m.vaultId}`, () => revokePaymentToken(getPayPalClient(), m.vaultId, { waitMs: 2000 }));
    const confirmedGone = result.confirmed;
    await updateSession(sid, (s) => {
      const x = s.methods.find((y) => y.id === id);
      if (x) {
        if (x.status !== "removed") {
          x.status = "removed";
          x.removedAt = new Date().toISOString();
        }
        x.revokeConfirmed = confirmedGone;
      }
      s.notices.push({ id: `nt_${crypto.randomUUID().slice(0, 12)}`, at: new Date().toISOString(), text: `Removed ${m.label}. PayPal ${confirmedGone ? "no longer has it" : "was asked to delete it"}; no rebuy can use it.` });
    });
    return Response.json({ removed: true, confirmedGone, deletes: result.deletes, checks: result.checks });
  });
}
