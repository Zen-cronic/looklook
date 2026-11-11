import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel3Event } from "../channel3/webhooks";
import { remainingBudgets } from "./budgets";
import { addDays, appToday } from "./dates";
import { fakePayPal, savedCard } from "./testing";
import type { SessionState } from "./types";

const previous = { data: process.env.APP_DATA_DIR };
beforeAll(() => {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "guard-data-"));
});
afterAll(() => {
  process.env.APP_DATA_DIR = previous.data;
});

const WEEK_POSTS = ["week-spf", "week-vitc", "week-retinol", "week-peptide"];

let n = 0;
/**
 * The sample week paid with one yes on a saved card (the peptide serum from
 * Sephora, $32.00, and the cleanser due from the shelf), then price guards
 * started with a stand-in for Channel3.
 */
async function paidWeek(opts: { subscribe?: (i: { productId: string; domain: string }) => Promise<string>; setup?: (s: SessionState) => void } = {}) {
  const store = await import("./store");
  const week = await import("./week");
  const guard = await import("./guard");
  const sid = `guardtest${String(++n).padStart(4, "0")}`;
  await store.loadSampleWeek(sid);
  const runId = await store.updateSession(sid, (s) => {
    s.methods.push({ ...savedCard });
    opts.setup?.(s);
    const run = week.newWeekRun(s, WEEK_POSTS, "sample-week");
    week.saveRun(s, run);
    return run.id;
  });
  const pp = fakePayPal();
  const subscribed: Array<{ productId: string; domain: string }> = [];
  const subscribe = opts.subscribe ?? (async (i: { productId: string; domain: string }) => (subscribed.push(i), `sub_${i.productId}`));
  const s0 = store.loadSession(sid);
  const slip = week.buildSlip(s0, week.findRun(s0, runId), appToday(s0.dayOffset));
  await week.approveWeek(sid, runId, slip.hash, {
    client: () => pp.client as never,
    startWatch: async (_sid, checkId) => ({ watchId: `wt_${checkId}`, subscription: { status: "active" } }),
    startGuards: (id, receiptIds) => guard.ensureGuards(id, receiptIds, { subscribe, timeoutMs: 1000 }),
  });
  const s = store.loadSession(sid);
  const peptide = s.receipts.find((r) => r.source.kind === "check" && r.source.checkId === "week-peptide")!;
  const cleanser = s.receipts.find((r) => r.source.kind === "staple")!;
  return { sid, pp, peptide, cleanser, subscribed, store, guard };
}

/** Channel3's price event for the peptide serum at a store. */
function priceEvent(id: string, from: number, to: number, domain = "sephora.com", productId?: string, timestamp = new Date().toISOString()): Channel3Event {
  return { id, timestamp, type: "offer.price.changed", data: { subscription_id: undefined, subject: { product_id: productId, domain }, previous: { price: from, currency: "USD" }, current: { price: to, currency: "USD" } } };
}

const deps = (pp: ReturnType<typeof fakePayPal>) => ({ client: () => pp.client as never, simulated: false });
const refundCalls = (pp: ReturnType<typeof fakePayPal>) => pp.requests.filter((r) => r.path.endsWith("/refund"));

