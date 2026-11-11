"use client";

import { useState } from "react";

/**
 * Load the sample week (six checks: a price wait, two budget waits, two
 * skips and a buy, plus a staple due for a rebuy), or reset to a fresh shelf.
 */
export function SampleWeekControls({ loaded }: { loaded: boolean }) {
  const [busy, setBusy] = useState<"sample-week" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "sample-week" | "reset") {
    if (action === "reset" && !window.confirm("Start over with a fresh sample shelf? This clears your checks and receipts in this browser and deletes saved payment methods at PayPal.")) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error(String(res.status));
      window.location.reload();
    } catch {
      setError("Couldn't change the sample data. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="sample-controls">
      <div className="actions">
        <button className="btn outline small" disabled={!!busy} onClick={() => run("sample-week")} data-testid="load-sample-week">
          {busy === "sample-week" ? "Loading…" : loaded ? "Load the sample week again" : "Load the sample week"}
        </button>
        <button className="btn outline small" disabled={!!busy} onClick={() => run("reset")} data-testid="reset-sample">
          {busy === "reset" ? "Resetting…" : "Reset"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
