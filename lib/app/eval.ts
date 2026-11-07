import cases from "@/eval/skip-set/cases.json";
import bandsFile from "@/eval/skip-set/price-bands.json";
import shelf from "@/eval/skip-set/shelf.json";
import replay from "@/data/replay/result.json";
import provenance from "@/eval/skip-set/provenance.json";
import type { PriceBand } from "../channel3/band";
import { baselines, runCase, scoreOutcomes, splitCorrectSkips, type Baseline, type CaseOutcome, type ShelfFile, type SkipSet, type SkipSplit, skipOnDefault } from "../eval/skip-set";

/** Products in the development set. */
export const DEV_SET_SIZE = (cases as unknown as SkipSet).cases.length;

export interface CaseRow {
  id: string;
  product: string;
  store: string;
  expected: string;
  got: string;
  rule: string;
  why: string;
  price: number | null;
  /** A skip that needed the unknown-policy default. */
  onDefault: boolean;
  owned?: string;
  policy?: string;
  policyUrl?: string | null;
}

export interface SkipEvalResult {
  ranAt: string;
  ms: number;
  asOf: string;
  n: number;
  skipCorrect: number;
  precision: number;
  recall: number;
  skipsMade: number;
  skipsRight: number;
  skipsExpected: number;
  nearDuplicatesCaught: number;
  nonReturnableCaught: number;
  unknownPolicyCaught: number;
  verdictAgreement: number;
  baselines: Baseline[];
  split: SkipSplit;
  provenance: { expectations: { commit: string; at: string }; engine: { commit: string; at: string }; firstRun: { commit: string; at: string }; changes: Array<{ what: string; result: string; commit?: string; at?: string }> };
  catches: CaseRow[];
  wrongSkips: CaseRow[];
  missedSkips: CaseRow[];
}

function row(o: CaseOutcome): CaseRow {
  const e = o.decision.evidence;
  return {
    id: o.id,
    product: o.label,
    price: o.priceShown,
    onDefault: skipOnDefault(o),
    store: o.store,
    expected: o.expected.verdict,
    got: o.decision.verdict,
    rule: o.decision.rule,
    why: o.expected.why,
    owned: e.shelf ? `${e.shelf.brand} ${e.shelf.name}`.trim() : undefined,
    policy: e.policy ? `${e.policy.retailerName}: opened returns ${e.policy.returnableOpened}` : undefined,
    policyUrl: e.policy?.sourceUrl ?? null,
  };
}

/** Re-run the verdict engine over the committed skip test set. No network, no model. */
export function runSkipEval(): SkipEvalResult {
  const start = performance.now();
  const set = cases as unknown as SkipSet;
  const bands = (bandsFile as unknown as { bands: Record<string, PriceBand | null> }).bands;
  const outcomes = set.cases.map((c) => runCase(c, set, shelf as unknown as ShelfFile, bands));
  const s = scoreOutcomes(outcomes);
  return {
    baselines: baselines(set, shelf as unknown as ShelfFile),
    split: splitCorrectSkips(outcomes),
    provenance,
    ranAt: new Date().toISOString(),
    ms: Math.round((performance.now() - start) * 10) / 10,
    asOf: set.asOf,
    n: s.n,
    skipCorrect: s.skipCorrect,
    precision: s.precision,
    recall: s.recall,
    skipsMade: s.truePositives + s.falsePositives,
    skipsRight: s.truePositives,
    skipsExpected: s.truePositives + s.falseNegatives,
    nearDuplicatesCaught: s.nearDuplicatesCaught,
    nonReturnableCaught: s.nonReturnableCaught,
    unknownPolicyCaught: s.unknownPolicyCaught,
    verdictAgreement: s.verdictAgreement,
    catches: outcomes.filter((o) => o.expected.verdict === "skip" && o.decision.verdict === "skip").map(row),
    wrongSkips: s.wrongSkips.map(row),
    missedSkips: s.missedSkips.map(row),
  };
}

export interface DevRun {
  label: string;
  commit: string;
  at: string;
  result: string;
}

/** The recorded runs on the development set: the first scored run, then each later engine change. */
export function devSetRuns(p: SkipEvalResult["provenance"] = provenance): DevRun[] {
  return [
    { label: "First scored run", commit: p.firstRun.commit, at: p.firstRun.at, result: "55 of 65" },
    ...p.changes.map((c) => ({ label: `After a matching change: ${c.what}`, commit: c.commit ?? "", at: c.at ?? "", result: c.result })),
  ];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The development-set block of the eval API responses, re-run on the server. */
export function devSetJson(r: SkipEvalResult) {
  return {
    label: "The 65 products the matching was developed on (its score is partly fitted)",
    rerun: true,
    headline: `${r.skipCorrect} of ${r.n} skip decisions correct`,
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
    provenance: { expectations: r.provenance.expectations, engine: r.provenance.engine, firstRun: r.provenance.firstRun },
    runs: devSetRuns(r.provenance).map((x) => ({ commit: x.commit.slice(0, 7), at: x.at, result: x.result, what: x.label })),
    wrongSkips: r.wrongSkips.map((c) => ({ id: c.id, product: c.product, store: c.store, rule: c.rule })),
    missedSkips: r.missedSkips.map((c) => ({ id: c.id, product: c.product, store: c.store, got: c.got, rule: c.rule })),
    scenarioDate: r.asOf,
    ranAt: r.ranAt,
    ms: r.ms,
  };
}

export interface ReplaySummary {
  products: number;
  saved: number;
  savedPct: number;
  beautySaved: number;
}

/** The wait-timing replay, as one line: our wait rule against buying on the first price alert. */
export function replaySummary(): ReplaySummary {
  const r = replay as unknown as { totals: { products: number; saved: number; savedPct: number }; byCategory: Record<string, { saved: number }> };
  return { products: r.totals.products, saved: r.totals.saved, savedPct: r.totals.savedPct, beautySaved: r.byCategory["beauty-staples"]?.saved ?? 0 };
}
