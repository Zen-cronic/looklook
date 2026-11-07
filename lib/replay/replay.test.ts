import { describe, expect, it } from "vitest";
import { buyAtSight, firstAlert, fitParams, hindsightBest, meanPricePaid, randomDay, referencePrices, runReplay, testProduct, totals, waitRule, type ReplayProduct } from "./replay";

const flat = (p: number, n: number) => Array.from({ length: n }, () => p);
const cfg = { trainDays: 60, testDays: 30, horizon: 14 };

describe("strategies", () => {
  const prices = [20, 20, 19.5, 19.5, 15, 15, 20];

  it("first alert buys on the first drop below the price seen", () => {
    expect(firstAlert(prices, 0, 6)).toBe(2);
    expect(firstAlert(flat(10, 5), 0, 4)).toBe(4);
  });

  it("the wait rule waits for the reference low and skips waiting when there is none", () => {
    const rule = waitRule({ typical: 20, low: 15 }, { tolerance: 0.02, minDepth: 0.05 });
    expect(rule(prices, 0, 6)).toBe(4);
    expect(rule([20, 21, 22], 0, 2)).toBe(2);
    const noLow = waitRule({ typical: 20, low: 19.5 }, { tolerance: 0, minDepth: 0.05 });
    expect(noLow(prices, 0, 6)).toBe(0);
  });

  it("hindsight finds the cheapest day; buy-at-sight buys now; the control stays in the window", () => {
    expect(hindsightBest(prices, 0, 6)).toBe(4);
    expect(buyAtSight(prices, 3, 6)).toBe(3);
    const c = randomDay(7);
    for (let i = 0; i < 50; i++) {
      const d = c(prices, 1, 5);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(5);
    }
  });

  it("reference prices are the median and the minimum", () => {
    expect(referencePrices([10, 12, 8, 12, 12])).toEqual({ typical: 12, low: 8 });
  });

  it("averages over every sight day whose deadline fits", () => {
    const r = meanPricePaid([1, 2, 3, 4], buyAtSight, 0, 3, 2);
    expect(r).toEqual({ mean: 1.5, purchases: 2 });
  });
});

describe("replay", () => {
  // A staple with a 25% sale in the training window and again in the test window.
  const saleItem: ReplayProduct = {
    id: "sale",
    title: "Cream",
    category: "beauty",
    daily: [...flat(24, 20), ...flat(18, 10), ...flat(24, 40), ...flat(18, 10), ...flat(24, 10)],
  };
  const flatItem: ReplayProduct = { id: "flat", title: "Mascara", category: "beauty", daily: flat(14, 90) };
  // A small drop that triggers the alert, then a deeper sale.
  const stepItem: ReplayProduct = {
    id: "step",
    title: "Mixer",
    category: "kitchen",
    daily: [...flat(100, 30), ...flat(75, 10), ...flat(100, 25), ...flat(97, 3), ...flat(75, 12), ...flat(100, 10)],
  };

  it("flat items cost the same under every strategy", () => {
    const r = testProduct(flatItem, { tolerance: 0, minDepth: 0.05 }, cfg);
    expect(r.rule).toBe(14);
    expect(r.baseline).toBe(14);
    expect(r.waits).toBe(false);
    expect(r.movedInTest).toBe(false);
  });

  it("the rule beats the first alert when a small drop comes before the real sale", () => {
    const r = testProduct(stepItem, { tolerance: 0.02, minDepth: 0.05 }, cfg);
    expect(r.rule).toBeLessThan(r.baseline);
    expect(r.hindsight).toBeLessThanOrEqual(r.rule);
  });

  it("fits settings on the training days only and reports totals", () => {
    const fit = fitParams([saleItem, flatItem, stepItem], cfg);
    expect(fit.trainSaved).toBeGreaterThanOrEqual(0);
    const report = runReplay([saleItem, flatItem, stepItem], cfg);
    expect(report.totals.products).toBe(3);
    expect(Object.keys(report.byCategory)).toEqual(["beauty", "kitchen"]);
    expect(report.totals.saved).toBeCloseTo(report.totals.baselineSpend - report.totals.ruleSpend, 10);
    expect(report.totals.won + report.totals.lost + report.totals.tied).toBe(3);
  });

  it("does not look at test days when fixing the rule", () => {
    const a: ReplayProduct = { ...stepItem, daily: [...stepItem.daily.slice(0, 60), ...flat(100, 30)] };
    const b: ReplayProduct = { ...stepItem, daily: [...stepItem.daily.slice(0, 60), ...flat(50, 30)] };
    expect(fitParams([a], cfg)).toEqual(fitParams([b], cfg));
  });

  it("rejects series shorter than the replay window", () => {
    expect(() => testProduct({ ...flatItem, daily: flat(14, 80) }, { tolerance: 0, minDepth: 0.05 }, cfg)).toThrow(/needs 90/);
  });

  it("totals count wins, losses and ties", () => {
    const base = { id: "x", title: "x", category: "c", typical: 1, referenceLow: 1, waits: true, atSight: 10, control: 10, hindsight: 8, purchases: 16, movedInTest: true };
    const t = totals([
      { ...base, baseline: 10, rule: 9 },
      { ...base, baseline: 10, rule: 11 },
      { ...base, baseline: 10, rule: 10 },
    ]);
    expect([t.won, t.lost, t.tied]).toEqual([1, 1, 1]);
    expect(t.saved).toBe(0);
  });
});
