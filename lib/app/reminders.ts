import { budgetGroupOf, type BudgetGroup } from "../shelf/categories";
import { remainingBudgets } from "./budgets";
import { appToday, formatDay } from "./dates";
import { formatDollars } from "./money";
import type { CheckRecord, PurchaseSource, SessionState, WatchItem } from "./types";

/** The first day of the month after this date (budgets restart then). */
export function nextMonthStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * What a wait verdict offers, from the rule that fired:
 * over budget waits for next month's budget, a price wait watches the price,
 * owning one that isn't used up waits for the look-again date.
 */
export type WaitAction =
  | { kind: "budget"; on: string }
  | { kind: "price" }
  | { kind: "run-out"; on: string }
  | { kind: "set-run-out" };

export function waitAction(check: Pick<CheckRecord, "decision">, today: string): WaitAction | undefined {
  const d = check.decision;
  if (d.verdict !== "wait") return undefined;
  switch (d.rule) {
    case "over-budget":
      return { kind: "budget", on: nextMonthStart(today) };
    case "not-needed-yet":
      return d.evidence.waitUntil ? { kind: "run-out", on: d.evidence.waitUntil } : { kind: "set-run-out" };
    case "run-out-unknown":
      return { kind: "set-run-out" };
    default:
      return { kind: "price" };
  }
}

export interface BudgetHold {
  group: BudgetGroup;
  remaining: number;
  price: number;
  restartsOn: string;
}

/** A watched item whose price is still more than what's left in its budget this month. */
export function watchBudgetHold(state: SessionState, w: WatchItem, today: string): BudgetHold | undefined {
  if (!w.category) return undefined;
  const group = budgetGroupOf(w.category);
  const remaining = remainingBudgets(state.budgets, today)[group];
  if (remaining === undefined || w.currentPrice <= remaining) return undefined;
  return { group, remaining, price: w.currentPrice, restartsOn: nextMonthStart(today) };
}

/** Reminders whose date has come (the shopper asked to be told). */
export function dueReminders(state: SessionState, today: string): CheckRecord[] {
  return state.checks.filter((c) => c.reminder && !c.reminder.doneAt && c.reminder.on <= today && !c.purchasedReceiptId);
}

export function upcomingReminders(state: SessionState, today: string): CheckRecord[] {
  return state.checks.filter((c) => c.reminder && !c.reminder.doneAt && c.reminder.on > today && !c.purchasedReceiptId);
}

/** Why a purchase from a price drop can't go ahead yet, or undefined when it can. */
export function budgetHoldFor(state: SessionState, source: PurchaseSource): string | undefined {
  if (source.kind !== "watch") return undefined;
  const w = state.watch.find((x) => x.id === source.watchId);
  if (!w) return undefined;
  const hold = watchBudgetHold(state, w, appToday(state.dayOffset));
  return hold ? `${formatDollars(hold.price)} is still more than the ${formatDollars(hold.remaining)} left in this month's ${hold.group} budget. We'll ask again when it restarts on ${formatDay(hold.restartsOn)}.` : undefined;
}
