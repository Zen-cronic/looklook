import { describe, expect, it } from "vitest";
import type { CaptureOutcome } from "../paypal/orders";
import { remainingBudgets } from "./budgets";
import { applyRefund, recordPaid, sourceDetails, type PaidResult } from "./payments";
import { applyPayPalEvent } from "./paypal-events";
import { seedState } from "./seed";
import type { SessionState } from "./types";

const TODAY = "2026-11-10";

function paidHa(): { s: SessionState; receiptId: string; runOutBefore: string; leftBefore: number } {
  const s = seedState("refundsession001", TODAY, new Date("2026-11-10T15:00:00Z"));
  const ha = s.shelf.find((i) => i.id === "sh-ha")!;
  const runOutBefore = ha.runOutDate!;
  const leftBefore = remainingBudgets(s.budgets, TODAY).skincare!;
  const source = { kind: "staple" as const, shelfItemId: "sh-ha", cycle: runOutBefore };
  const outcome: CaptureOutcome = { orderId: "O-R", orderStatus: "COMPLETED", captureId: "CAP-R", captureStatus: "PENDING", amountCents: 990, currency: "USD" };
  const paid: PaidResult = { outcome, requestId: "rebuy:r", kind: "saved-method", methodLabel: "Visa ending 1111", methodId: "pm_1" };
  const { receipt } = recordPaid(s, source, sourceDetails(s, source), paid, TODAY);
  return { s, receiptId: receipt.id, runOutBefore, leftBefore };
}

const refundEvent = (id: string, refundId: string, value: string, status = "COMPLETED") => ({
  id,
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  resource: { id: refundId, status, amount: { currency_code: "USD", value }, links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-R" }] },
});

describe("PayPal says a capture was denied", () => {
  it("marks the receipt failed and undoes the restock and the budget spend, once", () => {
    const { s, receiptId, runOutBefore, leftBefore } = paidHa();
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore - 9.9);
    const denied = { id: "WH-D", event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "CAP-R", status: "DECLINED" } };
    applyPayPalEvent(s, denied);
    applyPayPalEvent(s, { ...denied, id: "WH-D2" });
    const r = s.receipts.find((x) => x.id === receiptId)!;
    expect(r.status).toBe("failed");
    expect(s.shelf.find((i) => i.id === "sh-ha")!.runOutDate).toBe(runOutBefore);
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore);
  });
});

describe("refunds return money to the budget", () => {
  it("credits a refund made outside the app, only its amount, once per refund", () => {
    const { s, receiptId, leftBefore } = paidHa();
    applyPayPalEvent(s, refundEvent("WH-R1", "REF-1", "4.00"));
    applyPayPalEvent(s, refundEvent("WH-R1b", "REF-1", "4.00"));
    const r = s.receipts.find((x) => x.id === receiptId)!;
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore - 5.9);
    expect(r.status).toBe("partly-refunded");
    applyPayPalEvent(s, refundEvent("WH-R2", "REF-2", "5.90"));
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore);
    expect(r.status).toBe("refunded");
  });

  it("shows an in-app refund PayPal answered PENDING as pending, and credits it once when it completes", () => {
    const { s, receiptId, leftBefore } = paidHa();
    const r = s.receipts.find((x) => x.id === receiptId)!;
    applyRefund(s, r, { refundId: "REF-P", status: "PENDING", amountCents: 990 });
    expect(r.refund?.status).toBe("PENDING");
    expect(r.status).not.toBe("refunded");
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore - 9.9);
    applyPayPalEvent(s, refundEvent("WH-P", "REF-P", "9.90"));
    applyRefund(s, r, { refundId: "REF-P", status: "COMPLETED", amountCents: 990 });
    expect(r.status).toBe("refunded");
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBeCloseTo(leftBefore);
  });
});
