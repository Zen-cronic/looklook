import { Suspense } from "react";
import { BUDGET_GROUPS, BUDGET_LABELS, remainingBudgets, spentIn } from "@/lib/app/budgets";
import { daysBetween } from "@/lib/app/dates";
import { formatDollars } from "@/lib/app/money";
import { currentSession } from "@/lib/app/session";
import { CATEGORY_LABELS } from "@/lib/app/shelf-ui";
import { countedDate, restockedLabel } from "@/lib/app/when";
import { budgetGroupOf } from "@/lib/shelf/categories";
import type { ShelfItem } from "@/lib/shelf/types";
import { AddShelfItem, BudgetEditor, ShelfRow, type DueLabel } from "../components/ShelfControls";
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

function dueFor(item: ShelfItem, today: string, dayOffset: number): DueLabel {
  if (!item.runOutDate) return { kind: "none", label: "" };
  const left = daysBetween(today, item.runOutDate);
  const title = `Runs out ${countedDate(item.runOutDate, dayOffset)}`;
  if (left < 0) return { kind: "out", label: `Ran out ${-left} ${left === -1 ? "day" : "days"} ago`, title };
  if (left === 0) return { kind: "out", label: "Runs out today", title };
  if (left <= 7) return { kind: "soon", big: String(left), label: left === 1 ? "day left" : "days left", title };
  return { kind: "later", label: `${left} days left`, title };
}

async function Shelf() {
  const { state, today } = await currentSession();
  const remaining = remainingBudgets(state.budgets, today);
  const groups = BUDGET_GROUPS.map((g) => ({ group: g, items: state.shelf.filter((i) => budgetGroupOf(i.category) === g) })).filter((x) => x.items.length);
  return (
    <div className="shelf-grid">
      <section>
        <SimDate today={today} dayOffset={state.dayOffset} />
        <p className="small muted" style={{ marginBottom: "0.75rem" }}>
          {state.shelf.length} items
        </p>
        <AddShelfItem />
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h2 className="group-label">{BUDGET_LABELS[group]}</h2>
            <ul className="list">
              {items.map((item) => (
                <li key={item.id} id={item.id} className="shelf-item">
                  <ShelfRow
                    id={item.id}
                    brand={item.brand}
                    kind={CATEGORY_LABELS[item.category].toLowerCase()}
                    name={item.name}
                    sub={[item.opened ? "" : "Unopened", item.price ? `${formatDollars(item.price)} last time` : "", item.lastRestockedOn ? `restocked ${restockedLabel(state, item)}` : ""].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase())}
                    opened={item.opened}
                    runOutDate={item.runOutDate}
                    due={dueFor(item, today, state.dayOffset)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <aside className="cobalt-field budgets stack">
        <div>
          <h2 className="field-title">Monthly budgets</h2>
          <p className="small">A check says wait when the price is more than what&apos;s left.</p>
        </div>
        {BUDGET_GROUPS.map((g) => {
          const limit = state.budgets.limits[g];
          const spent = spentIn(state.budgets, today, g);
          const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
          return (
            <div key={g} className="budget">
              <div>
                <strong>{BUDGET_LABELS[g]}</strong>
                <div className="small">
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
