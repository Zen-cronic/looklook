import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { heldOutHeadline, heldOutResult } from "./holdout";

const frozen = JSON.parse(readFileSync("eval/holdout/results.json", "utf8"));
const history = JSON.parse(readFileSync("eval/holdout/history.json", "utf8"));

describe("held-out result (read from the single scored run)", () => {
  const r = heldOutResult();

  it("reports the committed run's numbers", () => {
    expect(r.skipCorrect).toBe(frozen.headline.skipCorrect);
    expect(r.n).toBe(frozen.headline.n);
    expect([r.skipCorrect, r.n]).toEqual([28, 30]);
    expect(r.baselines.map((b) => [b.id, b.skipCorrect])).toEqual([
      ["always-skip", 13],
      ["same-category", 19],
    ]);
    expect(r.precision).toBe(frozen.headline.precision);
    expect(r.recall).toBe(frozen.headline.recall);
    expect(r.split).toEqual(frozen.split);
  });

  it("states the headline sentence", () => {
    expect(heldOutHeadline(r)).toBe("On 30 products it had never seen, LookLook's skip was right 28 times. Saying skip to everything gets 13; skipping anything in a category you own gets 19.");
  });

  it("lists every wrong, missed and other miss with the rule that fired", () => {
    expect(r.wrongSkips.map((x) => [x.id, x.rule])).toEqual([["h18", "overlap-non-returnable"]]);
    expect(r.missedSkips.map((x) => [x.id, x.got, x.rule])).toEqual([["h10", "buy", "clear-to-buy"]]);
    expect(r.otherMisses.map((x) => [x.id, x.got, x.rule])).toEqual([
      ["h14", "wait", "above-usual-price"],
      ["h15", "wait", "above-usual-price"],
      ["h20", "ask", "identity-unconfirmed"],
      ["h24", "ask", "identity-unconfirmed"],
      ["h27", "ask", "identity-unconfirmed"],
    ]);
    expect(r.otherMisses.filter((x) => x.unsupportedCategory).map((x) => [x.id, x.unsupportedCategory])).toEqual([
      ["h20", "conditioner"],
      ["h24", "hair-oil"],
      ["h27", "kettle"],
    ]);
    expect(r.catches).toHaveLength(r.skipsRight);
    expect(r.wrongSkips.length + r.missedSkips.length).toBe(r.n - r.skipCorrect);
  });

  it("marks the skips that needed the unknown-policy default, matching the run's split", () => {
    expect(r.catches.filter((x) => x.onDefault)).toHaveLength(frozen.split.onDefault);
  });

  it("keeps the order of work: engine, then expectations, then the scored run", () => {
    expect(history.engine.commit).toBe(frozen.commits.engine);
    expect(history.expectations.commit).toBe(frozen.commits.expectations);
    const t = (iso: string) => Date.parse(iso);
    expect(t(history.engine.at)).toBeLessThan(t(history.expectations.at));
    expect(t(history.expectations.at)).toBeLessThan(t(history.scoredRun.ranAt));
    expect(Math.floor(t(frozen.ranAt) / 1000) * 1000).toBe(t(history.scoredRun.ranAt));
    expect(t(history.scoredRun.ranAt)).toBeLessThan(t(history.scoredRun.at));
  });
});

describe("eval routes", () => {
  let skipGET: () => Promise<Response>;
  let holdoutGET: () => Promise<Response>;
  beforeAll(async () => {
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));
    ({ GET: skipGET } = await import("@/app/api/eval/skip/route"));
    ({ GET: holdoutGET } = await import("@/app/api/eval/holdout/route"));
  });
  afterAll(() => vi.doUnmock("next/server"));

  it("/api/eval/skip leads with the held-out headline and re-runs the development set", async () => {
    const j = await (await skipGET()).json();
    expect(j.headline).toBe(heldOutHeadline());
    expect(j.heldOut).toMatchObject({ skipCorrect: 28, n: 30, rerun: false, skipPrecision: 0.923, skipRecall: 0.923, correctSkips: { onEvidence: 10, onUnknownPolicyDefault: 2 } });
    expect(j.heldOut.orderOfWork.map((s: { commit: string }) => s.commit)).toEqual(["4fbf420", "effe79b", "e3cd601"]);
    expect(j.developmentSet).toMatchObject({ n: 65, rerun: true });
    expect(j.developmentSet.baselines.map((b: { skipCorrect: number }) => b.skipCorrect)).toEqual([39, 40]);
    expect(j.developmentSet.runs[0]).toMatchObject({ result: "55 of 65" });
  });

  it("/api/eval/holdout returns every held-out case and the development set", async () => {
    const j = await (await holdoutGET()).json();
    expect(j.heldOut.cases).toHaveLength(30);
    expect(j.heldOut.otherMisses.filter((c: { categoryNotSupportedAtRun?: string }) => c.categoryNotSupportedAtRun)).toHaveLength(3);
    expect(Array.isArray(j.heldOut.afterLaterChanges)).toBe(true);
    expect(j.developmentSet.n).toBe(65);
  });
});
