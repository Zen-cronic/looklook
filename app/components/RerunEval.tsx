"use client";

import { useState } from "react";

interface DevSet {
  skipCorrect: number;
  n: number;
  skipsRight: number;
  skipsMade: number;
  ms: number;
  ranAt: string;
}

export function RerunEval() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DevSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card stack-sm">
      <div className="split">
        <div>
          <h2>Run it again</h2>
          <p className="small muted">The server re-runs the current verdict engine over the 65 development products. No model, no network. The held-out number above is the record of its one scored run and is not re-run.</p>
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/eval/skip", { cache: "no-store" });
              if (!res.ok) throw new Error();
              setResult(((await res.json()) as { developmentSet: DevSet }).developmentSet);
            } catch {
              setError("The re-run failed. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Running…" : "Run"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="notice" role="status">
          <strong>
            {result.skipCorrect} of {result.n}
          </strong>{" "}
          skip decisions correct on the development set; {result.skipsRight} of {result.skipsMade} skips right. Took {result.ms} ms on the server at {new Date(result.ranAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" })} ET.
        </p>
      )}
    </div>
  );
}
