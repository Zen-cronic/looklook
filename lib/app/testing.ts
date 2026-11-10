/** Stand-ins shared by the payment tests (no network). */
import type { PayPalRequest } from "../paypal/client";
import { InstrumentDeclinedError, PayPalApiError } from "../paypal/errors";
import type { SavedMethod } from "./types";

/**
 * A PayPal stand-in for the Orders API: a new PayPal-Request-Id creates a new
 * order with a completed capture; a repeated id returns the first order, as
 * the sandbox does for sequential repeats.
 */
export function fakePayPal(opts: { onRequest?: (req: PayPalRequest) => void | Promise<void> } = {}) {
  const orders = new Map<string, { id: string; captureId: string; cents: number }>();
  const requests: PayPalRequest[] = [];
  const client = {
    request: async (req: PayPalRequest) => {
      requests.push(req);
      await opts.onRequest?.(req);
      await new Promise((r) => setTimeout(r, 5));
      // The sandbox's simulated decline (PayPal-Mock-Response), as the real client sends it.
      if (req.mockApplicationCode === "INSTRUMENT_DECLINED") {
        throw new InstrumentDeclinedError(new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The instrument presented was either declined by the processor or bank.", [{ issue: "INSTRUMENT_DECLINED" }], "DEBUG-1"));
      }
      if (req.method === "POST" && req.path === "/v2/checkout/orders") {
        let o = orders.get(req.requestId!);
        if (!o) {
          const n = orders.size + 1;
          const body = req.body as { purchase_units: Array<{ amount: { value: string } }> };
          o = { id: `ORDER-${n}`, captureId: `CAPTURE-${n}`, cents: Math.round(Number(body.purchase_units[0].amount.value) * 100) };
          orders.set(req.requestId!, o);
        }
        return { status: 201, body: { id: o.id, status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: o.captureId, status: "COMPLETED", amount: { currency_code: "USD", value: (o.cents / 100).toFixed(2) } }] } }] } };
      }
      throw Object.assign(new Error(`unexpected ${req.method} ${req.path}`), { status: 500 });
    },
  };
  return { client, orders, requests, captures: () => new Set([...orders.values()].map((o) => o.captureId)) };
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

