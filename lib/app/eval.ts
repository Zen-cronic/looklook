import cases from "@/eval/skip-set/cases.json";
import bandsFile from "@/eval/skip-set/price-bands.json";
import shelf from "@/eval/skip-set/shelf.json";
import replay from "@/data/replay/result.json";
import provenance from "@/eval/skip-set/provenance.json";
import type { PriceBand } from "../channel3/band";
import { baselines, runCase, scoreOutcomes, splitCorrectSkips, type Baseline, type CaseOutcome, type ShelfFile, type SkipSet, type SkipSplit, skipOnDefault } from "../eval/skip-set";

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
