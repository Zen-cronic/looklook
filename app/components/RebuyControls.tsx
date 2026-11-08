"use client";

import type { PurchaseSource } from "@/lib/app/types";
import { leave } from "./motion";
import { useApi } from "./useApi";

export function DateControls({ dayOffset }: { dayOffset: number }) {
  const { call, busy } = useApi();
  return (
    <div className="actions">
      <button className="btn outline small" disabled={!!busy} onClick={() => call("week", "/api/demo", "POST", { action: "shift-days", days: 7 })}>
        Move a week ahead
      </button>
      <button className="btn outline small" disabled={!!busy} onClick={() => call("day", "/api/demo", "POST", { action: "shift-days", days: 1 })}>
        One day ahead
      </button>
      {dayOffset > 0 && (
        <button className="btn outline small" disabled={!!busy} onClick={() => call("today", "/api/demo", "POST", { action: "today" })}>
          Back to today
        </button>
      )}
    </div>
  );
}

export function DeclineToggle({ on }: { on: boolean }) {
  const { call, busy, error } = useApi();
  return (
    <div className="stack-sm">
      <label className="check-row">
        <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => call("decline", "/api/demo", "POST", { action: "decline-next", on: e.target.checked })} />
        Make the next rebuy decline (PayPal sandbox test)
      </label>
      {error && <p className="error small">{error.error}</p>}
    </div>
  );
}

interface ApprovalProps {
  source: PurchaseSource;
  /** What the card shows: the amount charged, and the card's version (a staple's cycle, or when the drop arrived). */
  amountCents: number;
  version: string;
  amountLabel: string;
  method: { label: string; withinCap: boolean; capLabel: string } | null;
  declined: { methodLabel: string; issue: string; simulated: boolean } | null;
  verb: string;
}

export function ApprovalButtons({ source, amountCents, version, amountLabel, method, declined, verb }: ApprovalProps) {
  const { call, busy, error, router } = useApi();

  async function checkout() {
    const r = await call<{ id: string }>("checkout", "/api/intents", "POST", { source, approved: { amountCents, version } }, { refresh: false });
    if (r) router.push(`/checkout/${r.id}`);
  }

  async function yes() {
    const r = await call<{ receiptId: string }>("yes", "/api/pay", "POST", { source, approved: { amountCents, version } });
    if (r) router.push(`/receipts/${r.receiptId}`);
  }

  return (
    <div className="stack-sm" style={{ marginTop: "0.85rem" }}>
      {declined && (
        <div className="decline-box stack-sm">
          <p>
            <strong>PayPal declined {declined.methodLabel}.</strong> Nothing was charged. The bank or card network refused it ({declined.issue}
            {declined.simulated ? ", a sandbox test" : ""}).
          </p>
        </div>
      )}
      {error && !error.declined && (
        <p className="error">
          {error.error}
          {error.alreadyBought && typeof error.receiptId === "string" ? (
            <>
              {" "}
              <a href={`/receipts/${error.receiptId}`}>See the receipt</a>
            </>
          ) : null}
        </p>
      )}
      <div className="actions">
        {declined ? (
          <button className="btn" disabled={!!busy} onClick={checkout}>
            {busy === "checkout" ? "Opening…" : "Approve with another card or PayPal"}
          </button>
        ) : method && method.withinCap ? (
          <>
            <button className="btn" disabled={!!busy} onClick={yes}>
              {busy === "yes" ? "Paying…" : `Yes, ${verb} for ${amountLabel}`}
            </button>
            <button className="btn outline" disabled={!!busy} onClick={checkout}>
              Pay another way
            </button>
          </>
        ) : (
          <button className="btn" disabled={!!busy} onClick={checkout}>
            {busy === "checkout" ? "Opening…" : method ? `Above your ${method.capLabel} cap: pay with PayPal` : `${verb[0].toUpperCase()}${verb.slice(1)} with PayPal`}
          </button>
        )}
      </div>
      {method && !declined && (
        <p className="small muted">
          {method.withinCap ? `Charged to ${method.label} only when you tap yes. Your cap is ${method.capLabel} per rebuy.` : `${method.label} is saved, but this is above its ${method.capLabel} cap.`}
        </p>
      )}
      {!method && !declined && <p className="small muted">The first payment can save your PayPal or card for one-tap rebuys.</p>}
    </div>
  );
}

export function WatchControls({ watchId, canSimulate }: { watchId: string; canSimulate: boolean }) {
  const { call, busy, error } = useApi();
  return (
    <div className="stack-sm">
      <div className="actions">
        {canSimulate && (
          <button className="btn outline small" disabled={!!busy} onClick={() => call("drop", `/api/watch/${watchId}/drop`, "POST", {})}>
            {busy === "drop" ? "Sending…" : "Send a test price drop"}
          </button>
        )}
        <button
          className="btn outline small"
          disabled={!!busy}
          onClick={async (e) => {
            const undo = await leave(e.currentTarget.closest("li"));
            if (!(await call("stop", `/api/watch/${watchId}`, "DELETE"))) undo();
          }}
        >
          Stop watching
        </button>
      </div>
      {error && <p className="error small">{error.error}</p>}
    </div>
  );
}

export function ResetButton() {
  const { call, busy } = useApi();
  return (
    <button
      className="btn outline"
      disabled={!!busy}
      onClick={() => {
        if (window.confirm("Start over with the sample shelf? Your checks and receipts in this browser are cleared, and saved payment methods are deleted at PayPal.")) void call("reset", "/api/demo", "POST", { action: "reset" });
      }}
    >
      {busy ? "Starting over…" : "Start over"}
    </button>
  );
}

export function ReminderDone({ checkId }: { checkId: string }) {
  const { call, busy } = useApi();
  return (
    <button className="btn outline" disabled={!!busy} onClick={() => call("done", `/api/check/${checkId}/remind`, "DELETE")}>
      {busy ? "Clearing…" : "Clear reminder"}
    </button>
  );
}
