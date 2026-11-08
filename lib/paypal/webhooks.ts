import { createHash } from "node:crypto";
import type { PayPalClient } from "./client";
import { buildRequestId } from "./idempotency";

export const TRANSMISSION_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export interface HeaderSource {
  get(name: string): string | null;
}

export type VerifyResult =
  | { verified: true; eventId: string; eventType: string }
  | { verified: false; reason: "missing-headers" | "bad-json" | "signature-failed"; eventId?: string };

/**
 * The verify call needs the event exactly as PayPal sent it, so the raw body is
 * spliced into the request instead of being parsed and re-serialised.
 */
export function verificationBody(headers: HeaderSource, rawBody: string, webhookId: string): string | undefined {
  const values = TRANSMISSION_HEADERS.map((h) => headers.get(h));
  if (values.some((v) => !v)) return undefined;
  const [authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime] = values as string[];
  const head = JSON.stringify({
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${rawBody}}`;
}

/** Verify a delivered webhook with PayPal's /v1/notifications/verify-webhook-signature. */
export async function verifyWebhookSignature(
  client: PayPalClient,
  input: { headers: HeaderSource; rawBody: string; webhookId: string },
): Promise<VerifyResult> {
  let event: { id?: string; event_type?: string };
  try {
    event = JSON.parse(input.rawBody);
  } catch {
    return { verified: false, reason: "bad-json" };
  }
  const body = verificationBody(input.headers, input.rawBody, input.webhookId);
  if (!body) return { verified: false, reason: "missing-headers", eventId: event.id };
  const transmissionId = input.headers.get("paypal-transmission-id") ?? "unknown";
  const res = await client.request<{ verification_status?: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    // Transmission id plus a hash of the body: a replayed transmission id with a different body is never answered from a cached result.
    requestId: buildRequestId("verify", transmissionId, createHash("sha256").update(input.rawBody).digest("hex").slice(0, 24)),
    body,
  });
  if (res.body?.verification_status === "SUCCESS" && event.id) {
    return { verified: true, eventId: event.id, eventType: event.event_type ?? "UNKNOWN" };
  }
  return { verified: false, reason: "signature-failed", eventId: event.id };
}

/**
 * PayPal redelivers webhooks, so each event id is handled once. In memory for
 * now; the store can be swapped for a persistent one behind the same shape.
 */
export class WebhookEventLog {
  private readonly seen = new Map<string, { eventType: string; receivedAt: string }>();
  private readonly limit: number;

  constructor(limit = 1000) {
    this.limit = limit;
  }

  /** Returns true the first time an event id is recorded, false for a redelivery. */
  record(eventId: string, eventType: string, receivedAt = new Date().toISOString()): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.set(eventId, { eventType, receivedAt });
    if (this.seen.size > this.limit) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  recent(n = 20) {
    return [...this.seen.entries()].slice(-n).reverse().map(([eventId, v]) => ({ eventId, ...v }));
  }
}
