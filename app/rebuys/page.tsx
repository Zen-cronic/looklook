import Link from "next/link";
import { Suspense } from "react";
import { formatDate, formatDay, formatTime } from "@/lib/app/dates";
import { formatCents, formatDollars } from "@/lib/app/money";
import { activeMethod, dueStaples, openDecline } from "@/lib/app/payments";
import { currentSession } from "@/lib/app/session";
import type { PurchaseSource, SavedMethod, SessionState } from "@/lib/app/types";
import { negativeTestingEnabled } from "@/lib/paypal/config";
import { ApprovalButtons, DateControls, DeclineToggle, WatchControls } from "../components/RebuyControls";

export const metadata = { title: "Rebuys" };

export default function RebuysPage() {
  return (
    <main className="page wide">
      <div style={{ marginBottom: "1.5rem" }}>
        <h1>Rebuys</h1>
        <p className="lede">Staples that are running out and prices that dropped. Nothing is charged until you say yes.</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Rebuys />
      </Suspense>
    </main>
  );
}

function methodFor(method: SavedMethod | undefined, amountCents: number) {
  return method ? { label: method.label, withinCap: amountCents <= method.capCents, capLabel: formatCents(method.capCents, method.currency) } : null;
}

function declineFor(state: SessionState, source: PurchaseSource) {
  const d = openDecline(state, source);
  return d ? { methodLabel: d.methodLabel, issue: d.issue, simulated: d.simulated } : null;
}

async function Rebuys() {
  const { state, today } = await currentSession();
  const method = activeMethod(state);
  const due = dueStaples(state, today);
  const drops = state.watch.filter((w) => w.droppedAt && !w.closedAt);
  const watching = state.watch.filter((w) => !w.droppedAt && !w.closedAt);
  const receipts = [...state.receipts].reverse().slice(0, 8);
  const notices = [...state.notices].reverse().slice(0, 3);
  const testing = negativeTestingEnabled();

  return (
    <div className="two-col">
      <section className="stack">
        <div className="datebar">
          <span className="chip sim">Simulated date</span>
          <span className="date">{formatDay(today)}</span>
          <span className="small muted">{state.dayOffset === 0 ? "today" : `${state.dayOffset} days ahead of today`}</span>
          <DateControls dayOffset={state.dayOffset} />
        </div>

        <h2>Needs your yes</h2>
        {due.length === 0 && drops.length === 0 && (
          <div className="card">
            <p>Nothing to approve right now.</p>
            <p className="small muted">A staple shows up here five days before its run-out date, and a watched item when its price drops to your target. Move the simulated date ahead to see the next one.</p>
          </div>
        )}
        {due.map((d) => {
          const source: PurchaseSource = { kind: "staple", shelfItemId: d.item.id, cycle: d.cycle };
          const declined = declineFor(state, source);
          return (
            <article key={d.item.id} className={`approval${declined ? " declined" : ""}`}>
              <div className="approval-head">
                <div>
                  <div className="brand-line">{d.item.brand}</div>
                  <h3>{d.item.name}</h3>
                  <p className="small muted">
                    {d.daysLeft < 0 ? `Ran out ${-d.daysLeft} days ago` : d.daysLeft === 0 ? "Runs out today" : `Runs out in ${d.daysLeft} ${d.daysLeft === 1 ? "day" : "days"}`} ({formatDate(d.item.runOutDate!)}). Last bought at {d.item.store ?? "a store"}.
                  </p>
                </div>
                <div className="amount">{formatCents(d.amountCents)}</div>
              </div>
              <ApprovalButtons source={source} amountLabel={formatCents(d.amountCents)} method={methodFor(method, d.amountCents)} declined={declined} verb="rebuy" />
            </article>
          );
        })}
        {drops.map((w) => {
          const source: PurchaseSource = { kind: "watch", watchId: w.id };
          const cents = Math.round(w.currentPrice * 100);
          const declined = declineFor(state, source);
          return (
            <article key={w.id} className={`approval price-drop${declined ? " declined" : ""}`}>
              <div className="approval-head">
                <div>
                  <div className="brand-line">{w.product.brand}</div>
                  <h3>{w.product.title}</h3>
                  <p className="small muted">
                    Price dropped from {formatDollars(w.startPrice)} to {formatDollars(w.currentPrice)}, at or under your {formatDollars(w.targetPrice)} target.
                  </p>
                </div>
                <div className="amount">{formatCents(cents)}</div>
              </div>
              <ApprovalButtons source={source} amountLabel={formatCents(cents)} method={methodFor(method, cents)} declined={declined} verb="buy" />
            </article>
          );
        })}

        <h2 style={{ marginTop: "2rem" }}>Watching for a drop</h2>
        {watching.length === 0 ? (
          <p className="muted">
            Nothing yet. When a check says wait, tap Watch for a drop and Channel3 sends the price changes here.
          </p>
        ) : (
          <ul className="list">
            {watching.map((w) => (
              <li key={w.id} className="stack-sm">
                <div className="split">
                  <div>
                    <div className="brand-line">{w.product.brand}</div>
                    <div className="name-line">{w.product.title}</div>
                    <div className="small muted">
                      Now {formatDollars(w.currentPrice)}, buy at {formatDollars(w.targetPrice)} or less.{" "}
                      {w.subscription.status === "active" ? "Channel3 price alert on." : w.subscription.status === "unavailable" ? "Channel3 couldn't set a price alert for this listing." : ""}
                    </div>
                  </div>
                </div>
                <WatchControls watchId={w.id} canSimulate />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack">
        {testing && (
          <div className="card stack-sm">
            <h2>Test a decline</h2>
            <DeclineToggle on={state.demo.declineNextRebuy} />
            <p className="small muted">PayPal&apos;s sandbox answers the next rebuy with INSTRUMENT_DECLINED, the error a refused card gives. The card then asks you to approve another method.</p>
          </div>
        )}
        {notices.length > 0 && (
          <div className="stack-sm">
            <h2>Notices</h2>
            {notices.map((n) => (
              <p key={n.id} className="notice">
                {n.text} <span className="muted small">{formatTime(n.at)} ET</span>
              </p>
            ))}
          </div>
        )}
        <div className="stack-sm">
          <h2>Charges</h2>
          {receipts.length === 0 ? (
            <p className="muted">No charges yet.</p>
          ) : (
            <ul className="list">
              {receipts.map((r) => (
                <li key={r.id}>
                  <Link href={`/receipts/${r.id}`} className="split" style={{ textDecoration: "none" }}>
                    <span>
                      <span className="name-line" style={{ display: "block" }}>
                        {r.title}
                      </span>
                      <span className="small muted">
                        {formatDate(r.on)}, {r.methodLabel}
                        {r.status === "refunded" ? ", refunded" : ""}
                      </span>
                    </span>
                    <span className="price-line">{formatCents(r.amountCents, r.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
