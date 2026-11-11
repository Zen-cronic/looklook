/** Stand-ins shared by the payment tests (no network). */
import type { PayPalRequest } from "../paypal/client";
import { InstrumentDeclinedError, PayPalApiError } from "../paypal/errors";
import type { SavedMethod } from "./types";

/**
 * A PayPal stand-in for the Orders API: a new PayPal-Request-Id creates a new
 * order with a completed capture; a repeated id returns the first order, as
 * the sandbox does for sequential repeats.
 */
export function fakePayPal(opts: { onRequest?: (req: PayPalRequest) => void | Promise<void>; refundConflict?: () => boolean } = {}) {
  const orders = new Map<string, { id: string; captureId: string; cents: number }>();
  const requests: PayPalRequest[] = [];
  /** Captures the tests refund against: id -> amount captured. Orders made here are added on creation. */
  const captured = new Map<string, number>();
  const refunds = new Map<string, { id: string; captureId: string; cents: number }>();
  const refundedOn = (captureId: string) => [...refunds.values()].filter((r) => r.captureId === captureId).reduce((n, r) => n + r.cents, 0);
  const client = {
    request: async (req: PayPalRequest) => {
      requests.push(req);
      await opts.onRequest?.(req);
      await new Promise((r) => setTimeout(r, 5));
      // The sandbox's simulated decline (PayPal-Mock-Response), as the real client sends it.
      if (req.mockApplicationCode === "INSTRUMENT_DECLINED") {
        throw new InstrumentDeclinedError(new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The instrument presented was either declined by the processor or bank.", [{ issue: "INSTRUMENT_DECLINED" }], "DEBUG-1"));
      }
      const refund = req.method === "POST" ? /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(req.path) : null;
      if (refund) {
        const captureId = decodeURIComponent(refund[1]);
        const total = captured.get(captureId);
        if (total === undefined) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", "The specified resource does not exist.", [{ issue: "INVALID_RESOURCE_ID" }]);
        // Same PayPal-Request-Id: PayPal answers 200 with the refund it already made.
        const again = refunds.get(req.requestId!);
        const money = (cents: number) => ({ currency_code: "USD", value: (cents / 100).toFixed(2) });
        if (again) return { status: 200, body: { id: again.id, status: "COMPLETED", amount: money(again.cents), seller_payable_breakdown: { total_refunded_amount: money(refundedOn(captureId)) } } };
        if (opts.refundConflict?.()) throw new PayPalApiError(409, "RESOURCE_CONFLICT", "A previous request for this resource is in progress.", []);
        const body = (req.body ?? {}) as { amount?: { value: string } };
        const cents = body.amount ? Math.round(Number(body.amount.value) * 100) : total - refundedOn(captureId);
        if (cents <= 0 || refundedOn(captureId) + cents > total) {
          throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed.", [{ issue: refundedOn(captureId) >= total ? "CAPTURE_FULLY_REFUNDED" : "REFUND_AMOUNT_EXCEEDED" }]);
        }
        const r = { id: `REFUND-${refunds.size + 1}`, captureId, cents };
        refunds.set(req.requestId!, r);
        return { status: 201, body: { id: r.id, status: "COMPLETED", amount: money(cents), seller_payable_breakdown: { total_refunded_amount: money(refundedOn(captureId)) } } };
      }
      if (req.method === "POST" && req.path === "/v2/checkout/orders") {
        let o = orders.get(req.requestId!);
        if (!o) {
          const n = orders.size + 1;
          const body = req.body as { purchase_units: Array<{ amount: { value: string } }> };
          o = { id: `ORDER-${n}`, captureId: `CAPTURE-${n}`, cents: Math.round(Number(body.purchase_units[0].amount.value) * 100) };
          orders.set(req.requestId!, o);
          captured.set(o.captureId, o.cents);
        }
        return { status: 201, body: { id: o.id, status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: o.captureId, status: "COMPLETED", amount: { currency_code: "USD", value: (o.cents / 100).toFixed(2) } }] } }] } };
      }
      throw Object.assign(new Error(`unexpected ${req.method} ${req.path}`), { status: 500 });
    },
  };
  return {
    client,
    orders,
    requests,
    refunds,
    /** Let a test refund a capture it made without an order here. */
    capture: (captureId: string, cents: number) => captured.set(captureId, cents),
    captures: () => new Set([...orders.values()].map((o) => o.captureId)),
  };
}

export const savedCard: SavedMethod = {
  id: "pm_test",
  type: "card",
  vaultId: "vaulttest1",
  label: "Visa ending 1111",
  capCents: 5000,
  currency: "USD",
  consentText: "",
  consentedAt: "",
  firstOrderId: "O0",
  status: "active",
};

