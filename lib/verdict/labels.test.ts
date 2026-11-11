import { describe, expect, it } from "vitest";
import { RULE_ORDER } from "../app/explain";
import { readFileSync } from "node:fs";
import { chipReason, LEGEND_PROTECTION, LEGEND_VERDICTS, RULE_REASON, VERDICT_LABELS } from "./labels";

describe("verdict labels: the chip word, the reason next to it, and the legend", () => {
  it("keeps the words Skip, Wait and Buy, with a short default reason and the legend's plain sentence", () => {
    expect(LEGEND_VERDICTS.map((v) => VERDICT_LABELS[v].word)).toEqual(["Skip", "Wait", "Buy"]);
    expect(VERDICT_LABELS.skip.reason).toBe("You already own one");
    expect(VERDICT_LABELS.wait.reason).toBe("Price is higher than usual");
    expect(VERDICT_LABELS.buy.reason).toBe("Worth it, within budget");
    expect(VERDICT_LABELS.skip.legend).toBe("You already own something that does the same job, so LookLook says don't buy it.");
    expect(VERDICT_LABELS.wait.legend).toBe("The price is higher than usual or over your budget, so LookLook watches it and asks you again when it drops.");
    expect(VERDICT_LABELS.buy.legend).toBe("Worth it and within your budget. It's paid with PayPal only after your yes.");
  });

  it("names every deciding rule in a few everyday words, and falls back to the verdict's reason", () => {
    for (const rule of RULE_ORDER) expect(chipReason("wait", rule), rule).not.toBe("");
    expect(chipReason("wait", "over-budget")).toBe("Over this month's budget");
    expect(chipReason("skip", "owns-similar")).toBe("You already own one");
    expect(chipReason("buy", "not-a-rule")).toBe("Worth it, within budget");
    expect(chipReason("wait")).toBe("Price is higher than usual");
    const reasons = RULE_ORDER.map((r) => chipReason("wait", r));
    for (const r of reasons) expect(r.split(" ").length, r).toBeLessThanOrEqual(6);
  });

  it("uses no semicolons, middle dots or sandbox labels in any of these words", () => {
    const texts = [...Object.values(VERDICT_LABELS).flatMap((l) => [l.word, l.reason, l.legend]), LEGEND_PROTECTION, ...RULE_ORDER.map((r) => chipReason("skip", r))];
    for (const t of texts) expect(t, t).not.toMatch(/;|·|sandbox|\btest\b/i);
  });

  it("uses the dashboard's words for each rule, so a rule reads the same on every page", () => {
    const studio = readFileSync("app/studio/widgets.tsx", "utf8");
    for (const [rule, words] of Object.entries(RULE_REASON)) expect(studio, rule).toContain(`"${rule}": "${words}"`);
  });
});
