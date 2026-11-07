import { Suspense } from "react";
import { BUDGET_GROUPS, BUDGET_LABELS, remainingBudgets, spentIn } from "@/lib/app/budgets";
import { daysBetween } from "@/lib/app/dates";
import { formatDollars } from "@/lib/app/money";
import { currentSession } from "@/lib/app/session";
import { CATEGORY_LABELS } from "@/lib/app/shelf-ui";
import { countedDate, restockedLabel } from "@/lib/app/when";
import { budgetGroupOf } from "@/lib/shelf/categories";
import type { ShelfItem } from "@/lib/shelf/types";
import { AddShelfItem, BudgetEditor, ShelfRowControls } from "../components/ShelfControls";
import { SimDate } from "../components/SimDate";

export const metadata = { title: "Shelf" };

export default function ShelfPage() {
  return (
    <main className="page wide">
      <div style={{ marginBottom: "1.5rem" }}>
        <h1>Your shelf</h1>
        <p className="lede">What you already own. Checks compare against it, and staples with a run-out date come up for a rebuy.</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Shelf />
      </Suspense>
    </main>
  );
}

function daysChip(item: ShelfItem, today: string, dayOffset: number) {
  if (!item.runOutDate) return <span className="days">No run-out date</span>;
  const left = daysBetween(today, item.runOutDate);
  const cls = left < 0 ? "days out" : left <= 7 ? "days soon" : "days";
  const text = left < 0 ? `Ran out ${-left} ${left === -1 ? "day" : "days"} ago` : left === 0 ? "Runs out today" : `${left} ${left === 1 ? "day" : "days"} left`;
  return (
    <span className={cls} title={`Runs out ${countedDate(item.runOutDate, dayOffset)}`}>
      {text}
    </span>
  );
}

async function Shelf() {
  const { state, today } = await currentSession();
  const remaining = remainingBudgets(state.budgets, today);
  const groups = BUDGET_GROUPS.map((g) => ({ group: g, items: state.shelf.filter((i) => budgetGroupOf(i.category) === g) })).filter((x) => x.items.length);
  const fromOrders = state.shelf.filter((i) => i.source === "app-order").length;
  return (
    <div className="shelf-grid">
      <section>
        <SimDate today={today} dayOffset={state.dayOffset} />
        <p className="small muted" style={{ marginBottom: "0.75rem" }}>
          {state.shelf.length} items: {state.shelf.length - fromOrders} added by you, {fromOrders} from your purchases here. Import from PayPal activity: off.
        </p>
        <AddShelfItem />
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h2 className="group-label">{BUDGET_LABELS[group]}</h2>
            <ul className="list">
              {items.map((item) => (
                <li key={item.id} id={item.id} className="shelf-item">
                  <div>
                    <div className="sub">
                      {item.brand}, {CATEGORY_LABELS[item.category].toLowerCase()}
                    </div>
                    <div className="title">{item.name}</div>
                    <div className="sub">
                      {item.opened ? "Opened" : "Unopened"}
                      {item.price ? `, ${formatDollars(item.price)} last time` : ""}
                      {item.lastRestockedOn ? `, restocked ${restockedLabel(state, item)}` : ""}
                    </div>
                  </div>
                  {daysChip(item, today, state.dayOffset)}
                  <ShelfRowControls id={item.id} opened={item.opened} runOutDate={item.runOutDate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <aside className="card stack">
        <div>
          <h2>Monthly budgets</h2>
          <p className="small muted">A check says wait when the price is more than what&apos;s left.</p>
        </div>
        {BUDGET_GROUPS.map((g) => {
          const limit = state.budgets.limits[g];
          const spent = spentIn(state.budgets, today, g);
          const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
          return (
            <div key={g} className="budget">
              <div>
                <strong>{BUDGET_LABELS[g]}</strong>
                <div className="small muted">
                  {limit === undefined ? "No limit" : `${formatDollars(remaining[g] ?? 0)} left of ${formatDollars(limit)}`}
                </div>
              </div>
              <BudgetEditor group={g} label={BUDGET_LABELS[g]} limit={limit ?? null} />
              {limit !== undefined && (
                <div className={`bar${spent > limit ? " over" : ""}`} aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
