import { verifyChannel3Webhook } from "@/lib/channel3/webhooks";
import { appendEvent, handleEvent, indexLookup, loadSession, updateSession } from "@/lib/app/store";
import { applyGuardEvent, guardsOn } from "@/lib/app/guard";
import { applyPriceEvent } from "@/lib/app/watch";
import { getPayPalClient } from "@/lib/paypal";

/** Run tasks a few at a time (one event can reach many shoppers; Channel3 wants an answer within 15 s). */
async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(run));
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  }
}

/**
 * Channel3 product-subscription webhooks: price changes on watched items, and
 * on paid items under a price guard (a drop at that store refunds the
 * difference; a refund that fails answers 500, so the event comes again and
 * the same PayPal-Request-Id returns the same refund).
 * The Standard Webhooks signature is checked against CHANNEL3_WEBHOOK_SECRET
 * and every delivery is logged. An event counts as handled only after its
 * effect is applied (a failure answers 500 so it is retried), and a retried
 * event already applied is acknowledged without applying it again.
 */
export async function POST(request: Request) {
  const secret = process.env.CHANNEL3_WEBHOOK_SECRET;
  if (!secret) {
    await appendEvent({ source: "channel3", simulated: false, verification: "not-configured", failureReason: "CHANNEL3_WEBHOOK_SECRET is not set" });
    return Response.json({ error: "CHANNEL3_WEBHOOK_SECRET is not configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  const result = verifyChannel3Webhook(request.headers, rawBody, secret);
  if (!result.verified) {
    await appendEvent({ source: "channel3", simulated: false, verification: "failed", failureReason: result.reason });
    return Response.json({ verified: false, reason: result.reason }, { status: 400 });
  }
  const { event } = result;
  const handled = await handleEvent({ source: "channel3", simulated: false, eventId: event.id, type: event.type, verification: "verified" }, async () => {
    const sessions = event.data.subscription_id ? indexLookup("subscription", event.data.subscription_id) : [];
    const effects: string[] = [];
    for (const sid of sessions) effects.push(...(await updateSession(sid, (s) => applyPriceEvent(s, event))));
    const guarded = sessions.flatMap((sid) => guardsOn(loadSession(sid), event).map((receiptId) => ({ sid, receiptId })));
    await inBatches(guarded, 4, async ({ sid, receiptId }) => {
      const effect = await applyGuardEvent(sid, receiptId, event, { client: getPayPalClient, simulated: false });
      if (effect) effects.push(effect);
    });
    return effects.join(" ") || (event.type === "offer.price.changed" ? "No open watch in this app matched." : `Logged ${event.type}.`);
  });
  if (handled.outcome === "failed") return Response.json({ verified: true, eventId: event.id, error: "not applied; please redeliver" }, { status: 500 });
  if (handled.outcome === "in-progress") return Response.json({ verified: true, eventId: event.id, error: "already being applied; retry later" }, { status: 409 });
  return Response.json({ verified: true, eventId: event.id, duplicate: handled.outcome === "duplicate" });
}
