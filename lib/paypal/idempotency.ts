import { createHash } from "node:crypto";

/** PayPal-Request-Id values are kept short and to a safe character set. */
export const MAX_REQUEST_ID_LENGTH = 100;

function slug(part: string | number): string {
  return String(part)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A deterministic PayPal-Request-Id from its parts. The same parts always give
 * the same id, so a retried POST is answered from PayPal's idempotency store
 * instead of creating a second order, refund or token.
 */
export function buildRequestId(kind: string, ...parts: Array<string | number>): string {
  if (!kind) throw new Error("request id kind is required");
  const cleaned = [kind, ...parts].map(slug);
  if (cleaned.some((p) => p.length === 0)) throw new Error("request id parts must not be empty");
  const id = cleaned.join(":");
  if (id.length <= MAX_REQUEST_ID_LENGTH) return id;
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `${cleaned[0]}:${digest}`;
}

/**
 * One rebuy per item per cycle. A price-drop webhook and a run-out date that
 * fire for the same item in the same cycle share this id, so PayPal charges once.
 */
export function rebuyRequestId(itemId: string, cycle: string | number): string {
  return buildRequestId("rebuy", itemId, cycle);
}

/** For one-off POSTs with no natural key (a first checkout, a setup token). */
export function freshRequestId(kind: string): string {
  return buildRequestId(kind, crypto.randomUUID());
}
