import type { PayPalClient } from "./client";
import { money, toCents, type Money } from "./money";

export interface Refund {
  id: string;
  status: string;
  amount?: Money;
}

/** Refund a capture: pass amountCents for a partial refund, omit it for the remaining balance. */
export async function refundCapture(
  client: PayPalClient,
  captureId: string,
  opts: { requestId: string; amountCents?: number; currency?: string; noteToPayer?: string },
): Promise<{ refundId: string; status: string; amountCents?: number }> {
  const body: Record<string, unknown> = {};
  if (opts.amountCents !== undefined) {
    if (!opts.currency) throw new Error("currency is required for a partial refund");
    body.amount = money(opts.amountCents, opts.currency);
  }
  if (opts.noteToPayer) body.note_to_payer = opts.noteToPayer.slice(0, 255);
  const res = await client.request<Refund>({
    method: "POST",
    path: `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    requestId: opts.requestId,
    body,
  });
  return { refundId: res.body.id, status: res.body.status, amountCents: res.body.amount ? toCents(res.body.amount.value) : undefined };
}

export async function getCapture(client: PayPalClient, captureId: string) {
  return (await client.request<{ id: string; status: string; amount?: Money }>({ method: "GET", path: `/v2/payments/captures/${encodeURIComponent(captureId)}` })).body;
}
