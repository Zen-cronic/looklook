import { describe, expect, it } from "vitest";
import type { Decision, RuleId, Verdict } from "../verdict/types";
import { baselines, runCase, scoreOutcomes, shelfFor, splitCorrectSkips, type CaseOutcome, type ShelfFile, type SkipCase, type SkipSet } from "./skip-set";

function outcome(id: string, expected: Verdict, actual: Verdict, rule: RuleId, flags: string[] = [], reasons: RuleId[] = [rule], opened: "yes" | "no" | "conditional" | "unknown" = flags.length ? "no" : "yes"): CaseOutcome {
  const policy = { retailerId: "x", retailerName: "X", group: "beauty" as const, returnableOpened: opened, windowDays: 30, sourceUrl: null, checkedOn: "2026-11-06", fallback: false };
  const decision: Decision = { verdict: actual, rule, flags, evidence: { trace: [rule], policy } };
  const verdictCorrect = expected === actual;
  return {
    id,
    label: id,
    store: "ulta",
    priceShown: 10,
    expected: { verdict: expected, reasons, why: "" },
    decision,
    skipCorrect: (expected === "skip") === (actual === "skip"),
    verdictCorrect,
    reasonCorrect: verdictCorrect && reasons.includes(rule),
  };
}

describe("scoreOutcomes", () => {
  const outcomes = [
    outcome("a", "skip", "skip", "owns-similar"),
    outcome("b", "skip", "skip", "overlap-non-returnable", ["non-returnable-opened"]),
    outcome("c", "skip", "buy", "clear-to-buy", [], ["owns-similar"]),
    outcome("d", "buy", "skip", "overlap-non-returnable", ["non-returnable-opened"], ["clear-to-buy"]),
    outcome("e", "buy", "wait", "above-usual-price", [], ["clear-to-buy"]),
    outcome("f", "wait", "wait", "over-budget"),
    outcome("g", "skip", "skip", "owns-unopened", [], ["owns-similar"]),
    outcome("h", "skip", "skip", "owns-similar", ["non-returnable-opened"], ["owns-similar"], "unknown"),
  ];
  const s = scoreOutcomes(outcomes);

  it("counts skip decisions and precision/recall", () => {
    expect(s.n).toBe(8);
    expect([s.truePositives, s.falsePositives, s.falseNegatives, s.trueNegatives]).toEqual([4, 1, 1, 2]);
    expect(s.skipCorrect).toBe(6);
    expect(s.precision).toBeCloseTo(0.8);
    expect(s.recall).toBeCloseTo(0.8);
  });

  it("lists wrong, missed and other mismatches separately", () => {
    expect(s.wrongSkips.map((o) => o.id)).toEqual(["d"]);
    expect(s.missedSkips.map((o) => o.id)).toEqual(["c"]);
    expect(s.otherMismatches.map((o) => o.id)).toEqual(["e"]);
  });

  it("counts catches by kind among correct skips only", () => {
    expect(s.nearDuplicatesCaught).toBe(3);
    expect(s.nonReturnableCaught).toBe(1);
    expect(s.unknownPolicyCaught).toBe(1);
  });

  it("scores verdict and reason agreement", () => {
    expect(s.verdictAgreement).toBeCloseTo(5 / 8);
    expect(s.reasonAgreement).toBeCloseTo(4 / 5);
    expect(s.confusion.skip.buy).toBe(1);
    expect(s.confusion.buy.skip).toBe(1);
  });

  it("handles an empty set without dividing by zero", () => {
    const empty = scoreOutcomes([]);
    expect([empty.precision, empty.recall, empty.verdictAgreement]).toEqual([0, 0, 0]);
  });
});

describe("runCase", () => {
  const shelf: ShelfFile = {
    budgets: { remaining: { skincare: 50 } },
    items: [{ id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"] }, opened: true, runOutDate: "2027-01-15" }],
  };
  const set: SkipSet = { asOf: "2026-11-07", cases: [] };
  const base: SkipCase = {
    id: "x",
    brand: "Other",
    name: "C Serum",
    category: "serum",
    attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"] },
    store: "ulta",
    source: "creator-post",
    priceShown: 20,
    expected: { verdict: "skip", reasons: ["owns-similar"], why: "" },
  };

  it("applies a case's shelf patch without changing the shared shelf", () => {
    const patched = shelfFor({ ...base, shelfPatch: [{ id: "vitc", runOutDate: "2026-11-10" }] }, shelf.items);
    expect(patched[0].runOutDate).toBe("2026-11-10");
    expect(shelf.items[0].runOutDate).toBe("2027-01-15");
  });

  it("scores one case end to end", () => {
    const o = runCase(base, set, shelf, {});
    expect(o).toMatchObject({ skipCorrect: true, verdictCorrect: true, reasonCorrect: true });
    const patched = runCase({ ...base, shelfPatch: [{ id: "vitc", runOutDate: "2026-11-10" }] }, set, shelf, {});
    expect(patched.decision.verdict).not.toBe("skip");
    expect(patched.skipCorrect).toBe(false);
  });
});

describe("baselines and the skip split", () => {
  const shelf: ShelfFile = {
    budgets: { remaining: { skincare: 50 } },
    items: [{ id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"] }, opened: true, runOutDate: "2027-01-15" }],
  };
  const mk = (id: string, over: Partial<SkipCase>): SkipCase => ({
    id,
    brand: "B",
    name: id,
    category: "serum",
    attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"] },
    store: "ulta",
    source: "creator-post",
    priceShown: 10,
    expected: { verdict: "skip", reasons: ["owns-similar"], why: "" },
    ...over,
  });
  const set: SkipSet = {
    asOf: "2026-11-07",
    cases: [
      mk("dup", {}),
      mk("overlap-unknown", { attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c", "ferulic-acid"] }, store: "example-brand.com", priceShown: 30, expected: { verdict: "skip", reasons: ["overlap-non-returnable"], why: "" } }),
      mk("retinol", { attributes: { primaryActive: "retinol" }, expected: { verdict: "buy", reasons: ["clear-to-buy"], why: "" } }),
      mk("lipstick", { category: "lipstick", attributes: { shadeFamily: "red" }, expected: { verdict: "buy", reasons: ["clear-to-buy"], why: "" } }),
    ],
  };

  it("scores always-skip and same-category-means-skip the same way as the engine", () => {
    const b = baselines(set, shelf);
    expect(b.find((x) => x.id === "always-skip")).toMatchObject({ skipCorrect: 2, skipsMade: 4, skipsRight: 2 });
    // The retinol serum shares the category with the vitamin C serum, so the category rule skips it too.
    expect(b.find((x) => x.id === "same-category")).toMatchObject({ skipCorrect: 3, skipsMade: 3, skipsRight: 2 });
  });

  it("splits correct skips into evidence and the unknown-policy default, with the dollars", () => {
    const outcomes = set.cases.map((c) => runCase(c, set, shelf, {}));
    expect(outcomes.map((o) => o.decision.rule).slice(0, 2)).toEqual(["owns-similar", "overlap-non-returnable"]);
    expect(splitCorrectSkips(outcomes)).toEqual({ onEvidence: 1, onDefault: 1, dollarsAvoided: 40, dollarsOnEvidence: 10, dollarsOnDefault: 30 });
  });
});
