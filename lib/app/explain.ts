import type { Decision, RuleId } from "../verdict/types";

/** Each rule in plain words, as shown under "See why". */
export const RULE_TEXT: Record<RuleId, string> = {
  "identity-unconfirmed": "We weren't sure which product this is",
  "owns-unopened": "You have the same product, unopened",
  "run-out-unknown": "You have it open, run-out date not set",
  "not-needed-yet": "Yours lasts past the next two weeks",
  "owns-similar": "You own something that does the same job",
  "overlap-non-returnable": "It overlaps with something you own, and the store may not take it back opened",
  "price-unknown": "No price was shown",
  "over-budget": "It's more than what's left in this month's budget",
  "no-price-history": "No reliable price history yet",
  "above-usual-price": "The price is above its usual low",
  "replacing-run-out": "It replaces something that runs out soon, at a fair price",
  "clear-to-buy": "Nothing similar on your shelf, within budget, fair price",
};

export const RULE_ORDER: RuleId[] = [
  "identity-unconfirmed",
  "owns-unopened",
  "run-out-unknown",
  "not-needed-yet",
  "owns-similar",
  "overlap-non-returnable",
  "price-unknown",
  "over-budget",
  "no-price-history",
  "above-usual-price",
  "replacing-run-out",
  "clear-to-buy",
];

export type ReturnsTone = "ok" | "no" | "maybe" | "unknown";

const GROUP_WORD = { beauty: "beauty", electronics: "electronics", general: "items" } as const;

/**
 * The return-policy line. At most stores opened beauty can go back, so this
 * is usually reassurance; it is a reason to skip only where the cited policy
 * refuses opened items or the policy is unknown.
 */
export function returnsLine(d: Decision, storeLabel?: string): { tone: ReturnsTone; text: string } | undefined {
  const p = d.evidence.policy;
  if (!p) return undefined;
  const store = p.fallback ? storeLabel || "this store" : p.retailerName;
  const what = GROUP_WORD[p.group];
  switch (p.returnableOpened) {
    case "yes": {
      const window = p.windowDays ? ` within ${p.windowDays} days` : "";
      const tail = d.verdict === "skip" ? "" : ", so trying it is low risk";
      return { tone: "ok", text: `${store} takes opened ${what} back${window}${tail}.` };
    }
    case "no":
      return { tone: "no", text: `${store} may refuse it once it's opened.` };
    case "conditional":
      return { tone: "maybe", text: `${store} takes opened ${what} back only on conditions${p.windowDays ? ` (${p.windowDays} days)` : ""}.` };
    default:
      return { tone: "unknown", text: `We couldn't find whether ${store} takes ${what} back once opened, so we treat it as not returnable.` };
  }
}

export function relationText(relation: string): string {
  switch (relation) {
    case "same-product":
      return "same product";
    case "near-duplicate":
      return "near-identical";
    case "overlap":
      return "partly overlapping";
    default:
      return "different";
  }
}
