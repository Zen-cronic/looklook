import type { PayPalClient } from "./client";
import { RebuyCapExceededError } from "./errors";
import { rebuyRequestId } from "./idempotency";
import { assertCaptureNotDeclined, purchaseUnit, readCapture, orderTotalCents, type CaptureOutcome, type PayPalOrder } from "./orders";

export interface SavedMethod {
  type: "card" | "paypal";
  vaultId: string;
}

export interface RebuyInput {
  itemId: string;
  /** The replenishment cycle, for example "2026-11" or a run-out sequence number. */
  cycle: string | number;
  title: string;
  unitCents: number;
  currency: string;
  /** The buyer's per-rebuy spending cap, in the same currency. */
  capCents: number;
  method: SavedMethod;
  mockApplicationCode?: string;
}

export interface RebuyReceipt extends CaptureOutcome {
  requestId: string;
  itemId: string;
  cycle: string | number;
}

/** Throws before any request when the rebuy is above the buyer's cap. */
export function checkRebuyCap(amountCents: number, capCents: number): void {
  if (!Number.isInteger(capCents) || capCents <= 0) throw new RebuyCapExceededError(amountCents, Math.max(0, capCents));
  if (amountCents > capCents) throw new RebuyCapExceededError(amountCents, capCents);
}

/**
 * The buyer is in the app and says yes, so this is a customer-initiated
 * payment on a saved method (not a merchant-initiated charge).
 */
export function rebuyPaymentSource(method: SavedMethod): Record<string, unknown> {
  if (method.type === "card") {
    return {
      card: {
        vault_id: method.vaultId,
        stored_credential: { payment_initiator: "CUSTOMER", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" },
      },
    };
  }
  return {
    paypal: {
      vault_id: method.vaultId,
      stored_credential: { payment_initiator: "CUSTOMER", usage: "SUBSEQUENT" },
    },
  };
}

export function rebuyOrderBody(input: RebuyInput) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      purchaseUnit({
        referenceId: `${input.itemId}:${input.cycle}`.slice(0, 256),
        currency: input.currency,
        description: `Rebuy: ${input.title}`.slice(0, 127),
        items: [{ sku: input.itemId, name: input.title, unitCents: input.unitCents }],
      }),
    ],
    payment_source: rebuyPaymentSource(input.method),
  };
}

/**
 * Rebuy an item on a saved method after the buyer's yes. Keyed by item and
 * cycle, so two triggers for the same cycle produce one charge.
 */
export async function rebuy(client: PayPalClient, input: RebuyInput): Promise<RebuyReceipt> {
  const amount = orderTotalCents({ referenceId: "", currency: input.currency, items: [{ sku: input.itemId, name: input.title, unitCents: input.unitCents }] });
  checkRebuyCap(amount, input.capCents);
  const requestId = rebuyRequestId(input.itemId, input.cycle);
  const res = await client.request<PayPalOrder>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId,
    mockApplicationCode: input.mockApplicationCode,
    body: rebuyOrderBody(input),
  });
  const outcome = assertCaptureNotDeclined(readCapture(res.body));
  return { ...outcome, requestId, itemId: input.itemId, cycle: input.cycle };
}
