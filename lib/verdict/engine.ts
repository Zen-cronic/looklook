import { openedReturnPolicy } from "../policies";
import { budgetGroupOf } from "../shelf/categories";
import { NEAR_DUPLICATE, OVERLAP, rankShelf, replacesJob, sameProduct } from "../shelf/similarity";
import type { ShelfItem } from "../shelf/types";
import type { Decision, Evidence, RuleId, ShelfEvidence, Verdict, VerdictInput } from "./types";

/**
 * Settings, fixed in code. A purchase is "needed" when a shelf item in the
 * same category runs out within LEAD_DAYS; within URGENT_DAYS the price is no
 * longer worth waiting on. Price settings match the wait rule tested in the
 * replay (tolerance 0.05, minimum depth 0.03).
 */
export const SETTINGS = {
  minIdentityConfidence: 0.7,
  leadDays: 14,
  urgentDays: 3,
  tolerance: 0.05,
  minDepth: 0.03,
  aboveTypical: 0.1,
} as const;

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function shelfEvidence(item: ShelfItem, relation: ShelfEvidence["relation"], score: number, matched: string[]): ShelfEvidence {
  return { itemId: item.id, brand: item.brand, name: item.name, relation, score, matched, opened: item.opened, runOutDate: item.runOutDate };
}

function tier(score: number): ShelfEvidence["relation"] {
  return score >= NEAR_DUPLICATE ? "near-duplicate" : score >= OVERLAP ? "overlap" : "different";
}

/**
 * Decide skip / wait / buy / ask from structured fields only.
 *
 * Order (the first rule that fires decides):
 *  1. identity-unconfirmed  the product or its category isn't known well enough -> ask
 *  2. owns-unopened         the same product is on the shelf, unopened -> skip
 *  3. run-out-unknown       the same product is open but has no run-out date -> wait
 *  4. not-needed-yet        the same product is open and lasts past the lead time -> wait
 *  5. owns-similar          a near-duplicate is on the shelf and isn't running out -> skip
 *  6. overlap-non-returnable a partial overlap, and this store won't (or may not) take it back opened -> skip
 *  7. price-unknown         no price shown -> ask
 *  8. over-budget           price above what's left in the budget group -> wait
 *  9. no-price-history      no usable price history, and not urgent -> wait
 * 10. above-usual-price     above its usual low (or well above typical), and not urgent -> wait
 * 11. replacing-run-out     buy: it replaces something of the same type that runs out soon
 * 12. clear-to-buy          buy
 *
 * Anything that can't be resolved lands on ask or wait, never buy.
 */
