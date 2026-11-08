import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PayPalRequest } from "../paypal/client";
import { appToday, daysBetween } from "./dates";
import { REBUY_LEAD_DAYS, stapleCycle } from "./payments";
import type { SavedMethod, SessionState } from "./types";

/**
 * A PayPal stand-in for the Orders API: a new PayPal-Request-Id creates a new
 * order with a completed capture; a repeated id returns the first order, as
 * the sandbox does for sequential repeats.
 */
export function fakePayPal() {
  const orders = new Map<string, { id: string; captureId: string; cents: number }>();
  const requests: PayPalRequest[] = [];
  const client = {
    request: async (req: PayPalRequest) => {
      requests.push(req);
      await new Promise((r) => setTimeout(r, 5));
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

let dir: string;
const previous = process.env.APP_DATA_DIR;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pay-data-"));
  process.env.APP_DATA_DIR = dir;
});
afterAll(() => {
  process.env.APP_DATA_DIR = previous;
});

let n = 0;
/** A session with a saved card, the HA serum due for a rebuy, and a price drop on it. */
async function shopper(): Promise<{ sid: string; cycle: string; stapleCents: number; dropCents: number }> {
  const { updateSession } = await import("./store");
  const sid = `paytest${String(++n).padStart(4, "0")}`;
  return updateSession(sid, (s: SessionState) => {
    s.methods.push({ ...savedCard });
    const ha = s.shelf.find((i) => i.id === "sh-ha")!;
    const left = daysBetween(appToday(0), ha.runOutDate!);
    s.dayOffset = Math.max(0, left - (REBUY_LEAD_DAYS - 2));
    s.watch.push({
      id: "wt_ha",
      product: { id: "P-HA", title: "Hyaluronic Acid 2% + B5", brand: "The Ordinary" },
      category: ha.category,
      startPrice: ha.price!,
      targetPrice: 9,
      currentPrice: 8.5,
      shelfItemId: "sh-ha",
      cycle: stapleCycle(ha),
      subscription: { status: "active", id: "sub_ha" },
      createdAt: new Date().toISOString(),
      droppedAt: new Date().toISOString(),
    });
    return { sid, cycle: stapleCycle(ha), stapleCents: Math.round(ha.price! * 100), dropCents: 850 };
  });
}

describe("charging once for one yes", () => {
  it("sends the same yes again on a paid price drop and gets the same capture", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { loadSession } = await import("./store");
    const pp = fakePayPal();
    const { sid, dropCents } = await shopper();
    const first = await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: dropCents } }, { client: () => pp.client as never });
    const receipt = loadSession(sid).receipts.find((r) => r.id === first.receiptId)!;
    // The receipt's "Send the same yes again" sends the receipt's own source and amount.
    const again = await payWithSavedMethod(sid, { source: receipt.source, approved: { amountCents: receipt.amountCents } }, { client: () => pp.client as never }).catch((e) => e);
    expect(again.captureId ?? first.captureId).toBe(first.captureId);
    expect(pp.captures().size).toBe(1);
    expect(loadSession(sid).receipts).toHaveLength(1);
  });

  it("does not charge a price-drop card tapped after the staple's run-out rebuy", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { loadSession } = await import("./store");
    const pp = fakePayPal();
    const { sid, cycle, stapleCents, dropCents } = await shopper();
    const staple = await payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle }, approved: { amountCents: stapleCents } }, { client: () => pp.client as never });
    const drop = await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: dropCents } }, { client: () => pp.client as never }).catch((e) => e);
    expect(pp.captures().size).toBe(1);
    expect(drop.captureId ?? staple.captureId).toBe(staple.captureId);
    expect(drop.status === undefined || drop.status === 409).toBe(true);
    expect(loadSession(sid).receipts).toHaveLength(1);
  });

  it("does not charge the staple card tapped after the price drop paid for that cycle", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const pp = fakePayPal();
    const { sid, cycle, stapleCents, dropCents } = await shopper();
    await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: dropCents } }, { client: () => pp.client as never });
    const stale = await payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle }, approved: { amountCents: stapleCents } }, { client: () => pp.client as never }).catch((e) => e);
    expect(stale.status).toBe(409);
    expect(stale.extra?.alreadyBought).toBe(true);
    expect(pp.captures().size).toBe(1);
  });

  it("charges two taps on the same card once", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { loadSession } = await import("./store");
    const pp = fakePayPal();
    const { sid, cycle, stapleCents } = await shopper();
    const tap = () => payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle }, approved: { amountCents: stapleCents } }, { client: () => pp.client as never });
    const [a, b] = await Promise.all([tap(), tap()]);
    expect(a.captureId).toBe(b.captureId);
    const later = await tap();
    expect(later.captureId).toBe(a.captureId);
    expect(pp.captures().size).toBe(1);
    const receipts = loadSession(sid).receipts;
    expect(receipts).toHaveLength(1);
    expect(receipts[0].attempts).toBe(3);
  });

  it("refuses a drop and a staple tapped together for the same cycle, charging once", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const pp = fakePayPal();
    const { sid, cycle, stapleCents, dropCents } = await shopper();
    const results = await Promise.allSettled([
      payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle }, approved: { amountCents: stapleCents } }, { client: () => pp.client as never }),
      payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: dropCents } }, { client: () => pp.client as never }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(pp.captures().size).toBe(1);
  });
});

describe("after PayPal captured a checkout", () => {
  it("keeps the receipt when the item was removed while the PayPal window was open", async () => {
    const { recordCheckoutCapture } = await import("./payments");
    const { seedState } = await import("./seed");
    const s = seedState("capturetest0001", "2026-11-10");
    const check = s.checks[0];
    const intent = {
      id: "pi_gone",
      createdAt: "",
      source: { kind: "check" as const, checkId: check.id },
      title: "Ole Henriksen Retinol Serum",
      brand: "Ole Henriksen",
      category: check.facts.category,
      productId: "P-RET",
      approvalKey: `check:${check.id}`,
      amountCents: 7200,
      currency: "USD",
      order: { id: "ORDER-9", funding: "card" as const, save: false, capCents: 0 },
    };
    s.intents.push(intent);
    s.checks = s.checks.filter((c) => c.id !== check.id);
    const outcome = { orderId: "ORDER-9", orderStatus: "COMPLETED", captureId: "CAPTURE-9", captureStatus: "COMPLETED", amountCents: 7200, currency: "USD" };
    const { receipt } = recordCheckoutCapture(s, intent, outcome, "capture:order-9", "2026-11-10");
    expect(receipt.captureId).toBe("CAPTURE-9");
    expect(receipt.title).toBe("Ole Henriksen Retinol Serum");
    expect(s.intents.find((i) => i.id === "pi_gone")!.receiptId).toBe(receipt.id);
  });
});
