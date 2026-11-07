import results from "@/eval/holdout/results.json";
import casesFile from "@/eval/holdout/cases.json";
import shelfFile from "@/eval/holdout/shelf.json";
import history from "@/eval/holdout/history.json";
import { APP_NAME } from "../brand";

/**
 * The held-out skip set, as scored once. Every number here is read from the
 * committed results of that single run (eval/holdout/results.json); nothing
 * is re-run, so later engine changes can't move it.
 */

export interface HeldOutRow {
  id: string;
  product: string;
  store: string;
  price: number | null;
  expected: string;
  expectedReasons: string[];
  got: string;
  rule: string;
  why: string;
  /** The closest shelf item the engine compared it with, and the score. */
  owned?: string;
  score?: number | null;
  /** A skip that needed the default that counts an unknown opened-return policy as not returnable. */
  onDefault: boolean;
  /** At the time of the run the app had no such category, so the product reached the engine with none and it asked. */
  unsupportedCategory?: string;
}

export interface CommitPoint {
  commit: string;
  at: string;
  what: string;
}

/** A later re-run of the held-out set on a changed engine. Recorded beside the frozen run, never in its place. */
export interface AfterChangesRun {
  commit: string;
  at: string;
  what: string;
  skipCorrect: number;
  n: number;
  precision: number;
  recall: number;
  baselines: Array<{ id: string; label: string; skipCorrect: number }>;
  wrongSkips: string[];
  missedSkips: string[];
  verdictAgreement: number;
}

export interface HeldOutResult {
  source: string;
  asOf: string;
  n: number;
  skipCorrect: number;
  precision: number;
  recall: number;
  skipsMade: number;
  skipsRight: number;
  skipsExpected: number;
  verdictAgreement: number;
  baselines: Array<{ id: string; label: string; skipCorrect: number; skipsMade: number; skipsRight: number }>;
  split: { onEvidence: number; onDefault: number; dollarsAvoided: number; dollarsOnEvidence: number; dollarsOnDefault: number };
  order: { engine: CommitPoint; expectations: CommitPoint; scoredRun: CommitPoint & { ranAt: string } };
  runnerFixes: string[];
  catches: HeldOutRow[];
  wrongSkips: HeldOutRow[];
  missedSkips: HeldOutRow[];
  /** Verdicts that disagree without being about skip (a wait or ask where buy or wait was expected). */
  otherMisses: HeldOutRow[];
  cases: HeldOutRow[];
  afterChanges: AfterChangesRun[];
}

interface CaseJson {
  id: string;
  brand: string;
  name: string;
  variant?: string;
  category: string;
  store: string;
  priceShown: number | null;
  expected: { verdict: string; reasons: string[]; why: string };
}

interface ResultCaseJson {
  id: string;
  expected: string;
  verdict: string;
  rule: string;
  flags: string[];
  shelfItem: string | null;
  score: number | null;
  policyUrl: string | null;
}