export function decide(input: VerdictInput): Decision {
  const trace: RuleId[] = [];
  const evidence: Evidence = { trace };
  const flags: string[] = [];
  const done = (verdict: Verdict, rule: RuleId): Decision => {
    trace.push(rule);
    return { verdict, rule, flags, evidence };
  };
  const pass = (rule: RuleId) => trace.push(rule);

  const { product, today } = input;
  const category = product.category;
  if (!category || (!product.identityConfirmed && !(product.identityConfidence >= SETTINGS.minIdentityConfidence))) {
    return done("ask", "identity-unconfirmed");
  }
  pass("identity-unconfirmed");

  const policy = openedReturnPolicy(input.store, category);
  evidence.policy = {
    retailerId: policy.retailerId,
    retailerName: policy.retailerName,
    group: policy.group,
    returnableOpened: policy.returnableOpened,
    windowDays: policy.windowDays,
    sourceUrl: policy.sourceUrl,
    checkedOn: policy.checkedOn,
    fallback: policy.fallback,
  };
  if (policy.returnableOpened !== "yes") flags.push("non-returnable-opened");

  const sameCategory = input.shelf.filter((i) => i.category === category);
  const runningOut = (i: ShelfItem) => i.runOutDate !== null && daysBetween(today, i.runOutDate) <= SETTINGS.leadDays;

  // The same product already on the shelf.
  const same = sameCategory.filter((i) => sameProduct(i, product));
  const unopened = same.find((i) => !i.opened);
  if (unopened) {
    evidence.shelf = shelfEvidence(unopened, "same-product", 1, []);
    return done("skip", "owns-unopened");
  }
  pass("owns-unopened");
  const sameOpen = same.sort((a, b) => (a.runOutDate ?? "9999").localeCompare(b.runOutDate ?? "9999"))[0];
  if (sameOpen && sameOpen.runOutDate === null) {
    evidence.shelf = shelfEvidence(sameOpen, "same-product", 1, []);
    return done("wait", "run-out-unknown");
  }
  pass("run-out-unknown");
  if (sameOpen && !runningOut(sameOpen)) {
    evidence.shelf = shelfEvidence(sameOpen, "same-product", 1, []);
    evidence.waitUntil = addDays(sameOpen.runOutDate!, -SETTINGS.leadDays);
    return done("wait", "not-needed-yet");
  }
  pass("not-needed-yet");

  // What this purchase would replace: the same product, else the soonest item of the same type running out
  // that the new one does the whole job of (a hyaluronic serum replaces a hyaluronic serum, not any serum).
  const target = { category, attributes: product.attributes };
  const replaced =
    sameOpen ??
    sameCategory
      .filter((i) => runningOut(i) && replacesJob(target, i))
      .sort((a, b) => a.runOutDate!.localeCompare(b.runOutDate!))[0];
  let needBy: string | undefined;
  if (replaced) {
    const s = sameOpen ? { score: 1, matched: [] as string[] } : (rankShelf({ category, attributes: product.attributes }, [replaced])[0] ?? { score: 0, matched: [] });
    needBy = replaced.runOutDate!;
    evidence.replaces = { ...shelfEvidence(replaced, sameOpen ? "same-product" : tier(s.score), s.score, s.matched), daysLeft: daysBetween(today, needBy) };
  }

  // Similar items that are not running out.
  const candidates = sameCategory.filter((i) => !runningOut(i));
  const best = rankShelf({ category, attributes: product.attributes }, candidates)[0];
  if (best) evidence.shelf = shelfEvidence(best.item, tier(best.score), best.score, best.matched);
  if (best && best.score >= NEAR_DUPLICATE) return done("skip", "owns-similar");
  pass("owns-similar");
  if (best && best.score >= OVERLAP && policy.returnableOpened !== "yes") return done("skip", "overlap-non-returnable");
  pass("overlap-non-returnable");

  const price = product.priceShown;
  if (price === null || !(price > 0)) return done("ask", "price-unknown");
  pass("price-unknown");

  const group = budgetGroupOf(category);
  const remaining = input.budgets?.[group];
  if (remaining !== undefined) {
    evidence.budget = { group, remaining, price };
    if (!(price <= remaining)) return done("wait", "over-budget");
  }
  pass("over-budget");

  const urgent = needBy !== undefined && daysBetween(today, needBy) <= SETTINGS.urgentDays;
  if (needBy) evidence.buyBy = needBy;
  const band = input.priceBand;
  if (!band || !band.usable) {
    evidence.price = { shown: price, usable: false };
    if (!urgent) {
      evidence.waitUntil = needBy ? addDays(needBy, -SETTINGS.urgentDays) : undefined;
      return done("wait", "no-price-history");
    }
  } else {
    const target = round2(band.low * (1 + SETTINGS.tolerance));
    evidence.price = { shown: price, typical: band.typical, low: band.low, target, usable: true, asOf: band.asOf };
    const depth = band.typical > 0 ? (band.typical - band.low) / band.typical : 0;
    const wellAboveTypical = price > band.typical * (1 + SETTINGS.aboveTypical);
    const aboveLow = depth >= SETTINGS.minDepth && price > target;
    if ((wellAboveTypical || aboveLow) && !urgent) {
      evidence.waitUntil = needBy ? addDays(needBy, -SETTINGS.urgentDays) : undefined;
      return done("wait", "above-usual-price");
    }
  }
  pass("no-price-history");
  pass("above-usual-price");

  return needBy ? done("buy", "replacing-run-out") : done("buy", "clear-to-buy");
}
