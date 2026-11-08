import { verifyChannel3Webhook } from "@/lib/channel3/webhooks";
import { appendEvent, handleEvent, indexLookup, updateSession } from "@/lib/app/store";
import { applyPriceEvent } from "@/lib/app/watch";

/**
 * Channel3 product-subscription webhooks (price changes on watched items).
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
    return effects.join(" ") || (event.type === "offer.price.changed" ? "No open watch in this app matched." : `Logged ${event.type}.`);
  });
  if (handled.outcome === "failed") return Response.json({ verified: true, eventId: event.id, error: "not applied; please redeliver" }, { status: 500 });
  if (handled.outcome === "in-progress") return Response.json({ verified: true, eventId: event.id, error: "already being applied; retry later" }, { status: 409 });
  return Response.json({ verified: true, eventId: event.id, duplicate: handled.outcome === "duplicate" });
}
