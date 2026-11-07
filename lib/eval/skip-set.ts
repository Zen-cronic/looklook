import type { PriceBand } from "../channel3/band";
import type { Attributes, BudgetGroup, Category } from "../shelf/categories";
import { validateShelfItem } from "../shelf/store";
import type { ShelfItem, ShelfItemInput } from "../shelf/types";
import { decide } from "../verdict/engine";
import type { Decision, RuleId, Verdict, VerdictInput } from "../verdict/types";

/** One product in the skip test set, with the verdict written down before the engine ran. */
export interface SkipCase {
  id: string;
  catalogId?: string;
  brand: string;
  name: string;
  category: Category;
  attributes: Attributes;
  store: string;
  source: "creator-post" | "store-page";
  priceShown: number | null;
  size?: string;
  variant?: string;
  /** Defaults to a confirmed catalogue match. */
  identityConfidence?: number;
  readerNote?: string;
  shelfPatch?: Array<{ id: string } & Partial<Pick<ShelfItem, "opened" | "runOutDate">>>;
  expected: { verdict: Verdict; reasons: RuleId[]; why: string };
}

export interface SkipSet {
  asOf: string;
  cases: SkipCase[];
}

export interface ShelfFile {
  budgets: { remaining: Partial<Record<BudgetGroup, number>> };
  items: ShelfItemInput[];
}

export const CONFIRMED_MATCH_CONFIDENCE = 0.95;

export function shelfFor(c: SkipCase, items: ShelfItemInput[]): ShelfItem[] {
  return items.map((raw) => {
    const patch = c.shelfPatch?.find((p) => p.id === raw.id);
    return validateShelfItem({ ...raw, ...(patch ?? {}), source: "manual", addedOn: "2026-11-01" });
  });
}

export function inputFor(c: SkipCase, set: SkipSet, shelf: ShelfFile, bands: Record<string, PriceBand | null>): VerdictInput {
  return {
    product: {
      brand: c.brand,
      name: c.name,
      category: c.category,
      attributes: c.attributes,
      priceShown: c.priceShown,
      identityConfidence: c.identityConfidence ?? CONFIRMED_MATCH_CONFIDENCE,
    },
    store: c.store,
    shelf: shelfFor(c, shelf.items),
    budgets: shelf.budgets.remaining,
    priceBand: c.catalogId ? (bands[c.catalogId] ?? null) : null,
    today: set.asOf,
  };
}

export interface CaseOutcome {
  id: string;
  label: string;
  store: string;
  priceShown: number | null;
  expected: SkipCase["expected"];
  decision: Decision;
  skipCorrect: boolean;
  verdictCorrect: boolean;
  /** The deciding rule is one of the expected reasons (only meaningful when the verdict matches). */
  reasonCorrect: boolean;
}

export function runCase(c: SkipCase, set: SkipSet, shelf: ShelfFile, bands: Record<string, PriceBand | null>): CaseOutcome {
  const decision = decide(inputFor(c, set, shelf, bands));
  const expectedSkip = c.expected.verdict === "skip";
  const actualSkip = decision.verdict === "skip";
  const verdictCorrect = decision.verdict === c.expected.verdict;
  return {
    id: c.id,
    label: `${c.brand} ${c.name}${c.variant ? ` (${c.variant})` : ""}`,
    store: c.store,
    priceShown: c.priceShown,
    expected: c.expected,
    decision,
    skipCorrect: expectedSkip === actualSkip,
    verdictCorrect,
    reasonCorrect: verdictCorrect && c.expected.reasons.includes(decision.rule),
  };
}

export interface SkipScore {
  n: number;
  /** Cases where the engine skipped exactly when the expectation said skip. */
  skipCorrect: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  verdictAgreement: number;
  reasonAgreement: number;
  /** Correct skips because the shopper owns the same or a near-identical item. */
  nearDuplicatesCaught: number;
  /** Correct skips at a store whose cited policy refuses opened returns or allows them only on conditions. */
  nonReturnableCaught: number;
  /** Correct skips at a store whose opened-return policy is unknown (treated as not returnable). */
  unknownPolicyCaught: number;
  wrongSkips: CaseOutcome[];
  missedSkips: CaseOutcome[];
  /** Verdict mismatches that don't involve skip (e.g. buy vs wait). */
  otherMismatches: CaseOutcome[];
  confusion: Record<Verdict, Record<Verdict, number>>;
}

const VERDICTS: Verdict[] = ["skip", "wait", "buy", "ask"];

