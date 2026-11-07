import type { SessionState } from "./types";

/** The parts of a PayPal webhook event the app reads. */
export interface PayPalEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    links?: Array<{ rel?: string; href?: string }>;
  };
}

/** The provider ids an event refers to, used to find the shopper it belongs to. */
export function eventRefs(e: PayPalEvent): Array<{ kind: "order" | "capture" | "token"; id: string }> {
  const r = e.resource ?? {};
  const refs: Array<{ kind: "order" | "capture" | "token"; id: string }> = [];
  if (e.event_type.startsWith("PAYMENT.CAPTURE.") && r.id) {
    if (e.event_type === "PAYMENT.CAPTURE.REFUNDED") {
      const up = r.links?.find((l) => l.rel === "up")?.href?.match(/captures\/([^/]+)/)?.[1];
      if (up) refs.push({ kind: "capture", id: up });
    } else refs.push({ kind: "capture", id: r.id });
  }
  const orderId = r.supplementary_data?.related_ids?.order_id;
  if (orderId) refs.push({ kind: "order", id: orderId });
  if (e.event_type.startsWith("CHECKOUT.ORDER.") && r.id) refs.push({ kind: "order", id: r.id });
  if (e.event_type.startsWith("VAULT.PAYMENT-TOKEN.") && r.id) refs.push({ kind: "token", id: r.id });
  return refs;
}

/** Apply a verified PayPal event to one shopper's records. Returns what changed. */
export function applyPayPalEvent(state: SessionState, e: PayPalEvent, now = new Date()): string | undefined {
  const r = e.resource ?? {};
  const at = now.toISOString();
  if (e.event_type.startsWith("PAYMENT.CAPTURE.") || e.event_type.startsWith("CHECKOUT.ORDER.")) {
    const refs = eventRefs(e);
    const receipt = state.receipts.find((x) => refs.some((ref) => (ref.kind === "capture" && x.captureId === ref.id) || (ref.kind === "order" && x.orderId === ref.id)));
    if (!receipt) return undefined;
    receipt.webhook = { eventId: e.id, type: e.event_type, at };
    if (e.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      receipt.captureStatus = "COMPLETED";
      if (receipt.status === "pending") receipt.status = "completed";
      return `Receipt for ${receipt.title}: PayPal confirmed the capture.`;
    }
    if (e.event_type === "PAYMENT.CAPTURE.DENIED" || e.event_type === "PAYMENT.CAPTURE.DECLINED") {
      receipt.captureStatus = r.status ?? "DECLINED";
      return `Receipt for ${receipt.title}: PayPal reports the capture ${receipt.captureStatus.toLowerCase()}.`;
    }
    if (e.event_type === "PAYMENT.CAPTURE.REFUNDED") {
      receipt.status = "refunded";
      return `Receipt for ${receipt.title}: PayPal confirmed the refund.`;
    }
    return `Receipt for ${receipt.title}: ${e.event_type}.`;
  }
  if (e.event_type === "VAULT.PAYMENT-TOKEN.DELETED" && r.id) {
    const m = state.methods.find((x) => x.vaultId === r.id);
    if (!m) return undefined;
    if (m.status !== "removed") {
      m.status = "removed";
      m.removedAt = at;
    }
    return `${m.label}: PayPal confirmed it was removed.`;
  }
  if (e.event_type === "VAULT.PAYMENT-TOKEN.CREATED" && r.id) {
    const m = state.methods.find((x) => x.vaultId === r.id);
    return m ? `${m.label}: PayPal confirmed it was saved.` : undefined;
  }
  return undefined;
}
