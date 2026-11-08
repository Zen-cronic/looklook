import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appToday, daysBetween } from "./dates";
import { REBUY_LEAD_DAYS, stapleCycle } from "./payments";
import { fakePayPal, savedCard } from "./testing";
import type { SessionState } from "./types";

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

describe("the amount and the card the shopper approved", () => {
  it("refuses a charge when the price moved after the card was shown, then charges the re-approved price", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { updateSession } = await import("./store");
    const pp = fakePayPal();
    const { sid } = await shopper();
    await updateSession(sid, (s) => {
      s.watch[0].currentPrice = 8.9;
    });
    const stale = await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: 850 } }, { client: () => pp.client as never }).catch((e) => e);
    expect(stale.status).toBe(409);
    expect(stale.extra).toMatchObject({ priceChanged: true, amountCents: 890 });
    expect(pp.requests).toHaveLength(0);
    const ok = await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: 890 } }, { client: () => pp.client as never });
    expect(pp.orders.size).toBe(1);
    expect([...pp.orders.values()][0].cents).toBe(890);
    expect(ok.captureId).toBe("CAPTURE-1");
  });

  it("refuses a yes without the amount shown", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const pp = fakePayPal();
    const { sid, cycle } = await shopper();
    const r = await payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle } }, { client: () => pp.client as never }).catch((e) => e);
    expect(r.status).toBe(400);
    expect(pp.requests).toHaveLength(0);
  });

  it("derives a staple's cycle on the server: a made-up or early cycle never reaches PayPal", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { updateSession } = await import("./store");
    const pp = fakePayPal();
    const { sid, stapleCents } = await shopper();
    for (const cycle of ["a", "b", "2099-01-01"]) {
      const r = await payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-ha", cycle }, approved: { amountCents: stapleCents } }, { client: () => pp.client as never }).catch((e) => e);
      expect(r.status).toBe(409);
      expect(r.extra?.stale).toBe(true);
    }
    // The right cycle, but not due yet.
    const cream = await updateSession(sid, (s) => {
      s.dayOffset = 0;
      const i = s.shelf.find((x) => x.id === "sh-cream")!;
      i.runOutDate = "2099-06-01";
      return { cycle: i.runOutDate, cents: Math.round(i.price! * 100) };
    });
    const early = await payWithSavedMethod(sid, { source: { kind: "staple", shelfItemId: "sh-cream", cycle: cream.cycle }, approved: { amountCents: cream.cents } }, { client: () => pp.client as never }).catch((e) => e);
    expect(early.status).toBe(409);
    expect(pp.requests).toHaveLength(0);
  });

  it("clears the drop once it is bought", async () => {
    const { payWithSavedMethod } = await import("./pay");
    const { loadSession } = await import("./store");
    const pp = fakePayPal();
    const { sid, dropCents } = await shopper();
    await payWithSavedMethod(sid, { source: { kind: "watch", watchId: "wt_ha" }, approved: { amountCents: dropCents } }, { client: () => pp.client as never });
    const w = loadSession(sid).watch[0];
    expect(w.droppedAt).toBeUndefined();
    expect(w.closedAt).toBeDefined();
  });
});
