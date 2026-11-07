import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Channel3 signs webhooks in the Standard Webhooks format (delivered by Svix):
 * HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{raw body}" with the
 * base64-decoded part of the endpoint secret after "whsec_". The signature
 * header holds one or more space-separated "v1,<base64>" values.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface HeaderSource {
  get(name: string): string | null;
}

export type Channel3VerifyResult =
  | { verified: true; messageId: string; event: Channel3Event }
  | { verified: false; reason: "missing-headers" | "stale-timestamp" | "bad-signature" | "bad-json" | "bad-secret" };

export interface Channel3Event {
  id: string;
  timestamp?: string;
  type: string;
  data: {
    subscription_id?: string;
    subject?: { product_id?: string; domain?: string; selection?: unknown };
    previous?: { price?: number; compare_at_price?: number | null; currency?: string } | string;
    current?: { price?: number; compare_at_price?: number | null; currency?: string } | string;
    offer?: unknown;
  };
}

function secretBytes(secret: string): Buffer | undefined {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const bytes = Buffer.from(raw, "base64");
  return bytes.length ? bytes : undefined;
}

export function signChannel3(secret: string, messageId: string, timestamp: number, rawBody: string): string {
  const key = secretBytes(secret);
  if (!key) throw new Error("bad webhook secret");
  return createHmac("sha256", key).update(`${messageId}.${timestamp}.${rawBody}`).digest("base64");
}

export function verifyChannel3Webhook(headers: HeaderSource, rawBody: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Channel3VerifyResult {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const sigHeader = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return { verified: false, reason: "missing-headers" };
  const timestamp = Number(ts);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return { verified: false, reason: "stale-timestamp" };
  if (!secretBytes(secret)) return { verified: false, reason: "bad-secret" };
  const expected = Buffer.from(signChannel3(secret, id, timestamp, rawBody), "base64");
  const ok = sigHeader.split(" ").some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) return { verified: false, reason: "bad-signature" };
  let event: Channel3Event;
  try {
    event = JSON.parse(rawBody) as Channel3Event;
  } catch {
    return { verified: false, reason: "bad-json" };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data) return { verified: false, reason: "bad-json" };
  return { verified: true, messageId: id, event };
}

/** The new price in a price-change event, if it carries one. */
export function currentPrice(event: Channel3Event): number | undefined {
  const c = event.data.current;
  return typeof c === "object" && c && typeof c.price === "number" ? c.price : undefined;
}
