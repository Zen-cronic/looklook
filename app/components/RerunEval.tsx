"use client";

import { useState } from "react";

interface Result {
  skipCorrect: number;
  n: number;
  skipsRight: number;
  skipsMade: number;
  ms: number;
  ranAt: string;
}

export function RerunEval() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card stack-sm">
      <div className="split">
        <div>
          <h2>Run it again</h2>
          <p className="small muted">The server re-runs the verdict engine over all 65 cases. No model, no network.</p>
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
              setResult(await res.json());
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
          skip decisions correct; {result.skipsRight} of {result.skipsMade} skips right. Took {result.ms} ms on the server at {new Date(result.ranAt).toLocaleTimeString()}.
        </p>
      )}
    </div>
  );
}
