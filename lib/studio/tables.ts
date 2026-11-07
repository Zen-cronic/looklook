import { BUDGET_GROUPS, BUDGET_LABELS, remainingBudgets, spentIn } from "../app/budgets";
import { daysBetween } from "../app/dates";
import { RULE_TEXT, returnsLine } from "../app/explain";
import { activeMethod, dueStaples, openDecline } from "../app/payments";
import { waitAction, watchBudgetHold } from "../app/reminders";
import { CATEGORY_LABELS } from "../app/shelf-ui";
import { atTheTime, boughtReceipt, eventTime, restockedLabel } from "../app/when";
import type { CheckRecord, PurchaseSource, SessionState } from "../app/types";
import type { Verdict } from "../verdict/types";
import { VERDICT_WORDS, WAITING_FOR, waitCounts, type Row, type SkipFigure, type StudioPayload } from "./schema";

/** Session records to the workspace tables. Runs on the server only. */

export * from "./schema";

const VERDICT_RANK: Record<Verdict, number> = { skip: 1, wait: 2, buy: 3, ask: 4 };

function storeLabel(store: string | undefined): string {
  return store ? store.replace(/^https?:\/\//, "").replace(/^www\./, "") : "";
}

function productName(brand: string, name: string): string {
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`.trim();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function waitingFor(check: CheckRecord, today: string): { waitingFor: string; lookAgain: string | null; buyAt: number | null } {
  const action = waitAction(check, today);
  if (!action) return { waitingFor: "", lookAgain: null, buyAt: null };
  switch (action.kind) {
    case "budget":
      return { waitingFor: WAITING_FOR.budget, lookAgain: action.on, buyAt: null };
    case "run-out":
      return { waitingFor: WAITING_FOR.runOut, lookAgain: action.on, buyAt: null };
    case "set-run-out":
      return { waitingFor: WAITING_FOR.setRunOut, lookAgain: null, buyAt: null };
    default:
      return { waitingFor: WAITING_FOR.price, lookAgain: check.decision.evidence.waitUntil ?? null, buyAt: check.decision.evidence.price?.target ?? null };
  }
}

export function verdictRows(state: SessionState, today: string): Row[] {
  const method = activeMethod(state);
  const rows = state.checks.map((c): Row => {
    const d = c.decision;
    const e = d.evidence;
    const store = e.policy && !e.policy.fallback ? e.policy.retailerName : storeLabel(c.store);
    const price = c.facts.priceShown;
    const watch = c.watchId ? state.watch.find((w) => w.id === c.watchId && !w.closedAt) : undefined;
    const wait = waitingFor(c, today);
    const bought = Boolean(c.purchasedReceiptId);
    const receipt = boughtReceipt(state, c);
    const payable = d.verdict === "buy" && !bought && price !== null;
    return {
      id: c.id,
      product: productName(c.facts.brand, c.facts.name),
      verdict: VERDICT_WORDS[d.verdict],
      rank: VERDICT_RANK[d.verdict],
      reason: bought ? atTheTime(c.reason.text) : c.reason.text,
      rule: RULE_TEXT[d.rule],
      store,
      price,
      owned: e.shelf ? `${e.shelf.brand} ${e.shelf.name}`.trim() : "",
      returns: returnsLine(d, store)?.text ?? "",
      policyUrl: e.policy?.sourceUrl ?? "",
      waitingFor: wait.waitingFor,
      buyAt: wait.buyAt,
      lookAgain: wait.lookAgain,
      status: bought ? "Bought" : watch ? "Watching" : "Open",
      boughtAt: receipt ? eventTime(receipt.createdAt) : "",
      decidedOn: c.decidedOn,
      payable,
      withinCap: payable && method !== undefined && Math.round(price! * 100) <= method.capCents,
    };
  });
  // Skips lead, newest first within a verdict.
  const order = new Map(state.checks.map((c, i) => [c.id, i]));
  return rows.sort((a, b) => (a.rank as number) - (b.rank as number) || order.get(b.id)! - order.get(a.id)!);
}

export function sourceOf(row: Pick<Row, "sourceKind" | "sourceRef" | "cycle">): PurchaseSource {
  if (row.sourceKind === "watch") return { kind: "watch", watchId: String(row.sourceRef) };
  return { kind: "staple", shelfItemId: String(row.sourceRef), cycle: String(row.cycle) };
}

export function rebuyRows(state: SessionState, today: string): Row[] {
  const method = activeMethod(state);
  const cap = method?.capCents;
  const declineText = (source: PurchaseSource) => {
    const d = openDecline(state, source);
    return d ? `PayPal declined ${d.methodLabel} (${d.issue})` : "";
  };
  const staples = dueStaples(state, today).map((d): Row => ({
    id: `staple:${d.item.id}`,
    kind: "Runs out soon",
    product: productName(d.item.brand, d.item.name),
    price: d.amountCents / 100,
    runOutDate: d.item.runOutDate,
    daysLeft: d.daysLeft,
    store: storeLabel(d.item.store),
    sourceKind: "staple",
    sourceRef: d.item.id,
    cycle: d.cycle,
    withinCap: cap !== undefined && d.amountCents <= cap,
    held: "",
    declined: declineText({ kind: "staple", shelfItemId: d.item.id, cycle: d.cycle }),
  }));
  const drops = state.watch
    .filter((w) => !w.closedAt && w.droppedAt)
    .map((w): Row => {
      const cents = Math.round(w.currentPrice * 100);
      const hold = watchBudgetHold(state, w, today);
      return {
        id: `watch:${w.id}`,
        kind: "Price dropped",
        product: productName(w.product.brand, w.product.title),
        price: w.currentPrice,
        runOutDate: null,
        daysLeft: null,
        store: storeLabel(w.product.offerDomain),
        sourceKind: "watch",
        sourceRef: w.id,
        cycle: "",
        withinCap: cap !== undefined && cents <= cap,
        held: hold ? `${BUDGET_LABELS[hold.group]} has $${hold.remaining.toFixed(2)} left this month` : "",
        declined: declineText({ kind: "watch", watchId: w.id }),
      };
    });
  return [...staples, ...drops];
}

/** Shelf items, soonest run-out first; items without a run-out date last. */
export function shelfRows(state: SessionState, today: string): Row[] {
  const items = [...state.shelf].sort((a, b) => (a.runOutDate ?? "9999").localeCompare(b.runOutDate ?? "9999"));
  return items.map((i) => ({
    id: i.id,
    product: productName(i.brand, i.name),
    category: CATEGORY_LABELS[i.category] ?? i.category,
    opened: i.opened ? "Opened" : "Unopened",
    runOutDate: i.runOutDate,
    daysLeft: i.runOutDate ? daysBetween(today, i.runOutDate) : null,
    price: i.price ?? null,
    store: storeLabel(i.store),
    // The column name says Eastern, so the time fits the grid cell.
    lastRestocked: restockedLabel(state, i).replace(/ ET$/, ""),
  }));
}

export function watchRows(state: SessionState): Row[] {
  return state.watch
    .filter((w) => !w.closedAt)
    .map((w) => ({
      id: w.id,
      product: productName(w.product.brand, w.product.title),
      startPrice: w.startPrice,
      currentPrice: w.currentPrice,
      targetPrice: w.targetPrice,
      status: w.droppedAt ? "Dropped" : "Watching",
      alert: w.subscription.status === "active" ? "On (Channel3)" : w.subscription.status === "unavailable" ? "Unavailable" : "Off",
    }));
}

export function budgetRows(state: SessionState, today: string): Row[] {
  const left = remainingBudgets(state.budgets, today);
  return BUDGET_GROUPS.filter((g) => state.budgets.limits[g] !== undefined).map((g) => ({
    id: g,
    group: BUDGET_LABELS[g],
    limit: state.budgets.limits[g]!,
    spent: spentIn(state.budgets, today, g),
    left: left[g] ?? 0,
  }));
}

export function studioPayload(state: SessionState, today: string): StudioPayload {
  const method = activeMethod(state);
  const verdicts = verdictRows(state, today);
  const budgets = budgetRows(state, today);
  return {
    today,
    dayOffset: state.dayOffset,
    sample: state.sample?.kind === "week",
    method: method ? { label: method.label, capCents: method.capCents } : null,
    tables: { verdicts, rebuys: rebuyRows(state, today), shelf: shelfRows(state, today), watchlist: watchRows(state), budgets },
    budget: {
      left: round2(budgets.reduce((s, b) => s + (b.left as number), 0)),
      limit: round2(budgets.reduce((s, b) => s + (b.limit as number), 0)),
      spent: round2(budgets.reduce((s, b) => s + (b.spent as number), 0)),
    },
    waits: waitCounts(verdicts),
  };
}

/** The skip number for the workspace figure, from the same run the proof page shows. */
export function skipFigure(r: { skipCorrect: number; n: number; baselines: Array<{ id: string; skipCorrect: number }>; split: { dollarsAvoided: number } }): SkipFigure {
  return {
    right: r.skipCorrect,
    n: r.n,
    alwaysSkip: r.baselines.find((b) => b.id === "always-skip")?.skipCorrect ?? 0,
    sameCategory: r.baselines.find((b) => b.id === "same-category")?.skipCorrect ?? 0,
    avoided: r.split.dollarsAvoided,
  };
}
