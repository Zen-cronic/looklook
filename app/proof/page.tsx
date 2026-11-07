import { connection } from "next/server";
import { Suspense } from "react";
import { runSkipEval, replaySummary, type CaseRow } from "@/lib/app/eval";
import { RULE_TEXT } from "@/lib/app/explain";
import { formatDollars } from "@/lib/app/money";
import type { RuleId } from "@/lib/verdict/types";
import { RerunEval } from "../components/RerunEval";
import { VERDICT_WORD } from "../components/VerdictChip";

export const metadata = { title: "How often skip is right" };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function ProofPage() {
  return (
    <main className="page wide stack-lg">
      <div style={{ maxWidth: "46rem" }}>
        <h1>How often is skip right?</h1>
        <p className="lede">65 real products, a sample shopper&apos;s shelf and budgets, and the store return policies we cite. The right answer for each was written down and committed before the engine existed.</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Proof />
      </Suspense>
    </main>
  );
}

function Rows({ rows, showGot }: { rows: CaseRow[]; showGot?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Store</th>
            {showGot && <th>Engine said</th>}
            <th>Why</th>
            <th>Rule that fired</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.product}</td>
              <td>{r.store}</td>
              {showGot && (
                <td>
                  <span className={`chip ${r.got}`}>{VERDICT_WORD[r.got as keyof typeof VERDICT_WORD]}</span>
                </td>
              )}
              <td>{r.why}</td>
              <td className="small">{RULE_TEXT[r.rule as RuleId]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Proof() {
  await connection();
  const r = runSkipEval();
  const replay = replaySummary();
  return (
    <>
      <div className="figures">
        <div className="figure lead">
          <div className="big">
            {r.skipCorrect} of {r.n}
          </div>
          <p>skip decisions matched the answers written down first.</p>
        </div>
        <div className="figure">
          <div className="big">
            {r.skipsRight}/{r.skipsMade}
          </div>
          <p>times it said skip, it was right.</p>
          <div className="metric">skip precision {pct(r.precision)}</div>
        </div>
        <div className="figure">
          <div className="big">
            {r.skipsRight}/{r.skipsExpected}
          </div>
          <p>items that should be skipped were caught.</p>
          <div className="metric">skip recall {pct(r.recall)}</div>
        </div>
        <div className="figure">
          <div className="big">{r.nearDuplicatesCaught}</div>
          <p>skips because the shopper already owned the same or a near-identical item.</p>
        </div>
      </div>

      <RerunEval />

      <section>
        <div className="section-head">
          <h2>Every wrong skip ({r.wrongSkips.length})</h2>
        </div>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          It said skip, but the written answer was something else.
        </p>
        <Rows rows={r.wrongSkips} />
      </section>

      <section>
        <div className="section-head">
          <h2>Every missed skip ({r.missedSkips.length})</h2>
        </div>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          The written answer was skip, and the engine said something else.
        </p>
        <Rows rows={r.missedSkips} showGot />
      </section>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>The {r.catches.length} correct skips</summary>
        <div style={{ marginTop: "0.85rem" }}>
          <Rows rows={r.catches} />
        </div>
      </details>

      <section className="card stack-sm">
        <h2>Waiting for a lower price</h2>
        <p>
          A separate test of the wait rule on {replay.products} purchases with real 90-day price histories: waiting by our rule paid {formatDollars(replay.saved)} ({pct(replay.savedPct)}) less than buying on the first price alert. For beauty staples it was {formatDollars(replay.beautySaved)}, so for beauty the app helps by saying skip, not by waiting.
        </p>
      </section>

      <section className="card stack-sm">
        <h2>How the test was built</h2>
        <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>The products, prices and store policies are real, as of {r.asOf}. The shopper, shelf and budgets are made up.</li>
          <li>Expected answers were committed to the repository before the engine was written, and neither has been changed since the first run.</li>
          <li>{r.unknownPolicyCaught} of the correct skips are at stores whose opened-return policy we couldn&apos;t find; the engine treats unknown as not returnable.</li>
          <li>Full results, case by case: eval/skip-set/RESULTS.md in the repository.</li>
        </ul>
      </section>
    </>
  );
}
