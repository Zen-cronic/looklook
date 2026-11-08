import { applyPayPalEvent, eventRefs, type PayPalEvent } from "@/lib/app/paypal-events";
import { appendEvent, handleEvent, indexLookup, updateSession } from "@/lib/app/store";
import { getPayPalClient, verifyWebhookSignature } from "@/lib/paypal";

/**
 * PayPal webhook receiver. Every delivery is verified with PayPal's
 * verify-webhook-signature call before it is trusted and logged with the
 * result. An event counts as handled only after its effect is applied: if
 * applying fails the answer is 500, so PayPal redelivers it, and redeliveries
 * of an event already applied are acknowledged without applying it again.
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
  const { eventId, eventType } = result;
  const handled = await handleEvent({ source: "paypal", simulated: false, eventId, type: eventType, verification: "verified" }, async () => {
    const event = JSON.parse(rawBody) as PayPalEvent;
    const sessions = new Set(eventRefs(event).flatMap((ref) => indexLookup(ref.kind, ref.id)));
    const effects: string[] = [];
    for (const sid of sessions) {
      const effect = await updateSession(sid, (s) => applyPayPalEvent(s, event));
      if (effect) effects.push(effect);
    }
    return effects.join(" ") || "Not linked to a purchase in this app.";
  });
  if (handled.outcome === "failed") return Response.json({ verified: true, eventId, error: "not applied; please redeliver" }, { status: 500 });
  if (handled.outcome === "in-progress") return Response.json({ verified: true, eventId, error: "already being applied; retry later" }, { status: 409 });
  return Response.json({ verified: true, eventId, eventType, duplicate: handled.outcome === "duplicate" });
}
