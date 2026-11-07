import { verifyChannel3Webhook } from "@/lib/channel3/webhooks";
import { appendEvent, indexLookup, setEventEffect, updateSession } from "@/lib/app/store";
import { applyPriceEvent } from "@/lib/app/watch";

/**
 * Channel3 product-subscription webhooks (price changes on watched items).
 * The Standard Webhooks signature is checked against CHANNEL3_WEBHOOK_SECRET,
 * every delivery is logged, and a retried event id is handled once.
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
  const logged = await appendEvent({ source: "channel3", simulated: false, eventId: event.id, type: event.type, verification: "verified" });
  if (logged.duplicate) return Response.json({ verified: true, eventId: event.id, duplicate: true });
  const sessions = event.data.subscription_id ? indexLookup("subscription", event.data.subscription_id) : [];
  const effects: string[] = [];
  for (const sid of sessions) effects.push(...(await updateSession(sid, (s) => applyPriceEvent(s, event))));
  await setEventEffect(logged.id, effects.join(" ") || (event.type === "offer.price.changed" ? "No open watch in this app matched." : `Logged ${event.type}.`));
  return Response.json({ verified: true, eventId: event.id, duplicate: false });
}