describe("the price guard after the yes", () => {
  it("guards what one yes paid for as long as the store takes it back opened, and has no guard where no such window is on record", async () => {
    const { sid, peptide, cleanser, subscribed, store, guard } = await paidWeek();
    expect(peptide.status).toBe("completed");
    const s = store.loadSession(sid);
    const g = s.receipts.find((r) => r.id === peptide.id)!.guard!;
    // Sephora's cited policy: opened beauty back within 30 days.
    expect(g).toMatchObject({ status: "on", domain: "sephora.com", store: "Sephora", paidCents: 3200, windowDays: 30, subscriptionId: `sub_${peptide.productId}` });
    expect(g.until).toBe(addDays(peptide.on, 30));
    // The cleanser came from walmart.com, a store with no return rules on record: no guard, and no feed started.
    const c = s.receipts.find((r) => r.id === cleanser.id)!.guard!;
    expect(c).toMatchObject({ status: "unavailable", noGuard: "no-rules", windowDays: 0 });
    expect(subscribed.map((x) => x.domain)).toEqual(["sephora.com"]);
    expect(store.indexLookup("subscription", g.subscriptionId!)).toContain(sid);
    // A store that doesn't take opened items back, or only at its discretion, gives no guard either.
    expect(guard.guardWindow("Walgreens", "serum")).toEqual({ ok: false, why: "sometimes" });
    expect(guard.guardWindow("Target", "serum")).toMatchObject({ ok: true });
    expect(guard.guardWindow("Target", "headphones")).toEqual({ ok: false, why: "not-opened" });
  });

  it("puts the refund back into the month's budget, so the next slip can pay a line the budget held back", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    const week = await import("./week");
    const { recordSpend } = await import("./budgets");
    // The hyaluronic serum ($9.90) comes due, with $8.00 left in skincare: the slip holds it back.
    const runId = await store.updateSession(sid, (s) => {
      const today = appToday(s.dayOffset);
      s.shelf.find((i) => i.id === "sh-ha")!.runOutDate = addDays(today, 2);
      const left = remainingBudgets(s.budgets, today).skincare!;
      recordSpend(s.budgets, today, "skincare", left - 8);
      const run = week.newWeekRun(s, ["week-spf"], "posts");
      week.saveRun(s, run);
      return run.id;
    });
    const slip = () => {
      const s = store.loadSession(sid);
      return week.buildSlip(s, week.findRun(s, runId), appToday(s.dayOffset));
    };
    expect(slip().leftOff.map((l) => [l.title, l.leftOff])).toEqual([[expect.stringContaining("Hyaluronic"), "over-budget"]]);
    // Sephora lowers the peptide serum to $28: $4.00 back to the card and to the skincare budget.
    await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_bud", 32, 28, "sephora.com", peptide.productId), deps(pp));
    expect(remainingBudgets(store.loadSession(sid).budgets, appToday(0)).skincare).toBeCloseTo(12);
    expect(slip().lines.map((l) => l.title)).toEqual([expect.stringContaining("Hyaluronic")]);
    expect(slip().leftOff).toHaveLength(0);
  });

  it("refunds the difference once when the same store's price drops inside the window", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    const before = remainingBudgets(store.loadSession(sid).budgets, appToday(0)).skincare!;
    const drop = priceEvent("evt_g1", 32, 28, "sephora.com", peptide.productId);
    const effect = await guard.applyGuardEvent(sid, peptide.id, drop, deps(pp));
    expect(effect).toContain("refunded $4.00");
    const r = store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!;
    expect(r.status).toBe("partly-refunded");
    expect(r.guard!.refunds).toHaveLength(1);
    expect(r.guard!.lowCents).toBe(2800);
    expect(remainingBudgets(store.loadSession(sid).budgets, appToday(0)).skincare).toBeCloseTo(before + 4);
    const call = refundCalls(pp)[0];
    expect(call.path).toBe(`/v2/payments/captures/${peptide.captureId}/refund`);
    expect(call.body).toMatchObject({ amount: { currency_code: "USD", value: "4.00" } });
  });

  it("refunds only the new difference on a second, lower drop, and nothing on a redelivered event", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_a", 32, 28, "sephora.com", peptide.productId), deps(pp));
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_a", 32, 28, "sephora.com", peptide.productId), deps(pp))).toBeUndefined();
    await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_b", 28, 27, "sephora.com", peptide.productId), deps(pp));
    // Same price again from another delivery: already covered down to $27.
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_c", 27.5, 27, "sephora.com", peptide.productId), deps(pp))).toContain("Nothing refunded");
    const r = store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!;
    expect(r.guard!.refunds.map((x) => x.amountCents)).toEqual([400, 100]);
    expect(refundCalls(pp)).toHaveLength(2);
  });

  it("ignores another store, a price below half, a price rise, and a drop after the window", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_x1", 32, 20, "ulta.com", peptide.productId), deps(pp))).toBeUndefined();
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_x2", 32, 5, "sephora.com", peptide.productId), deps(pp))).toContain("listing error");
    // Live at $29, then up to $30: still under the $32 paid, but a rise is not a drop.
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_x3", 29, 30, "sephora.com", peptide.productId), deps(pp))).toContain("isn't a drop");
    await store.updateSession(sid, (s) => {
      s.dayOffset = 31;
    });
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_x4", 32, 28, "sephora.com", peptide.productId), deps(pp))).toContain("after the return window");
    expect(store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!.guard!.status).toBe("ended");
    expect(refundCalls(pp)).toHaveLength(0);
  });

  it("never refunds more than was paid, and credits the budget once even when PayPal's refund webhook arrives first", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    const { applyPayPalEvent } = await import("./paypal-events");
    const before = remainingBudgets(store.loadSession(sid).budgets, appToday(0)).skincare!;
    // The fake names its first refund REFUND-1: PayPal's webhook for it is applied before the guard records it.
    await store.updateSession(sid, (s) =>
      applyPayPalEvent(s, { id: "WH-G1", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND-1", status: "COMPLETED", amount: { currency_code: "USD", value: "4.00" }, links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${peptide.captureId}` }] } }),
    );
    await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_w1", 32, 28, "sephora.com", peptide.productId), deps(pp));
    const s = store.loadSession(sid);
    expect(remainingBudgets(s.budgets, appToday(0)).skincare).toBeCloseTo(before + 4);
    // The shopper refunds the rest by hand; a later drop has nothing left to refund.
    const { refundCapture } = await import("../paypal/refunds");
    const rest = await refundCapture(pp.client as never, peptide.captureId!, { requestId: "refund:rest" });
    await store.updateSession(sid, (x) => {
      const r = x.receipts.find((y) => y.id === peptide.id)!;
      return import("./payments").then(({ applyRefund }) => applyRefund(x, r, rest));
    });
    expect(await guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_w2", 28, 20, "sephora.com", peptide.productId), deps(pp))).toContain("Nothing refunded");
    const refunded = [...pp.refunds.values()].reduce((sum, r) => sum + r.cents, 0);
    expect(refunded).toBe(3200);
  });

  it("serializes two drops that arrive together: the refunds add up to the lower price, not more", async () => {
    const { sid, pp, peptide, store, guard } = await paidWeek();
    await Promise.all([
      guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_p1", 32, 28, "sephora.com", peptide.productId, "2026-11-11T10:00:00Z"), deps(pp)),
      guard.applyGuardEvent(sid, peptide.id, priceEvent("evt_p2", 32, 27, "sephora.com", peptide.productId, "2026-11-11T10:00:01Z"), deps(pp)),
    ]);
    const r = store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!;
    expect(r.guard!.refunds.reduce((sum, x) => sum + x.amountCents, 0)).toBe(500);
  });

  it("treats PayPal's 'still in progress' as try again, and the same request then refunds once", async () => {
    let conflict = true;
    const { sid, peptide, store, guard } = await paidWeek();
    const pp = fakePayPal({ refundConflict: () => conflict });
    pp.capture(peptide.captureId!, 3200);
    const drop = priceEvent("evt_c1", 32, 28, "sephora.com", peptide.productId);
    await expect(guard.applyGuardEvent(sid, peptide.id, drop, deps(pp))).rejects.toBeInstanceOf(guard.GuardBusyError);
    expect(store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!.guard!.eventIds).not.toContain("evt_c1");
    conflict = false;
    expect(await guard.applyGuardEvent(sid, peptide.id, drop, deps(pp))).toContain("refunded $4.00");
    expect(pp.refunds.size).toBe(1);
  });

  it("only refunds: a price event never charges anything", async () => {
    const { sid, peptide, cleanser, guard } = await paidWeek();
    const pp = fakePayPal();
    pp.capture(peptide.captureId!, 3200);
    pp.capture(cleanser.captureId!, cleanser.amountCents);
    for (const [i, [from, to, domain]] of ([[32, 28, "sephora.com"], [28, 26, "sephora.com"], [32, 25, "ulta.com"], [26, 40, "sephora.com"], [40, 2, "sephora.com"]] as const).entries()) {
      await guard.applyGuardEvent(sid, peptide.id, priceEvent(`evt_o${i}`, from, to, domain, peptide.productId), deps(pp));
      await guard.applyGuardEvent(sid, cleanser.id, priceEvent(`evt_q${i}`, from, to, "walmart.com", cleanser.productId), deps(pp));
    }
    expect(pp.requests.length).toBeGreaterThan(0);
    expect(pp.requests.every((r) => r.method === "POST" && r.path.endsWith("/refund"))).toBe(true);
    expect(pp.requests.some((r) => r.path === "/v2/checkout/orders")).toBe(false);
  });

  it("starts no guard on a pending or failed charge, and a price feed that refuses leaves the payment paid", async () => {
    const { sid, peptide, store, guard } = await paidWeek({ subscribe: async () => Promise.reject(new Error("422 selection required")) });
    const r = store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!;
    expect(r.status).toBe("completed");
    expect(r.guard!.status).toBe("unavailable");
    expect(r.guard!.note).toContain("didn't take this product");
    const pending = { ...r, id: "rc_pending", status: "pending" as const, guard: undefined };
    const failed = { ...r, id: "rc_failed", status: "failed" as const, reversedAt: "x", guard: undefined };
    const s = store.loadSession(sid);
    expect(guard.newGuard(s, pending, appToday(0))).toBeUndefined();
    expect(guard.newGuard(s, failed, appToday(0))).toBeUndefined();
  });

  it("never holds up the answer to a payment for long when Channel3 is slow", async () => {
    let release: (id: string) => void = () => undefined;
    const slow = () => new Promise<string>((r) => (release = r));
    const store = await import("./store");
    const guard = await import("./guard");
    const { sid, peptide } = await paidWeek({ subscribe: async () => "sub_fast" });
    await store.updateSession(sid, (s) => {
      s.receipts.find((x) => x.id === peptide.id)!.guard = undefined;
    });
    const t0 = Date.now();
    await guard.ensureGuards(sid, [peptide.id], { subscribe: slow, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!.guard!.status).toBe("starting");
    release("sub_late");
    await new Promise((r) => setTimeout(r, 30));
    expect(store.loadSession(sid).receipts.find((x) => x.id === peptide.id)!.guard).toMatchObject({ status: "on", subscriptionId: "sub_late" });
  });
});
