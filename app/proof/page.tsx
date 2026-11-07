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

/** "Nov 6, 2026, 8:57 PM ET" from an ISO time with its offset. */
function et(iso: string): string {
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso))} ET`;
}

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
    <div className="table-wrap stacked">
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
              <td data-label="Product">{r.product}</td>
              <td data-label="Store">{r.store}</td>
              {showGot && (
                <td data-label="Engine said">
                  <span className={`chip ${r.got}`}>{VERDICT_WORD[r.got as keyof typeof VERDICT_WORD]}</span>
                </td>
              )}
              <td data-label="Why">{r.why}</td>
              <td data-label="Rule that fired" className="small">
                {RULE_TEXT[r.rule as RuleId]}
                {r.onDefault ? " (store policy unknown)" : ""}
              </td>
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
  const always = r.baselines.find((b) => b.id === "always-skip")!;
  const sameCategory = r.baselines.find((b) => b.id === "same-category")!;
  const p = r.provenance;
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
            {always.skipCorrect} of {r.n}
          </div>
          <p>if you said skip to everything.</p>
        </div>
        <div className="figure">
          <div className="big">
            {sameCategory.skipCorrect} of {r.n}
          </div>
          <p>if you skipped anything in a category you already own.</p>
        </div>
        <div className="figure">
          <div className="big">{formatDollars(r.split.dollarsAvoided)}</div>
          <p>of duplicate or hard-to-return buys not made on the {r.skipsRight} right skips (prices shown).</p>
        </div>
      </div>

      <section className="card stack-sm">
        <h2>What the skips rest on</h2>
        <div className="split-bars">
          <div className="split-row evidence">
            <strong>{r.split.onEvidence}</strong>
            <span>
              right skips decided on evidence: you own the same or a near-identical item, or the store&apos;s cited policy refuses opened returns or takes them only on conditions ({formatDollars(r.split.dollarsOnEvidence)}).
            </span>
          </div>
          <div className="split-row default">
            <strong>{r.split.onDefault}</strong>
            <span>
              right skips that needed our default: a partial overlap at a store whose opened-return policy we couldn&apos;t find, counted as not returnable ({formatDollars(r.split.dollarsOnDefault)}).
            </span>
          </div>
        </div>
        <p className="small muted">
          It said skip {r.skipsMade} times and was right {r.skipsRight} times; it caught {r.skipsRight} of the {r.skipsExpected} items that should be skipped. Full agreement on skip, wait, buy or ask: {pct(r.verdictAgreement)}.
        </p>
      </section>

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

      <details className="card disclosure">
        <summary>The {r.catches.length} correct skips</summary>
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
          <li>The products, prices and store policies are real, captured on Nov 6, 2026 (US Eastern). The shopper, shelf and budgets are made up; the shopper&apos;s &quot;today&quot; in the test is Nov 7, 2026.</li>
          <li>
            Expected answers: commit <span className="mono">{p.expectations.commit.slice(0, 7)}</span>, {et(p.expectations.at)}. The engine: commit <span className="mono">{p.engine.commit.slice(0, 7)}</span>, {et(p.engine.at)}. First scored run: <span className="mono">{p.firstRun.commit.slice(0, 7)}</span>, {et(p.firstRun.at)}, 55 of 65.
          </li>
          {p.changes.map((c) => (
            <li key={c.what}>
              Later engine change{c.commit ? <> (<span className="mono">{c.commit.slice(0, 7)}</span>{c.at ? `, ${et(c.at)}` : ""})</> : ""}: {c.what} Result: {c.result}. The expected answers were not touched.
            </li>
          ))}
          <li>Full results, case by case: eval/skip-set/RESULTS.md in the repository.</li>
        </ul>
      </section>
    </>
  );
}
