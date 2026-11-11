import { applyGuardEvent, GuardBusyError, guardFloorCents, MAX_TEST_DROPS, MIN_GUARD_REFUND_CENTS, MIN_PLAUSIBLE_PRICE_SHARE, simulatedStoreDrop, testDropCents } from "@/lib/app/guard";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { handleEvent, loadSession } from "@/lib/app/store";
import { getPayPalClient } from "@/lib/paypal";

/**
 * A labelled sandbox test: the store a paid item was bought at lowers its
 * price. It builds a price event in Channel3's shape and runs it through the
 * same guard a real delivery uses, so the refund it makes is a real sandbox
 * refund. Bounded: only this browser's own guarded receipt, only a price
 * between half of what was paid and what is already covered, and only a few
 * times per receipt. Logged as simulated.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/receipts/[id]/drop">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const { priceCents } = await readJsonBody<{ priceCents?: unknown }>(request).catch(() => ({ priceCents: undefined }));
    const r = loadSession(sid).receipts.find((x) => x.id === id);
    if (!r?.guard) throw new HttpError(404, "No price protection on that charge.");
    const g = r.guard;
    if (g.status !== "on") throw new HttpError(409, g.status === "starting" ? "Price protection is still starting. Try again in a moment." : "Price protection on this charge isn't on.");
    if (g.refunds.filter((x) => x.simulated).length >= MAX_TEST_DROPS) throw new HttpError(429, `That's ${MAX_TEST_DROPS} price drops on this charge already.`);
    const floor = guardFloorCents(g);
    const price = priceCents === undefined ? testDropCents(g) : Number(priceCents);
    if (!Number.isInteger(price) || price < Math.ceil(g.paidCents * MIN_PLAUSIBLE_PRICE_SHARE) || price > floor - MIN_GUARD_REFUND_CENTS) {
      throw new HttpError(400, "A price drop must be below what is already covered and at least half of what was paid.");
    }
    const event = simulatedStoreDrop(g, price);
    let busy = false;
    const handled = await handleEvent({ source: "channel3", simulated: true, eventId: event.id, type: event.type, verification: "simulated" }, async () => {
      try {
        return (await applyGuardEvent(sid, id, event, { client: getPayPalClient, simulated: true })) ?? "Price protection didn't apply.";
      } catch (e) {
        if (e instanceof GuardBusyError) busy = true;
        throw e;
      }
    });
    if (busy) throw new HttpError(409, "PayPal is still working on the last refund for this charge. Try again in a moment.");
    if (handled.outcome !== "handled") throw new HttpError(502, "The price drop couldn't be applied. Nothing was refunded twice. Try again.");
    return Response.json({ eventId: event.id, priceCents: price, effect: handled.effect });
  });
}
