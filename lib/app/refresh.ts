import { createHash } from "node:crypto";
import { withReturnConditions } from "../policies/conditions";
import { decide } from "../verdict/engine";
import { templateReason } from "../verdict/reason";
import type { Decision, ProductFacts } from "../verdict/types";
import { remainingBudgets } from "./budgets";
import type { CheckRecord, SessionState } from "./types";

/** Bump when the reason prompt changes, so cached wording is not reused. */
export const REASON_VERSION = 2;

/** Cache key for the reason line of one decision about one product. */
export function reasonKey(decision: Decision, facts: Pick<ProductFacts, "brand" | "name">): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: REASON_VERSION, decision, facts: { brand: facts.brand, name: facts.name } }))
    .digest("hex");
}

/** Reason wording already written for a decision (by the model), when the same decision comes back. */
export type ReasonLookup = (check: CheckRecord, decision: Decision) => CheckRecord["reason"] | undefined;

/**
 * Decide every open check again against the current shelf, budgets and date,
 * so a verdict, its "runs out in N days" and its "left this month" always
 * agree with the shelf and budget pages. Checks already bought, or waiting
 * for the shopper to confirm which product it is, keep their verdict.
 * Returns how many verdicts changed.
 */
export function refreshChecks(state: SessionState, today: string, reasonFor?: ReasonLookup): number {
  const budgets = remainingBudgets(state.budgets, today);
  let changed = 0;
  for (const c of state.checks) {
    if (c.purchasedReceiptId || c.needsConfirmation || !c.facts.category) continue;
    const decision = withReturnConditions(decide({ product: c.facts, store: c.store, shelf: state.shelf, budgets, priceBand: c.band, today }));
    if (JSON.stringify(decision) === JSON.stringify(c.decision)) continue;
    c.decision = decision;
    c.reason = reasonFor?.(c, decision) ?? { text: templateReason(decision, c.facts), source: "template" };
    c.decidedOn = today;
    changed += 1;
  }
  return changed;
}
