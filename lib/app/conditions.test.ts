import { describe, expect, it } from "vitest";
import { templateReason } from "../verdict/reason";
import type { Decision } from "../verdict/types";
import { returnsLine } from "./explain";
import { seedState } from "./seed";

const policy = (retailerId: string, retailerName: string, openedNeeds?: string) => ({
  retailerId,
  retailerName,
  group: "beauty" as const,
  returnableOpened: "yes" as const,
  windowDays: 60,
  sourceUrl: "https://example.com",
  checkedOn: "2026-11-07",
  fallback: false,
  ...(openedNeeds ? { openedNeeds } : {}),
});

describe("the receipt condition travels with the verdict", () => {
  it("saves the store's opened-return condition in the decided verdict", () => {
    const s = seedState("conditions000001", "2026-11-10");
    const cvs = s.checks.find((c) => c.store?.toLowerCase().includes("cvs") || c.decision.evidence.policy?.retailerId === "cvs")!;
    expect(cvs.decision.evidence.policy?.retailerId).toBe("cvs");
    expect((cvs.decision.evidence.policy as { openedNeeds?: string }).openedNeeds).toBe("with a receipt");
  });

  it("puts the condition in the reason line where the policy requires it", () => {
    const d = {
      verdict: "buy",
      rule: "clear-to-buy",
      flags: [],
      evidence: { trace: [], shelf: { itemId: "x", brand: "Supergoop", name: "Unseen Sunscreen", category: "sunscreen", relation: "overlap", score: 0.5, matched: [], opened: true, runOutDate: null }, policy: policy("cvs", "CVS Pharmacy", "with a receipt") },
    } as unknown as Decision;
    expect(templateReason(d, { brand: "La Roche-Posay", name: "Anthelios" } as never)).toContain("CVS Pharmacy takes it back opened with a receipt");
  });

  it("reads the condition from the saved verdict, not from today's table", () => {
    const saved = { verdict: "buy", rule: "clear-to-buy", flags: [], evidence: { trace: [], policy: policy("ulta", "Ulta Beauty", "with a receipt") } } as unknown as Decision;
    expect(returnsLine(saved)?.text).toContain("with a receipt");
  });
});
