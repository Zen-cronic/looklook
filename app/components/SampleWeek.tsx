"use client";

import { useState } from "react";

/** Says the data on screen is the sample week: a made-up shopper, real catalogue products. */
export function SampleWeekNote() {
  return (
    <p className="sample-note" data-testid="sample-week-note">
      <span className="chip sim">Sample week</span>{" "}
      <span className="small">A fictional shopper&apos;s week of checks: sample data. The products, stores and prices are real catalogue listings; the shopper and the checks are made up.</span>
    </p>
  );
}

/**
 * Load the sample week (seven checks: two price waits, two budget waits, two
 * skips and a buy, plus a staple due for a rebuy), or reset to a fresh shelf.
 */
export function SampleWeekControls({ loaded }: { loaded: boolean }) {
  const [busy, setBusy] = useState<"sample-week" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "sample-week" | "reset") {
    if (action === "reset" && !window.confirm("Reset to a fresh sample shelf? Your checks, saved methods and receipts in this browser are cleared.")) return;
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
      {loaded && <SampleWeekNote />}
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
