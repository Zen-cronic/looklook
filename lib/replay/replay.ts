import { median } from "../channel3/clean";

/**
 * Replay of the wait rule on daily price histories.
 *
 * A shopper sees an item on a "sight day" and needs it by sight + horizon
 * (a staple running out). Each strategy picks the day to buy within that
 * window; we compare the prices paid. The rule's settings and each product's
 * reference prices are fixed on days 1-60 and then tested, unchanged, on
 * sight days inside days 61-90. Only timing is measured: a skipped purchase
 * is never counted as money saved.
 */

export interface ReplayConfig {
  /** Days used to fix the rule (days 1..trainDays). */
  trainDays: number;
  /** Days the fixed rule is tested on (the next testDays). */
  testDays: number;
  /** Days between seeing an item and needing it. */
  horizon: number;
}

export const DEFAULT_CONFIG: ReplayConfig = { trainDays: 60, testDays: 30, horizon: 14 };

export interface RuleParams {
  /** Buy when the price is within this share above the reference low. */
  tolerance: number;
  /** Only wait when the reference low is at least this far below the typical price. */
  minDepth: number;
}

export interface ReferencePrices {
  typical: number;
  low: number;
}

/** Returns the day index (within prices) to buy on, between sight and deadline inclusive. */
export type Strategy = (prices: number[], sight: number, deadline: number) => number;

export function referencePrices(trainPrices: number[]): ReferencePrices {
  if (trainPrices.length === 0) throw new Error("no training prices");
  return { typical: median(trainPrices), low: Math.min(...trainPrices) };
}

/** Buy the moment you see it. */
export const buyAtSight: Strategy = (_p, sight) => sight;

/**
 * The common price-alert baseline: watch from the sight day and buy on the
 * first day the price drops below the price you saw; if no alert fires,
 * buy on the day you need it.
 */
export const firstAlert: Strategy = (p, sight, deadline) => {
  for (let d = sight + 1; d <= deadline; d++) if (p[d] < p[sight]) return d;
  return deadline;
};

/**
 * LookLook's wait rule: if the item has a real low (at least minDepth
 * under its typical price) in the reference window, wait for a price within
 * tolerance of that low, buying on the deadline if it never comes. If the
 * item has no real low, there is nothing to wait for: buy now.
 */
export function waitRule(ref: ReferencePrices, params: RuleParams): Strategy {
  const depth = ref.typical > 0 ? (ref.typical - ref.low) / ref.typical : 0;
  const target = ref.low * (1 + params.tolerance);
  return (p, sight, deadline) => {
    if (depth < params.minDepth) return sight;
    for (let d = sight; d <= deadline; d++) if (p[d] <= target) return d;
    return deadline;
  };
}

/** Upper bound: the cheapest day in the window, known only in hindsight. */
export const hindsightBest: Strategy = (p, sight, deadline) => {
  let best = sight;
  for (let d = sight; d <= deadline; d++) if (p[d] < p[best]) best = d;
  return best;
};

/** Seeded PRNG (mulberry32) so the control is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Negative control: wait a random number of days. Timing with no information should save about nothing. */
export function randomDay(seed: number): Strategy {
  const r = rng(seed);
  return (_p, sight, deadline) => sight + Math.floor(r() * (deadline - sight + 1));
}

/** Mean price paid by a strategy over every sight day in [from, to - horizon]. */
export function meanPricePaid(prices: number[], strategy: Strategy, from: number, to: number, horizon: number): { mean: number; purchases: number } {
  let sum = 0;
  let n = 0;
  for (let sight = from; sight + horizon <= to; sight++) {
    const day = strategy(prices, sight, sight + horizon);
    if (day < sight || day > sight + horizon) throw new Error(`strategy bought outside its window: ${day}`);
    sum += prices[day];
    n += 1;
  }
  if (n === 0) throw new Error("window shorter than the horizon");
  return { mean: sum / n, purchases: n };
}

export interface ReplayProduct {
  id: string;
  title: string;
  category: string;
  /** Daily prices, oldest first; the last trainDays + testDays are used. */
  daily: number[];
}

export const PARAM_GRID: RuleParams[] = [0, 0.02, 0.05, 0.1].flatMap((tolerance) => [0.03, 0.05, 0.1, 0.15].map((minDepth) => ({ tolerance, minDepth })));

function windowOf(p: ReplayProduct, cfg: ReplayConfig): number[] {
  const need = cfg.trainDays + cfg.testDays;
  if (p.daily.length < need) throw new Error(`${p.id} has ${p.daily.length} days, needs ${need}`);
  return p.daily.slice(-need);
}

