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
  /** Correct skips where the store won't (or may not) take the item back once opened. */
  nonReturnableCaught: number;
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
    nonReturnableCaught: tp.filter((o) => o.decision.flags.includes("non-returnable-opened")).length,
    wrongSkips: fp,
    missedSkips: fn,
    otherMismatches: outcomes.filter((o) => !o.verdictCorrect && o.skipCorrect),
    confusion,
  };
}
