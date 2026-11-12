"use client";

import { useState } from "react";
import { useApi } from "./useApi";

export function MethodControls({ id, label, capDollars }: { id: string; label: string; capDollars: number }) {
  const { call, busy, error } = useApi();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(capDollars));
  return (
    <div className="stack-sm">
      {error && <p className="error">{error.error}</p>}
      {editing ? (
        <form
          className="actions"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await call("cap", `/api/methods/${id}`, "PATCH", { capCents: Math.round(Number(cap) * 100) });
            if (ok) setEditing(false);
          }}
        >
          <div className="cap-input">
            <span>$</span>
            <input type="number" min="1" max="1000" step="1" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Cap per reorder in dollars" />
          </div>
          <button className="btn small" disabled={!!busy}>
            Save cap
          </button>
          <button type="button" className="btn outline small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="actions">
          <button className="btn outline small" onClick={() => setEditing(true)}>
            Change cap
          </button>
          <button
            className="btn danger small"
            disabled={!!busy}
            onClick={() => {
              if (window.confirm(`Remove ${label}? PayPal deletes the saved method and no reorder can use it.`)) void call("remove", `/api/methods/${id}`, "DELETE");
            }}
          >
            {busy === "remove" ? "Removing, confirming with PayPal…" : "Remove"}
          </button>
        </div>
      )}
    </div>
  );
}

/** A removal PayPal hasn't confirmed: delete again and check. */
export function RetryRemoval({ id }: { id: string }) {
  const { call, busy, error } = useApi();
  return (
    <div className="stack-sm">
      {error && <p className="error">{error.error}</p>}
      <div className="actions">
        <button className="btn outline small" disabled={!!busy} onClick={() => void call("retry", `/api/methods/${id}`, "DELETE")}>
          {busy ? "Removing, confirming with PayPal…" : "Retry removal"}
        </button>
      </div>
    </div>
  );
}
