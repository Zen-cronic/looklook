"use client";

import type { AgWidgetParams } from "ag-studio";
import { useSyncExternalStore } from "react";
import { formatCents } from "@/lib/app/money";
import type { WeekView } from "@/lib/app/week";

export interface SlipState {
  view: WeekView;
  paying: boolean;
  message: string | null;
}

export interface SlipContext {
  /** The shopper's yes, for the week's order as it is on screen (its hash). The only thing here that pays. */
  yes(): void;
}

// Studio keeps a widget's context as it was first given, so the slip's state reaches the widget through this store.
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

/** This week's slip: what one yes would pay now, its fingerprint, and the yes. */
export function WeekSlipWidget(params: AgWidgetParams) {
  const ctx = params.context as SlipContext;
  const state = useSyncExternalStore(subscribe, () => current, () => current);
  if (!state) return <div className="decision-list loading">Loading this week&apos;s order…</div>;
  const { slip } = state.view;
  const later = slip.leftOff.filter((l) => l.leftOff === "for-later");
  const held = slip.leftOff.filter((l) => l.leftOff !== "for-later");
  const paid = state.view.sent.filter((l) => l.status === "paid");
  return (
    <div className="decision-list slip-widget" data-testid="studio-slip">
      <div className="decision-head">
        <h2>This week&apos;s order</h2>
        <p className="small muted">
          {slip.lines.length} {slip.lines.length === 1 ? "item" : "items"}, each its own PayPal payment
          <span hidden data-testid="slip-hash">{slip.hash.slice(0, 8)}</span>
        </p>
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
      {later.length > 0 && (
        <ul className="slip-lines later">
          {later.map((l) => (
            <li key={l.approvalKey}>
              <span>Left for later: {l.title}</span>
              <span className="num">{money(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {held.map((l) => (
        <p key={l.approvalKey} className="small muted">
          Not in this order: {l.title}. {l.note}
        </p>
      ))}
      {slip.lines.length > 0 && (
        <>
          <p className="slip-total">
            <span>Total</span>
            <span className="num" data-testid="slip-total">
              {money(slip.totalCents)}
            </span>
          </p>
          <button className="btn block" onClick={() => ctx.yes()} disabled={state.paying} data-testid="studio-slip-yes">
            {state.paying ? "Paying…" : slip.methodId ? `Yes, pay ${money(slip.totalCents)}` : "Pay the first item on the week page"}
          </button>
          <p className="small muted">{slip.methodLabel ? `Paid with ${slip.methodLabel}.` : "The first item goes through PayPal checkout on the week page."} The assistant can change this order, but only your yes pays it.</p>
        </>
      )}
      {state.message && <p className="small slip-message">{state.message}</p>}
    </div>
  );
}
