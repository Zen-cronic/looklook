import { applyPayPalEvent, eventRefs, type PayPalEvent } from "@/lib/app/paypal-events";
import { appendEvent, indexLookup, setEventEffect, updateSession } from "@/lib/app/store";
import { getPayPalClient, verifyWebhookSignature } from "@/lib/paypal";

/**
 * PayPal webhook receiver. Every delivery is verified with PayPal's
 * verify-webhook-signature call before it is trusted, logged with the result,
 * and redeliveries of the same event id are acknowledged but handled once.
 */
export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    await appendEvent({ source: "paypal", simulated: false, verification: "not-configured", failureReason: "PAYPAL_WEBHOOK_ID is not set" });
    return Response.json({ error: "PAYPAL_WEBHOOK_ID is not configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  let result;
  try {
    result = await verifyWebhookSignature(getPayPalClient(), { headers: request.headers, rawBody, webhookId });
  } catch {
    await appendEvent({ source: "paypal", simulated: false, verification: "failed", failureReason: "verification call failed" });
    return Response.json({ error: "verification unavailable" }, { status: 502 });
  }
  if (!result.verified) {
    await appendEvent({ source: "paypal", simulated: false, eventId: result.eventId, verification: "failed", failureReason: result.reason });
    return Response.json({ verified: false, reason: result.reason }, { status: 400 });
  }
  const logged = await appendEvent({ source: "paypal", simulated: false, eventId: result.eventId, type: result.eventType, verification: "verified" });
  if (logged.duplicate) {
    return Response.json({ verified: true, eventId: result.eventId, eventType: result.eventType, duplicate: true });
  }
  const event = JSON.parse(rawBody) as PayPalEvent;
  const sessions = new Set(eventRefs(event).flatMap((ref) => indexLookup(ref.kind, ref.id)));
  const effects: string[] = [];
  for (const sid of sessions) {
    const effect = await updateSession(sid, (s) => applyPayPalEvent(s, event));
    if (effect) effects.push(effect);
  }
  await setEventEffect(logged.id, effects.join(" ") || "Not linked to a purchase in this app.");
  return Response.json({ verified: true, eventId: result.eventId, eventType: result.eventType, duplicate: false });
}
