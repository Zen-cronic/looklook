import { getPayPalClient, verifyWebhookSignature, WebhookEventLog } from "@/lib/paypal";

const eventLog = new WebhookEventLog();

/**
 * PayPal webhook receiver. Every delivery is verified with PayPal before it is
 * trusted, and redeliveries of the same event id are acknowledged but not
 * handled twice. Handling of each event type comes later.
 */
export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return Response.json({ error: "PAYPAL_WEBHOOK_ID is not configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  let result;
  try {
    result = await verifyWebhookSignature(getPayPalClient(), { headers: request.headers, rawBody, webhookId });
  } catch {
    return Response.json({ error: "verification unavailable" }, { status: 502 });
  }
  if (!result.verified) {
    return Response.json({ verified: false, reason: result.reason }, { status: 400 });
  }
  const firstTime = eventLog.record(result.eventId, result.eventType);
  return Response.json({ verified: true, eventId: result.eventId, eventType: result.eventType, duplicate: !firstTime });
}