export function scoreOutcomes(outcomes: CaseOutcome[]): SkipScore {
  const expectedSkip = (o: CaseOutcome) => o.expected.verdict === "skip";
  const actualSkip = (o: CaseOutcome) => o.decision.verdict === "skip";
  const tp = outcomes.filter((o) => expectedSkip(o) && actualSkip(o));
  const fp = outcomes.filter((o) => !expectedSkip(o) && actualSkip(o));
  const fn = outcomes.filter((o) => expectedSkip(o) && !actualSkip(o));
  const tn = outcomes.length - tp.length - fp.length - fn.length;
  const confusion = Object.fromEntries(VERDICTS.map((e) => [e, Object.fromEntries(VERDICTS.map((a) => [a, 0]))])) as SkipScore["confusion"];
  for (const o of outcomes) confusion[o.expected.verdict][o.decision.verdict] += 1;
  const verdictCorrect = outcomes.filter((o) => o.verdictCorrect);
  const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
  return {
    n: outcomes.length,
    skipCorrect: outcomes.filter((o) => o.skipCorrect).length,
    truePositives: tp.length,
    falsePositives: fp.length,
    falseNegatives: fn.length,
    trueNegatives: tn,
    precision: ratio(tp.length, tp.length + fp.length),
    recall: ratio(tp.length, tp.length + fn.length),
    verdictAgreement: ratio(verdictCorrect.length, outcomes.length),
    reasonAgreement: ratio(verdictCorrect.filter((o) => o.reasonCorrect).length, verdictCorrect.length),
    nearDuplicatesCaught: tp.filter((o) => o.decision.rule === "owns-similar" || o.decision.rule === "owns-unopened").length,
    nonReturnableCaught: tp.filter((o) => ["no", "conditional"].includes(o.decision.evidence.policy?.returnableOpened ?? "")).length,
    unknownPolicyCaught: tp.filter((o) => o.decision.evidence.policy?.returnableOpened === "unknown").length,
    wrongSkips: fp,
    missedSkips: fn,
    otherMismatches: outcomes.filter((o) => !o.verdictCorrect && o.skipCorrect),
    confusion,
  };
}

/** True when this skip leaned on the unknown-policy default: a partial overlap at a store whose opened-return policy we couldn't find. */
export function skipOnDefault(o: CaseOutcome): boolean {
  return o.decision.verdict === "skip" && o.decision.rule === "overlap-non-returnable" && o.decision.evidence.policy?.returnableOpened === "unknown";
}

export interface SkipSplit {
  /** Correct skips decided on evidence: the shelf, or a cited no/conditional opened-return policy. */
  onEvidence: number;
  /** Correct skips that needed the unknown-policy default. */
  onDefault: number;
  /** Sum of the prices shown on correct skips (duplicate or non-returnable spending avoided), dollars. */
  dollarsAvoided: number;
  dollarsOnEvidence: number;
  dollarsOnDefault: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitCorrectSkips(outcomes: CaseOutcome[]): SkipSplit {
  const tp = outcomes.filter((o) => o.expected.verdict === "skip" && o.decision.verdict === "skip");
  const def = tp.filter(skipOnDefault);
  const ev = tp.filter((o) => !skipOnDefault(o));
  const sum = (xs: CaseOutcome[]) => round2(xs.reduce((s, o) => s + (o.priceShown ?? 0), 0));
  return { onEvidence: ev.length, onDefault: def.length, dollarsAvoided: sum(tp), dollarsOnEvidence: sum(ev), dollarsOnDefault: sum(def) };
}

export interface Baseline {
  id: "always-skip" | "same-category";
  label: string;
  skipCorrect: number;
  skipsMade: number;
  skipsRight: number;
}

/**
 * Two simple ways to say skip, scored the same way:
 * always skip, and skip whenever the shelf has anything in the same category.
 */
export function baselines(set: SkipSet, shelf: ShelfFile): Baseline[] {
  const score = (id: Baseline["id"], label: string, skips: (c: SkipCase) => boolean): Baseline => {
    let skipCorrect = 0;
    let skipsMade = 0;
    let skipsRight = 0;
    for (const c of set.cases) {
      const s = skips(c);
      const expected = c.expected.verdict === "skip";
      if (s === expected) skipCorrect += 1;
      if (s) skipsMade += 1;
      if (s && expected) skipsRight += 1;
    }
    return { id, label, skipCorrect, skipsMade, skipsRight };
  };
  return [
    score("always-skip", "Always say skip", () => true),
    score("same-category", "Skip whenever you own anything in the same category", (c) => shelfFor(c, shelf.items).some((i) => i.category === c.category)),
  ];
}
