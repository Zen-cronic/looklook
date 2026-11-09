import Link from "next/link";
import { Suspense } from "react";
import { BUDGET_LABELS } from "@/lib/app/budgets";
import { formatDay, formatTime, realToday } from "@/lib/app/dates";
import { formatCents, formatDollars } from "@/lib/app/money";
import { activeMethod, chargeKind, dueStaples, openDecline } from "@/lib/app/payments";
import { dueReminders, upcomingReminders, watchBudgetHold } from "@/lib/app/reminders";
import { currentSession } from "@/lib/app/session";
import type { Notice, PurchaseSource, SavedMethod, SessionState } from "@/lib/app/types";
import { negativeTestingEnabled } from "@/lib/paypal/config";
import { SIMULATED } from "@/lib/app/when";
import { Chevron } from "../components/Chevron";
import { Eyebrow } from "../components/Eyebrow";
import { Lotion } from "../components/stage/MaterialStage";
import { ApprovalButtons, DateControls, DeclineToggle, ReminderDone, WatchControls } from "../components/RebuyControls";

export const metadata = { title: "Rebuys" };

export default function RebuysPage() {
  return (
    <main className="page">
      <div className="page-head">
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

function NoticeItem({ n }: { n: Notice }) {
  return (
    <div className="notice">
      <p>
        {n.text} <span className="muted small">{formatTime(n.at)} ET</span>
      </p>
      {n.ids && n.ids.length > 0 && (
        <details className="ids">
          <summary>Details</summary>
          <dl className="receipt-lines">
            {n.ids.map((x) => (
              <span key={x.label} style={{ display: "contents" }}>
                <dt>{x.label}</dt>
                <dd>{x.value}</dd>
              </span>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

async function Rebuys() {
  const { state, today } = await currentSession();
  // Days counted from the shopper's today say so while the simulated date is on.
  const countedDay = (date: string) => (state.dayOffset > 0 ? `${formatDay(date)} (${SIMULATED})` : formatDay(date));
  const method = activeMethod(state);
  const due = dueStaples(state, today);
  const open = state.watch.filter((w) => !w.closedAt);
  const drops = open.filter((w) => w.droppedAt);
  const reminders = dueReminders(state, today);
  const later = upcomingReminders(state, today);
  const receipts = [...state.receipts].reverse().slice(0, 8);
  const notices = [...state.notices].reverse().slice(0, 3);
  const testing = negativeTestingEnabled();

  return (
    <div className="object-layout">
        <div className="datebar">
          {state.dayOffset === 0 ? (
            <>
              <Eyebrow as="span" icon="clock">
                Today
              </Eyebrow>
              <span className="date">{formatDay(today)}</span>
              <span className="small muted">Move the date ahead to see staples come due.</span>
            </>
          ) : (
            <>
              <Eyebrow as="span" icon="clock">
                Simulated date
              </Eyebrow>
              <span className="date">{formatDay(today)}</span>
              <span className="small muted">
                {state.dayOffset} {state.dayOffset === 1 ? "day" : "days"} ahead of today ({formatDay(realToday())}). Run-out dates and budgets use it; charge times are real.
              </span>
            </>
          )}
          <DateControls dayOffset={state.dayOffset} />
        </div>

        <section className="panel stack lead" aria-labelledby="needs-yes">
          <Lotion className="panel-material" sizes="(min-width: 960px) 36rem, 100vw" />
          <h2 id="needs-yes" className="field-title">
            Needs your yes
          </h2>
          {(due.length > 0 || drops.length > 0) && <p className="small">{method ? `Paid with ${method.label} when you tap yes, up to ${formatCents(method.capCents, method.currency)} each.` : "The first payment can save your PayPal or card for one-tap rebuys."}</p>}
          {due.length === 0 && drops.length === 0 && reminders.length === 0 && (
            <div className="card">
              <p>Nothing to approve right now.</p>
              <p className="small muted">A staple shows up here five days before its run-out date, and a watched item when its price drops to your target.</p>
            </div>
          )}
          {reminders.map((c) => (
            <div key={c.id} className="panel-frame">
            <article className="approval reminder">
              <div className="approval-head">
                <div>
                  <p className="approval-tag">Reminder</p>
                  <div className="brand-line">{c.facts.brand}</div>
                  <h3>{c.facts.name}</h3>
                  <p className="small muted">
                    {c.reminder!.kind === "budget" ? `Your budget started again on ${countedDay(c.reminder!.on)}.` : `You asked to look again on ${countedDay(c.reminder!.on)}.`} The verdict now: {c.decision.verdict}.
                  </p>
                </div>
              </div>
              <div className="actions" style={{ marginTop: "0.85rem" }}>
                <Link className="btn" href={`/check/${c.id}`}>
                  Look at it again
                </Link>
                <ReminderDone checkId={c.id} />
              </div>
            </article>
            </div>
          ))}
          {due.map((d) => {
            const source: PurchaseSource = { kind: "staple", shelfItemId: d.item.id, cycle: d.cycle };
            const declined = declineFor(state, source);
            const left = d.daysLeft < 0 ? `Ran out ${-d.daysLeft} ${d.daysLeft === -1 ? "day" : "days"} ago` : d.daysLeft === 0 ? "Runs out today" : `Runs out in ${d.daysLeft} ${d.daysLeft === 1 ? "day" : "days"}`;
            return (
              <div key={d.item.id} className="panel-frame">
              <article className={`approval${declined ? " declined" : ""}`}>
                <div className="approval-head">
                  <div>
                    {/* The shelf item this rebuy replaces: its state as an eyebrow that opens it on the shelf */}
                    <Link className="eyebrow-link" href={`/shelf#${d.item.id}`}>
                      <Eyebrow as="span" icon="shelf">
                        {left}
                        {d.item.opened ? ", opened" : ""}
                      </Eyebrow>
                    </Link>
                    <div className="brand-line">{d.item.brand}</div>
                    <h3>{d.item.name}</h3>
                    <p className="small muted">Last bought at {d.item.store ?? "a store"}.</p>
                  </div>
                  <div className="amount">{formatCents(d.amountCents)}</div>
                </div>
                <ApprovalButtons source={source} amountCents={d.amountCents} version={d.cycle} amountLabel={formatCents(d.amountCents)} method={methodFor(method, d.amountCents)} declined={declined} verb="rebuy" />
              </article>
              </div>
            );
          })}
          {drops.map((w) => {
            const source: PurchaseSource = { kind: "watch", watchId: w.id };
            const cents = Math.round(w.currentPrice * 100);
            const declined = declineFor(state, source);
            const hold = watchBudgetHold(state, w, today);
            return (
              <div key={w.id} className="panel-frame">
              <article className={`approval price-drop${declined ? " declined" : ""}${hold ? " held" : ""}`}>
                <div className="approval-head">
                  <div>
                    <p className="approval-tag">Price drop</p>
                    <div className="brand-line">{w.product.brand}</div>
                    <h3>{w.product.title}</h3>
                    <p className="small muted">
                      Price dropped from {formatDollars(w.startPrice)} to {formatDollars(w.currentPrice)}, at or under your {formatDollars(w.targetPrice)} target.
                    </p>
                  </div>
                  <div className="amount">{formatCents(cents)}</div>
                </div>
                {hold ? (
                  <p className="returns maybe" style={{ margin: "0.85rem 0 0" }}>
                    Still over budget: {formatDollars(hold.remaining)} left in {BUDGET_LABELS[hold.group].toLowerCase()} this month. We&apos;ll ask again when it starts over on {countedDay(hold.restartsOn)}.
                  </p>
                ) : (
                  <ApprovalButtons source={source} amountCents={cents} version={w.droppedAt ?? ""} amountLabel={formatCents(cents)} method={methodFor(method, cents)} declined={declined} verb="buy" />
                )}
              </article>
              </div>
            );
          })}
        </section>

        <section className="stack-sm">
        <h2>Watching for a drop</h2>
        {open.length === 0 ? (
          <div className="empty-frame">
            <Eyebrow icon="chart">Nothing watched yet</Eyebrow>
            <p className="small muted">Tap Watch for a drop on a wait verdict, and the price shows up here.</p>
          </div>
        ) : (
          <ul className="list">
            {open.map((w) => (
              <li key={w.id} className="stack-sm">
                <div>
                  <div className="brand-line">{w.product.brand}</div>
                  <div className="name-line">{w.product.title}</div>
                  <div className="small muted">
                    {w.droppedAt ? `Dropped to ${formatDollars(w.currentPrice)}, at or under your ${formatDollars(w.targetPrice)} target (above).` : `Now ${formatDollars(w.currentPrice)}, buy at ${formatDollars(w.targetPrice)} or less.`} {w.subscription.status === "active" ? "Channel3 price alert on." : w.subscription.status === "unavailable" ? "Channel3 couldn't set a price alert for this listing." : ""}
                  </div>
                </div>
                <WatchControls watchId={w.id} canSimulate={!w.droppedAt} />
              </li>
            ))}
          </ul>
        )}
        </section>

        {later.length > 0 && (
          <section className="stack-sm">
            <h2>Reminders</h2>
            <ul className="list">
              {later.map((c) => (
                <li key={c.id} className="split">
                  <Link href={`/check/${c.id}`} style={{ textDecoration: "none" }}>
                    <span className="brand-line">{c.facts.brand}</span>
                    <span className="name-line" style={{ display: "block" }}>
                      {c.facts.name}
                    </span>
                  </Link>
                  <span className="small muted">
                    {c.reminder!.kind === "budget" ? "Budget starts again" : "Look again"} {countedDay(c.reminder!.on)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {testing && (
          <div className="card stack-sm">
            <h2>Test a decline</h2>
            <DeclineToggle on={state.demo.declineNextRebuy} />
            <p className="small muted">The next rebuy comes back declined (INSTRUMENT_DECLINED), as a refused card would. Nothing is charged, and you can pick another card or PayPal.</p>
          </div>
        )}
        {notices.length > 0 && (
          <div className="stack-sm">
            <h2>Notices</h2>
            {notices.map((n) => (
              <NoticeItem key={n.id} n={n} />
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
                      <span className="small muted" style={{ display: "block" }}>
                        {chargeKind(r)}, {r.methodLabel}
                        {r.status === "refunded" ? ", refunded" : r.status === "partly-refunded" ? ", partly refunded" : r.status === "failed" ? ", failed (not charged)" : r.refund?.status === "PENDING" ? ", refund pending" : ""}
                      </span>
                      <span className="small muted" style={{ display: "block" }}>
                        {formatTime(r.createdAt)} ET{r.on !== realToday(new Date(r.createdAt)) ? `, simulated date ${formatDay(r.on)}` : ""}
                      </span>
                    </span>
                    <span className="row-end">
                      <span className="price-line">{formatCents(r.amountCents, r.currency)}</span>
                      <Chevron />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
    </div>
  );
}
