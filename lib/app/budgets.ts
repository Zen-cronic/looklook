import type { BudgetGroup } from "../shelf/categories";
import { monthKey } from "./dates";
import type { Budgets } from "./types";

export const BUDGET_GROUPS: BudgetGroup[] = ["skincare", "makeup", "haircare", "kitchen", "electronics"];

export const BUDGET_LABELS: Record<BudgetGroup, string> = {
  skincare: "Skincare",
  makeup: "Makeup",
  haircare: "Hair",
  kitchen: "Kitchen",
  electronics: "Electronics",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function spentIn(budgets: Budgets, today: string, group: BudgetGroup): number {
  return round2(budgets.spent[monthKey(today)]?.[group] ?? 0);
}

/** Money left this month per group that has a limit; groups without a limit are left out (no limit). */
export function remainingBudgets(budgets: Budgets, today: string): Partial<Record<BudgetGroup, number>> {
  const out: Partial<Record<BudgetGroup, number>> = {};
  for (const g of BUDGET_GROUPS) {
    const limit = budgets.limits[g];
    if (limit === undefined) continue;
    out[g] = round2(Math.max(0, limit - spentIn(budgets, today, g)));
  }
  return out;
}

export function recordSpend(budgets: Budgets, today: string, group: BudgetGroup, amount: number): void {
  const key = monthKey(today);
  const month = (budgets.spent[key] ??= {});
  month[group] = round2((month[group] ?? 0) + amount);
}

export function refundSpend(budgets: Budgets, today: string, group: BudgetGroup, amount: number): void {
  const key = monthKey(today);
  const month = (budgets.spent[key] ??= {});
  month[group] = round2(Math.max(0, (month[group] ?? 0) - amount));
}

/** Set or clear a monthly limit. */
export function setLimit(budgets: Budgets, group: BudgetGroup, limit: number | null): void {
  if (limit === null) delete budgets.limits[group];
  else {
    if (!(Number.isFinite(limit) && limit >= 0 && limit <= 100000)) throw new Error("limit must be between 0 and 100000");
    budgets.limits[group] = round2(limit);
  }
}
