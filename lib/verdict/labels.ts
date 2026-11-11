import type { RuleId, Verdict } from "./types";

/**
 * The words every page uses for a verdict: the chip's word, the short reason
 * that always sits next to the chip, and the legend's one plain sentence.
 * Display text only. Data keys stay "skip", "wait", "buy" and "ask".
 */
export const VERDICT_LABELS: Record<Verdict, { word: string; reason: string; legend: string }> = {
  skip: {
    word: "Skip",
    reason: "You already own one",
    legend: "You already own something that does the same job, so LookLook says don't buy it.",
  },
  wait: {
    word: "Wait",
    reason: "Price is higher than usual",
    legend: "The price is higher than usual or over your budget, so LookLook watches it and asks you again when it drops.",
  },
  buy: {
    word: "Buy",
    reason: "Worth it, within budget",
    legend: "Worth it and within your budget. It's paid with PayPal only after your yes.",
  },
  ask: {
    word: "Check this",
    reason: "Not sure which product",
    legend: "LookLook isn't sure which product this is, so it asks you to confirm before it answers.",
  },
};

/** The verdicts the legend explains, in the order a shopper meets them. */
export const LEGEND_VERDICTS: Verdict[] = ["skip", "wait", "buy"];

/** One line on price protection, shown under the legend's three verdicts. */
export const LEGEND_PROTECTION =
  "Price protection: if the store lowers its price while it still takes the item back opened, you get the difference back.";

/**
 * The short reason for the rule that decided a verdict, a few everyday words.
 * The same words as the dashboard's chips (SHORT_REASON in app/studio/widgets.tsx), so a rule reads the same everywhere.
 */
const RULE_REASON: Record<RuleId, string> = {
  "identity-unconfirmed": "Not sure which product",
  "owns-unopened": "You have one unopened",
  "run-out-unknown": "Run-out date not set",
  "not-needed-yet": "Yours lasts two more weeks",
  "owns-similar": "You already own one",
  "overlap-non-returnable": "Overlaps, may not go back",
  "price-unknown": "No price shown",
  "over-budget": "Over this month's budget",
  "no-price-history": "Not enough price history",
  "above-usual-price": "Price is higher than usual",
  "replacing-run-out": "Replaces one running out",
  "clear-to-buy": "Worth it, within budget",
};

export { RULE_REASON };

/** The reason next to a chip: the deciding rule's words when known, else the verdict's default. */
export function chipReason(verdict: Verdict, rule?: string): string {
  return (rule && RULE_REASON[rule as RuleId]) || VERDICT_LABELS[verdict].reason;
}
