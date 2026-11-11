import { Suspense } from "react";
import { BUDGET_GROUPS, BUDGET_LABELS, remainingBudgets, spentIn } from "@/lib/app/budgets";
import { daysBetween } from "@/lib/app/dates";
import { formatDollars } from "@/lib/app/money";
import { compactSimulated } from "@/lib/filming/neutral";
import { displaySession } from "@/lib/filming/server";
import { CATEGORY_LABELS } from "@/lib/app/shelf-ui";
import { countedDate, restockedLabel } from "@/lib/app/when";
import { budgetGroupOf } from "@/lib/shelf/categories";
import type { ShelfItem } from "@/lib/shelf/types";
import { AddShelfItem, BudgetEditor, ShelfRow, type DueLabel } from "../components/ShelfControls";
import { Eyebrow } from "../components/Eyebrow";
import { glyphFor } from "../components/ProductGlyph";
import { SimDate } from "../components/SimDate";
import { Lotion } from "../components/stage/MaterialStage";

export const metadata = { title: "Shelf" };

export default function ShelfPage() {
  return (
    <main className="page wide">
      <div className="page-head">
        <h1>Your shelf</h1>
        <p className="lede">What you already own. Checks compare against it, and staples with a run-out date come up for a reorder.</p>
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
  if (left <= 7) return { kind: "soon", label: `${left} ${left === 1 ? "day" : "days"} left`, title };
  return { kind: "later", label: `${left} days left`, title };
}

/** The same due label with the simulated date said the short way (filming mode). */
function filmDue(due: ReturnType<typeof dueFor>): ReturnType<typeof dueFor> {
  return "title" in due && due.title ? { ...due, title: compactSimulated(due.title) } : due;
}

async function Shelf() {
  const { state, today, film } = await displaySession();
  const remaining = remainingBudgets(state.budgets, today);
  const maxLimit = Math.max(1, ...BUDGET_GROUPS.map((g) => state.budgets.limits[g] ?? 0));
  // Items running out (within a week, or already out) are framed on the panel; the rest is a quiet list by budget.
  const isDue = (i: ShelfItem) => ["soon", "out"].includes(dueFor(i, today, state.dayOffset).kind);
  const running = state.shelf
    .filter(isDue)
    .sort((a, b) => (a.runOutDate ?? "").localeCompare(b.runOutDate ?? ""));
  const groups = BUDGET_GROUPS.map((g) => ({ group: g, items: state.shelf.filter((i) => budgetGroupOf(i.category) === g && !isDue(i)) })).filter((x) => x.items.length);
  const row = (item: ShelfItem) => (
    <li key={item.id} id={item.id} className="shelf-item">
      <ShelfRow
        id={item.id}
        brand={item.brand}
        kind={CATEGORY_LABELS[item.category].toLowerCase()}
        glyph={glyphFor(item.category)}
        name={item.name}
        sub={[item.opened ? "" : "Unopened", item.price ? `${formatDollars(item.price)} last time` : "", item.lastRestockedOn ? `restocked ${film ? compactSimulated(restockedLabel(state, item)) : restockedLabel(state, item)}` : ""].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase())}
        opened={item.opened}
        runOutDate={item.runOutDate}
        due={film ? filmDue(dueFor(item, today, state.dayOffset)) : dueFor(item, today, state.dayOffset)}
      />
    </li>
  );
  return (
    <div className="shelf-grid">
      <section className="stack">
        <div className="shelf-meta">
          <SimDate today={today} dayOffset={state.dayOffset} film={film} />
          <p className="small muted">{state.shelf.length} items</p>
        </div>
        <AddShelfItem />
        {running.length > 0 && (
          <section className="panel stack" aria-labelledby="running-out">
            <Lotion className="panel-material" eager sizes="(min-width: 960px) 44rem, 100vw" />
            <Eyebrow as="h2" icon="clock" id="running-out">
              Running out
            </Eyebrow>
            {running.map((item) => (
              <div key={item.id} className="panel-frame">
                <ul className="list framed">{row(item)}</ul>
              </div>
            ))}
          </section>
        )}
        <div>
          {groups.map(({ group, items }) => (
            <div key={group}>
              <Eyebrow as="h2" icon="shelf" className="group-label">
                {BUDGET_LABELS[group]}
              </Eyebrow>
              <ul className="list quiet">{items.map(row)}</ul>
            </div>
          ))}
        </div>
      </section>
      <aside className="cobalt-field budgets stack">
        <div>
          <h2 className="field-title">Monthly budgets</h2>
          <p className="small">A check says wait when the price is more than what&apos;s left.</p>
        </div>
        {BUDGET_GROUPS.map((g) => {
          const limit = state.budgets.limits[g];
          const spent = spentIn(state.budgets, today, g);
          // Spent against the cap: the track is as long as the cap (against the largest budget), the fill is what's spent.
          const pct = limit ? Math.max(0, Math.min(100, Math.round((spent / limit) * 100))) : 0;
          const length = limit ? Math.max(12, Math.round((limit / maxLimit) * 100)) : 0;
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
                <div className={`bar${spent > limit ? " over" : ""}`} style={{ width: `${length}%` }} aria-hidden>
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
