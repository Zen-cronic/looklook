import type { Verdict } from "../verdict/types";

/**
 * The Decisions workspace reads these tables (shapes only: safe in the browser). Every row is derived from the
 * shopper's own session, the same records the Check, Shelf and Rebuys pages
 * read, so the workspace never keeps a second copy of the truth.
 */

export type FieldKind = "text" | "money" | "date" | "int" | "bool";

export interface FieldSpec {
  id: string;
  name: string;
  kind: FieldKind;
  description?: string;
  hide?: boolean;
}

export interface TableSpec {
  id: TableId;
  name: string;
  description: string;
  fields: FieldSpec[];
}

export type TableId = "verdicts" | "rebuys" | "shelf" | "watchlist" | "budgets";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell> & { id: string };

export const VERDICT_WORDS: Record<Verdict, string> = { skip: "Skip", wait: "Wait", buy: "Buy", ask: "Check this" };

export const WAITING_FOR = {
  price: "A price drop",
  budget: "Next month's budget",
  runOut: "Yours to run low",
  setRunOut: "A run-out date for yours",
} as const;

export const TABLES: TableSpec[] = [
  {
    id: "verdicts",
    name: "Verdicts",
    description: "One row per product the shopper checked, with the verdict (Skip, Wait, Buy or Check this) and the evidence behind it. Skips come first.",
    fields: [
      { id: "id", name: "Check id", kind: "text" },
      { id: "product", name: "Product", kind: "text" },
      { id: "verdict", name: "Verdict", kind: "text", description: "Skip, Wait, Buy or Check this" },
      { id: "rank", name: "Order", kind: "int", description: "1 for Skip, 2 Wait, 3 Buy, 4 Check this" },
      { id: "reason", name: "Reason", kind: "text", description: "Why the verdict was given. For a bought check it starts 'At the time:' because it describes the day it was decided." },
      { id: "rule", name: "Rule that fired", kind: "text" },
      { id: "store", name: "Store", kind: "text" },
      { id: "price", name: "Price", kind: "money" },
      { id: "owned", name: "You own", kind: "text", description: "The shelf item this overlaps with, if any" },
      { id: "returns", name: "Returns", kind: "text", description: "The store's opened-return policy in plain words" },
      { id: "policyUrl", name: "Policy source", kind: "text" },
      { id: "waitingFor", name: "Waiting for", kind: "text", description: "For Wait verdicts: A price drop, Next month's budget, Yours to run low, or A run-out date for yours. Empty otherwise." },
      { id: "buyAt", name: "Buy at or under", kind: "money", description: "Target price for a price wait" },
      { id: "lookAgain", name: "Look again", kind: "date", description: "When a wait ends: the budget restart or the run-out date" },
      { id: "status", name: "Status", kind: "text", description: "Open, Watching or Bought" },
      { id: "boughtAt", name: "Bought", kind: "text", description: "When it was paid for (US Eastern time), for bought checks; empty otherwise" },
      { id: "decidedOn", name: "Decided on", kind: "date" },
      { id: "payable", name: "Can buy now", kind: "bool" },
      { id: "withinCap", name: "Within cap", kind: "bool" },
    ],
  },
  {
    id: "rebuys",
    name: "Rebuys",
    description: "Purchases waiting for the shopper's yes: staples that run out within five days and watched items whose price dropped to the target.",
    fields: [
      { id: "id", name: "Rebuy id", kind: "text" },
      { id: "kind", name: "Why now", kind: "text", description: "Runs out soon, or Price dropped" },
      { id: "product", name: "Product", kind: "text" },
      { id: "price", name: "Price", kind: "money" },
      { id: "runOutDate", name: "Runs out", kind: "date" },
      { id: "daysLeft", name: "Days left", kind: "int" },
      { id: "store", name: "Store", kind: "text" },
      { id: "sourceKind", name: "Source kind", kind: "text" },
      { id: "sourceRef", name: "Source ref", kind: "text" },
      { id: "cycle", name: "Cycle", kind: "text" },
      { id: "withinCap", name: "Within cap", kind: "bool" },
      { id: "held", name: "On hold", kind: "text", description: "Why it can't be bought yet (budget), if so" },
      { id: "declined", name: "Declined", kind: "text", description: "The PayPal decline on the last try, if any" },
    ],
  },
  {
    id: "shelf",
    name: "Shelf",
    description: "What the shopper owns, with run-out dates and last price.",
    fields: [
      { id: "id", name: "Shelf id", kind: "text" },
      { id: "product", name: "Product", kind: "text" },
      { id: "category", name: "Category", kind: "text" },
      { id: "opened", name: "Opened", kind: "text", description: "Opened or Unopened" },
      { id: "runOutDate", name: "Runs out", kind: "date" },
      { id: "daysLeft", name: "Days left", kind: "int" },
      { id: "price", name: "Last price", kind: "money" },
      { id: "store", name: "Store", kind: "text" },
      { id: "lastRestocked", name: "Restocked (Eastern)", kind: "text", description: "When the last restock was paid for, in US Eastern time" },
    ],
  },
  {
    id: "watchlist",
    name: "Watch list",
    description: "Items waiting for a lower price, with a Channel3 price alert.",
    fields: [
      { id: "id", name: "Watch id", kind: "text" },
      { id: "product", name: "Product", kind: "text" },
      { id: "startPrice", name: "Was", kind: "money" },
      { id: "currentPrice", name: "Now", kind: "money" },
      { id: "targetPrice", name: "Buy at", kind: "money" },
      { id: "status", name: "Status", kind: "text", description: "Watching or Dropped" },
      { id: "alert", name: "Price alert", kind: "text" },
    ],
  },
  {
    id: "budgets",
    name: "Budgets",
    description: "Monthly budget per group: limit, spent and left this month.",
    fields: [
      { id: "id", name: "Group id", kind: "text" },
      { id: "group", name: "Group", kind: "text" },
      { id: "limit", name: "Monthly limit", kind: "money" },
      { id: "spent", name: "Spent", kind: "money" },
      { id: "left", name: "Left", kind: "money" },
    ],
  },
];

