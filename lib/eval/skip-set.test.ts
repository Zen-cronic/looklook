import { describe, expect, it } from "vitest";
import type { Decision, RuleId, Verdict } from "../verdict/types";
import { runCase, scoreOutcomes, shelfFor, type CaseOutcome, type ShelfFile, type SkipCase, type SkipSet } from "./skip-set";

function outcome(id: string, expected: Verdict, actual: Verdict, rule: RuleId, flags: string[] = [], reasons: RuleId[] = [rule]): CaseOutcome {
  const decision: Decision = { verdict: actual, rule, flags, evidence: { trace: [rule] } };
  const verdictCorrect = expected === actual;
  return {
    id,
    label: id,
    store: "ulta",
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
  ];
  const s = scoreOutcomes(outcomes);

  it("counts skip decisions and precision/recall", () => {
    expect(s.n).toBe(7);
    expect([s.truePositives, s.falsePositives, s.falseNegatives, s.trueNegatives]).toEqual([3, 1, 1, 2]);
    expect(s.skipCorrect).toBe(5);
    expect(s.precision).toBeCloseTo(0.75);
    expect(s.recall).toBeCloseTo(0.75);
  });

  it("lists wrong, missed and other mismatches separately", () => {
    expect(s.wrongSkips.map((o) => o.id)).toEqual(["d"]);
    expect(s.missedSkips.map((o) => o.id)).toEqual(["c"]);
    expect(s.otherMismatches.map((o) => o.id)).toEqual(["e"]);
  });

  it("counts catches by kind among correct skips only", () => {
    expect(s.nearDuplicatesCaught).toBe(2);
    expect(s.nonReturnableCaught).toBe(1);
  });

  it("scores verdict and reason agreement", () => {
    expect(s.verdictAgreement).toBeCloseTo(4 / 7);
    expect(s.reasonAgreement).toBeCloseTo(3 / 4);
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
    items: [{ id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c" }, opened: true, runOutDate: "2027-01-15" }],
  };
  const set: SkipSet = { asOf: "2026-11-07", cases: [] };
  const base: SkipCase = {
    id: "x",
    brand: "Other",
    name: "C Serum",
    category: "serum",
    attributes: { primaryActive: "vitamin-c" },
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
