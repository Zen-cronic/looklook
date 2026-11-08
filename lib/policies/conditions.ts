import type { Decision } from "../verdict/types";
import { openedNeedsFor } from "./index";

/**
 * Save what an opened return needs (for example "with a receipt") with the
 * decided verdict, read from the policy table when the verdict is decided. The
 * verdict, its rule and its other evidence are unchanged; pages and the
 * reason line then read the condition from the saved verdict.
 */
export function withReturnConditions(decision: Decision): Decision {
  const p = decision.evidence.policy;
  if (p && !p.fallback && p.returnableOpened === "yes") {
    const needs = openedNeedsFor(p.retailerId, p.group);
    if (needs) p.openedNeeds = needs;
  }
  return decision;
}
