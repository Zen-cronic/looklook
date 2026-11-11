"use client";

import type { AgWidgetParams } from "ag-studio";
import { useSyncExternalStore } from "react";
import { formatCents } from "@/lib/app/money";
import type { WeekView } from "@/lib/app/week";

export interface SlipState {
  view: WeekView;
  paying: boolean;
  message: string | null;
  /** The total before the assistant's last change, so the widget can show both. */
  was?: number;
}

export interface SlipContext {
  /** The shopper's yes, for the week's order as it is on screen (its hash). The only thing here that pays. */
  yes(): void;
}

// Studio keeps a widget's context as it was first given, so the order's state reaches the widget through this store.
let current: SlipState | null = null;
const listeners = new Set<() => void>();

export function setSlipState(next: SlipState): void {
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const money = (c: number) => formatCents(c);

/** This week's order: its items and total, the items left for next week, and the yes. */
export function WeekSlipWidget(params: AgWidgetParams) {
  const ctx = params.context as SlipContext;
  const state = useSyncExternalStore(subscribe, () => current, () => current);
  if (!state) return <div className="decision-list loading">Loading this week&apos;s order…</div>;
  const { slip } = state.view;
  const later = slip.leftOff.filter((l) => l.leftOff === "for-later");
  const held = slip.leftOff.filter((l) => l.leftOff !== "for-later");
  const paid = state.view.sent.filter((l) => l.status === "paid");
  const changed = state.was !== undefined && state.was !== slip.totalCents;
  return (
    <div className="decision-list slip-widget" data-testid="studio-slip">
      <div className="decision-head">
        <h2>
          {slip.lines.length} {slip.lines.length === 1 ? "item" : "items"}
        </h2>
        <span className="visually-hidden" data-testid="slip-hash">
          {slip.hash.slice(0, 8)}
        </span>
      </div>
      {slip.lines.length > 0 ? (
        <ul className="slip-lines">
          {slip.lines.map((l) => (
            <li key={l.approvalKey}>
              <span>{l.title}</span>
              <span className="num">{money(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">{paid.length ? "Everything in this order is paid." : "Nothing in this order."}</p>
      )}
      {slip.lines.length > 0 && (
        <p className={`slip-total${changed ? " changed" : ""}`}>
          <span>Total</span>
          <span className="slip-total-figure">
            {changed ? <s className="num">{money(state.was!)}</s> : null}
            <span className="num" data-testid="slip-total">
              {money(slip.totalCents)}
            </span>
          </span>
        </p>
      )}
      {slip.lines.length > 0 && (
        <button className="btn block" onClick={() => ctx.yes()} disabled={state.paying} data-testid="studio-slip-yes">
          {state.paying ? "Paying…" : slip.methodId ? `Pay ${money(slip.totalCents)} with PayPal` : "Pay on the week page"}
        </button>
      )}
      {later.length > 0 && (
        <div className="slip-later" data-testid="slip-later">
          <h3>Left for next week</h3>
          <ul className="slip-lines later">
            {later.map((l) => (
              <li key={l.approvalKey}>
                <span>{l.title}</span>
                <span className="num">{money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {held.map((l) => (
        <p key={l.approvalKey} className="small muted">
          Not in this order: {l.title}. {l.note}
        </p>
      ))}
      {state.message && <p className="small slip-message">{state.message}</p>}
    </div>
  );
}