export function heldOutResult(): HeldOutResult {
  const cases = (casesFile as unknown as { cases: CaseJson[] }).cases;
  const shelf = (shelfFile as unknown as { items: Array<{ id: string; brand: string; name: string }> }).items;
  const r = results as unknown as {
    asOf: string;
    headline: { skipCorrect: number; n: number; precision: number; recall: number };
    counts: { tp: number; fp: number; fn: number };
    split: HeldOutResult["split"];
    baselines: HeldOutResult["baselines"];
    verdictAgreement: number;
    runnerFixes: string[];
    cases: ResultCaseJson[];
  };
  const unsupported = new Set(history.unsupportedCategoriesAtRun);
  const rows: HeldOutRow[] = r.cases.map((rc) => {
    const c = cases.find((x) => x.id === rc.id);
    if (!c) throw new Error(`held-out case ${rc.id} missing from cases.json`);
    const owned = rc.shelfItem ? shelf.find((i) => i.id === rc.shelfItem) : undefined;
    return {
      id: rc.id,
      product: `${c.brand} ${c.name}${c.variant ? ` (${c.variant})` : ""}`,
      store: c.store,
      price: c.priceShown,
      expected: rc.expected,
      expectedReasons: c.expected.reasons,
      got: rc.verdict,
      rule: rc.rule,
      why: c.expected.why,
      owned: owned ? `${owned.brand} ${owned.name}`.trim() : undefined,
      score: rc.score,
      // Unknown policies have no source page; cited ones always do.
      onDefault: rc.verdict === "skip" && rc.rule === "overlap-non-returnable" && rc.policyUrl === null,
      unsupportedCategory: unsupported.has(c.category) && rc.rule === "identity-unconfirmed" ? c.category : undefined,
    };
  });
  const isSkip = (v: string) => v === "skip";
  return {
    source: `eval/holdout/results.json, committed in ${history.scoredRun.commit.slice(0, 7)}`,
    asOf: r.asOf,
    n: r.headline.n,
    skipCorrect: r.headline.skipCorrect,
    precision: r.headline.precision,
    recall: r.headline.recall,
    skipsMade: r.counts.tp + r.counts.fp,
    skipsRight: r.counts.tp,
    skipsExpected: r.counts.tp + r.counts.fn,
    verdictAgreement: r.verdictAgreement,
    baselines: r.baselines,
    split: r.split,
    order: { engine: history.engine, expectations: history.expectations, scoredRun: history.scoredRun },
    runnerFixes: r.runnerFixes,
    catches: rows.filter((x) => isSkip(x.expected) && isSkip(x.got)),
    wrongSkips: rows.filter((x) => !isSkip(x.expected) && isSkip(x.got)),
    missedSkips: rows.filter((x) => isSkip(x.expected) && !isSkip(x.got)),
    otherMisses: rows.filter((x) => x.expected !== x.got && isSkip(x.expected) === isSkip(x.got)),
    cases: rows,
    afterChanges: history.afterChanges as unknown as AfterChangesRun[],
  };
}

export function baselineScore(r: { baselines: Array<{ id: string; skipCorrect: number }> }, id: "always-skip" | "same-category"): number {
  return r.baselines.find((b) => b.id === id)?.skipCorrect ?? 0;
}

/** The headline sentence, from the frozen run. */
export function heldOutHeadline(r: HeldOutResult = heldOutResult()): string {
  return `On ${r.n} products it had never seen, ${APP_NAME}'s skip was right ${r.skipCorrect} times. Saying skip to everything gets ${baselineScore(r, "always-skip")}; skipping anything in a category you own gets ${baselineScore(r, "same-category")}.`;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function rowJson(x: HeldOutRow) {
  return {
    id: x.id,
    product: x.product,
    store: x.store,
    expected: x.expected,
    got: x.got,
    rule: x.rule,
    ...(x.unsupportedCategory ? { categoryNotSupportedAtRun: x.unsupportedCategory } : {}),
    ...(x.owned ? { closestOwned: x.owned, score: x.score } : {}),
  };
}

/** The held-out block of the eval API responses. `full` adds every case. */
export function heldOutJson(r: HeldOutResult, full = false) {
  return {
    headline: heldOutHeadline(r),
    source: r.source,
    rerun: false,
    skipCorrect: r.skipCorrect,
    n: r.n,
    skipPrecision: round3(r.precision),
    skipRecall: round3(r.recall),
    skipsMade: r.skipsMade,
    skipsRight: r.skipsRight,
    skipsExpected: r.skipsExpected,
    baselines: r.baselines.map((b) => ({ id: b.id, label: b.label, skipCorrect: b.skipCorrect })),
    correctSkips: { onEvidence: r.split.onEvidence, onUnknownPolicyDefault: r.split.onDefault },
    dollarsAvoided: { total: r.split.dollarsAvoided, onEvidence: r.split.dollarsOnEvidence, onUnknownPolicyDefault: r.split.dollarsOnDefault },
    orderOfWork: [
      { step: "engine last changed", commit: r.order.engine.commit.slice(0, 7), at: r.order.engine.at },
      { step: "expectations committed", commit: r.order.expectations.commit.slice(0, 7), at: r.order.expectations.at },
      { step: "scored run committed", commit: r.order.scoredRun.commit.slice(0, 7), at: r.order.scoredRun.at, ranAt: r.order.scoredRun.ranAt },
    ],
    wrongSkips: r.wrongSkips.map(rowJson),
    missedSkips: r.missedSkips.map(rowJson),
    otherMisses: r.otherMisses.map(rowJson),
    ...(full ? { verdictAgreement: round3(r.verdictAgreement), runnerFixes: r.runnerFixes, cases: r.cases.map(rowJson) } : {}),
    scenarioDate: r.asOf,
  };
}
