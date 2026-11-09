"use client";

import { useState } from "react";

interface DevSet {
  skipCorrect: number;
  n: number;
}

/** Re-runs the development set on the server, from the header row of its section. */
export function RerunEval({ n }: { n: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DevSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rerun">
      <button
        className="btn small"
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
        {busy ? "Running…" : `Re-run the ${n}`}
      </button>
      <p className="small muted">On the server. No AI model, no network.</p>
      {error && <p className="error small">{error}</p>}
      {result && (
        <p className="small" role="status">
          <strong>
            Re-run just now: {result.skipCorrect} of {result.n} right.
          </strong>
        </p>
      )}
    </div>
  );
}