/** Pick the rule settings with the most savings against the baseline on days 1..trainDays only. */
export function fitParams(products: ReplayProduct[], cfg: ReplayConfig = DEFAULT_CONFIG, grid: RuleParams[] = PARAM_GRID): { params: RuleParams; trainSaved: number } {
  let best: { params: RuleParams; trainSaved: number } | undefined;
  for (const params of grid) {
    let saved = 0;
    for (const p of products) {
      const w = windowOf(p, cfg);
      const train = w.slice(0, cfg.trainDays);
      const ref = referencePrices(train);
      const base = meanPricePaid(train, firstAlert, 0, cfg.trainDays - 1, cfg.horizon).mean;
      const rule = meanPricePaid(train, waitRule(ref, params), 0, cfg.trainDays - 1, cfg.horizon).mean;
      saved += base - rule;
    }
    if (!best || saved > best.trainSaved + 1e-9) best = { params, trainSaved: saved };
  }
  return best!;
}

export interface ProductResult {
  id: string;
  title: string;
  category: string;
  typical: number;
  referenceLow: number;
  waits: boolean;
  /** Mean price paid per purchase in the test window. */
  baseline: number;
  atSight: number;
  rule: number;
  control: number;
  hindsight: number;
  purchases: number;
  movedInTest: boolean;
}

export interface Totals {
  products: number;
  baselineSpend: number;
  ruleSpend: number;
  saved: number;
  savedPct: number;
  savedVsAtSight: number;
  controlSaved: number;
  /** The control against buying at first sight; near zero when timing carries no information. */
  controlVsAtSight: number;
  hindsightSaved: number;
  won: number;
  lost: number;
  tied: number;
}

export interface ReplayReport {
  config: ReplayConfig;
  params: RuleParams;
  trainSaved: number;
  totals: Totals;
  byCategory: Record<string, Totals>;
  products: ProductResult[];
}

export function testProduct(p: ReplayProduct, params: RuleParams, cfg: ReplayConfig = DEFAULT_CONFIG, controlSeed = 1): ProductResult {
  const w = windowOf(p, cfg);
  const ref = referencePrices(w.slice(0, cfg.trainDays));
  const from = cfg.trainDays;
  const to = cfg.trainDays + cfg.testDays - 1;
  const run = (s: Strategy) => meanPricePaid(w, s, from, to, cfg.horizon);
  const baseline = run(firstAlert);
  const test = w.slice(from);
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    typical: ref.typical,
    referenceLow: ref.low,
    waits: (ref.typical - ref.low) / ref.typical >= params.minDepth,
    baseline: baseline.mean,
    atSight: run(buyAtSight).mean,
    rule: run(waitRule(ref, params)).mean,
    control: run(randomDay(controlSeed)).mean,
    hindsight: run(hindsightBest).mean,
    purchases: baseline.purchases,
    movedInTest: new Set(test).size > 1,
  };
}

/** One purchase per product: totals are sums of the mean price paid per product. */
export function totals(results: ProductResult[]): Totals {
  const sum = (f: (r: ProductResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const baselineSpend = sum((r) => r.baseline);
  const ruleSpend = sum((r) => r.rule);
  const eps = 0.005;
  return {
    products: results.length,
    baselineSpend,
    ruleSpend,
    saved: baselineSpend - ruleSpend,
    savedPct: baselineSpend > 0 ? (baselineSpend - ruleSpend) / baselineSpend : 0,
    savedVsAtSight: sum((r) => r.atSight - r.rule),
    controlSaved: sum((r) => r.baseline - r.control),
    controlVsAtSight: sum((r) => r.atSight - r.control),
    hindsightSaved: sum((r) => r.baseline - r.hindsight),
    won: results.filter((r) => r.baseline - r.rule > eps).length,
    lost: results.filter((r) => r.rule - r.baseline > eps).length,
    tied: results.filter((r) => Math.abs(r.baseline - r.rule) <= eps).length,
  };
}

/** Fix the rule on days 1..trainDays, then test it unchanged on the rest. */
export function runReplay(products: ReplayProduct[], cfg: ReplayConfig = DEFAULT_CONFIG): ReplayReport {
  const { params, trainSaved } = fitParams(products, cfg);
  const results = products.map((p, i) => testProduct(p, params, cfg, 1000 + i));
  const byCategory: Record<string, Totals> = {};
  for (const c of [...new Set(results.map((r) => r.category))].sort()) byCategory[c] = totals(results.filter((r) => r.category === c));
  return { config: cfg, params, trainSaved, totals: totals(results), byCategory, products: results };
}