export interface SkipFigure {
  right: number;
  n: number;
  alwaysSkip: number;
  sameCategory: number;
  avoided: number;
}

/**
 * A field's column name. Dates counted from the shopper's today say so while
 * the simulated date is on; event times are real and keep their name.
 */
export function fieldName(f: Pick<FieldSpec, "name" | "kind">, dayOffset: number): string {
  return f.kind === "date" && dayOffset > 0 ? `${f.name} (simulated date)` : f.name;
}

export interface StudioPayload {
  today: string;
  dayOffset: number;
  /** The sample week is loaded (fictional shopper and checks). */
  sample: boolean;
  method: { label: string; capCents: number } | null;
  tables: Record<TableId, Row[]>;
  budget: { left: number; limit: number; spent: number };
  waits: WaitCounts;
  skip?: SkipFigure;
}

export interface WaitCounts {
  total: number;
  groups: Array<{ waitingFor: string; count: number }>;
}

/** Waits grouped by what they wait for, counted by our code from the verdict rows (never by a model). */
export function waitCounts(verdicts: Row[]): WaitCounts {
  const waits = verdicts.filter((r) => r.verdict === VERDICT_WORDS.wait && r.status !== "Bought");
  const by = new Map<string, number>();
  for (const r of waits) by.set(String(r.waitingFor), (by.get(String(r.waitingFor)) ?? 0) + 1);
  return { total: waits.length, groups: [...by.entries()].map(([waitingFor, count]) => ({ waitingFor, count })).sort((a, b) => b.count - a.count || a.waitingFor.localeCompare(b.waitingFor)) };
}

export interface TableDiff {
  add: Row[];
  update: Row[];
  remove: string[];
}

function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/** Rows to add, replace and remove so a table shown from `before` matches `after` (keyed by id). */
export function diffRows(before: Row[], after: Row[]): TableDiff {
  const old = new Map(before.map((r) => [r.id, r]));
  const next = new Set(after.map((r) => r.id));
  const add: Row[] = [];
  const update: Row[] = [];
  for (const r of after) {
    const prev = old.get(r.id);
    if (!prev) add.push(r);
    else if (!sameRow(prev, r)) update.push(r);
  }
  return { add, update, remove: before.filter((r) => !next.has(r.id)).map((r) => r.id) };
}

