import { connection } from "next/server";
import { Suspense } from "react";
import { devCorrections, devSetRuns, runSkipEval, replaySummary, type CaseRow } from "@/lib/app/eval";
import { RULE_TEXT } from "@/lib/app/explain";
import { baselineScore, heldOutHeadline, heldOutResult, type HeldOutRow } from "@/lib/app/holdout";
import { formatDollars } from "@/lib/app/money";
import type { RuleId } from "@/lib/verdict/types";
import { RerunEval } from "../components/RerunEval";
import { VERDICT_WORD } from "../components/VerdictChip";

export const metadata = { title: "How often skip is right" };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** "Nov 6, 2026, 10:28 PM EST" from an ISO time with its offset. */
function et(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(iso));
}

const CATEGORY_WORDS: Record<string, string> = { conditioner: "conditioner", "hair-oil": "hair oil", kettle: "kettle", "lip-balm": "lip balm" };

function Chip({ verdict }: { verdict: string }) {
  return <span className={`chip ${verdict}`}>{VERDICT_WORD[verdict as keyof typeof VERDICT_WORD] ?? verdict}</span>;
}

/** The rule that fired, in words; for an ask on a category the app didn't have yet, says so. */
function ruleText(rule: string, onDefault: boolean, unsupported?: string): string {
  if (unsupported) return `It asked: the app had no ${CATEGORY_WORDS[unsupported] ?? unsupported} category yet, so the product couldn't be matched (rule: ${RULE_TEXT[rule as RuleId]})`;
  return `${RULE_TEXT[rule as RuleId] ?? rule}${onDefault ? " (store policy unknown)" : ""}`;
}

export default function ProofPage() {
  const held = heldOutResult();
  return (
    <main className="page wide stack-lg">
      <div style={{ maxWidth: "48rem" }}>
        <h1>How often is skip right?</h1>
        <p className="lede" data-testid="headline">
          {heldOutHeadline(held)}
        </p>
      </div>
      <HeldOut />
      <Suspense fallback={<div className="skeleton" />}>
        <DevelopmentSet />
      </Suspense>
      <Corrections />
    </main>
  );
}

function HeldOutRows({ rows, showExpected }: { rows: HeldOutRow[]; showExpected?: boolean }) {
  return (
    <div className="table-wrap stacked">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Store</th>
            {showExpected && <th>Expected</th>}
            <th>Engine said</th>
            <th>Why (written first)</th>
            <th>Rule that fired</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Product">
                <span className="mono small">{r.id}</span> {r.product}
              </td>
              <td data-label="Store">{r.store}</td>
              {showExpected && (
                <td data-label="Expected">
                  <Chip verdict={r.expected} />
                </td>
              )}
              <td data-label="Engine said">
                <Chip verdict={r.got} />
              </td>
              <td data-label="Why (written first)">{r.why}</td>
              <td data-label="Rule that fired" className="small">
                {ruleText(r.rule, r.onDefault, r.unsupportedCategory)}
                {r.owned && !r.unsupportedCategory ? `. Closest owned: ${r.owned} (${(r.score ?? 0).toFixed(2)})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeldOut() {
  const r = heldOutResult();
  const o = r.order;
  return (
    <>
      <div className="figures">
        <div className="figure lead">
          <div className="big">
            {r.skipCorrect} of {r.n}
          </div>
          <p>skip decisions right on products it had never seen, against answers written down first.</p>
        </div>
        <div className="figure">
          <div className="big">
            {baselineScore(r, "always-skip")} of {r.n}
          </div>
          <p>if you said skip to everything.</p>
        </div>
        <div className="figure">
          <div className="big">
            {baselineScore(r, "same-category")} of {r.n}
          </div>
          <p>if you skipped anything in a category you already own.</p>
        </div>
        <div className="figure">
          <div className="big">{pct(r.precision)}</div>
          <p>
            precision: {r.skipsRight} of {r.skipsMade} skips were right. Recall {pct(r.recall)}: it caught {r.skipsRight} of the {r.skipsExpected} that should be skipped.
          </p>
        </div>
      </div>

      <section className="card stack-sm">
        <h2>What the held-out skips rest on</h2>
        <div className="split-bars">
          <div className="split-row evidence">
            <strong>{r.split.onEvidence}</strong>
            <span>
              right skips decided on evidence: you own the same or a near-identical item, or the store&apos;s cited policy takes opened returns only on conditions or not at all ({formatDollars(r.split.dollarsOnEvidence)}).
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
          {r.n} real products not used while building the matching, a second fictional shopper with her own shelf and budgets, and expected answers written by hand before the engine saw any of them. Scored once. Full agreement on skip, wait, buy or ask: {pct(r.verdictAgreement)}.
        </p>
      </section>

      <section className="card stack-sm" data-testid="order-of-work">
        <h2>Order of work</h2>
        <ol style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>
            Engine last changed: commit <span className="mono">{o.engine.commit.slice(0, 7)}</span>, {et(o.engine.at)}.
          </li>
          <li>
            Expected answers, shelf and prices committed: <span className="mono">{o.expectations.commit.slice(0, 7)}</span>, {et(o.expectations.at)}.
          </li>
          <li>
            The one scored run, at {et(o.scoredRun.ranAt)} on the code at <span className="mono">{o.expectations.commit.slice(0, 7)}</span>, committed as generated in <span className="mono">{o.scoredRun.commit.slice(0, 7)}</span>, {et(o.scoredRun.at)}: {r.skipCorrect} of {r.n}.
          </li>
        </ol>
        <p className="small muted">
          The numbers on this page are read from that run&apos;s committed results (eval/holdout/results.json), not re-run, so later engine changes can&apos;t move them. The engine was not changed after seeing the result.{" "}
          {correctedCases(r.corrections)}
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>Held out: every wrong skip ({r.wrongSkips.length})</h2>
        </div>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          It said skip, but the written answer was something else.
        </p>
        <HeldOutRows rows={r.wrongSkips} showExpected />
      </section>

      <section>
        <div className="section-head">
          <h2>Held out: every missed skip ({r.missedSkips.length})</h2>
        </div>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          The written answer was skip, and the engine said something else.
        </p>
        <HeldOutRows rows={r.missedSkips} showExpected />
      </section>

      <section>
        <div className="section-head">
          <h2>Held out: the other misses ({r.otherMisses.length})</h2>
        </div>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          Not about skip, so they don&apos;t change the number, but the answer was wrong.
        </p>
        <HeldOutRows rows={r.otherMisses} showExpected />
      </section>

      <details className="card disclosure">
        <summary>The {r.catches.length} correct held-out skips</summary>
        <div style={{ marginTop: "0.85rem" }}>
          <HeldOutRows rows={r.catches} />
        </div>
      </details>

      {r.afterChanges.map((a) => (
        <section className="card stack-sm" key={a.commit} data-testid="after-changes">
          <h2>Held out, after later changes</h2>
          <p>
            Re-run on commit <span className="mono">{a.commit.slice(0, 7)}</span>, {et(a.at)}: {a.skipCorrect} of {a.n} skip decisions right (saying skip to everything gets {baselineScore(a, "always-skip")}; skipping anything in a category you own gets {baselineScore(a, "same-category")}). {a.what}
          </p>
          <p className="small muted">
            These products showed the gaps that change fills, so this is no longer a held-out number. The headline stays {r.skipCorrect} of {r.n}, from the run before it. Wrong skips: {a.wrongSkips.length ? a.wrongSkips.join(", ") : "none"}. Missed skips: {a.missedSkips.length ? a.missedSkips.join(", ") : "none"}.
          </p>
        </section>
      ))}
    </>
  );
}

/** Inputs found wrong after a run: what was wrong, the commits that fixed it (input first, then the expected answers), and the numbers before and after. */
function Corrections() {
  const held = heldOutResult();
  const dev = devCorrections();
  if (!held.corrections.length && !dev.length) return null;
  return (
    <section className="card stack-sm" data-testid="corrections">
      <h2>Corrections</h2>
      {dev.map((c) => {
        const h = held.corrections.find((x) => x.expectations.commit === c.expectations.commit);
        const rerun = held.afterChanges.find((a) => a.commit === c.expectations.commit);
        return (
          <div key={c.expectations.commit} className="stack-sm">
            <p>
              <strong>{et(c.policy.at).split(",").slice(0, 2).join(",")}: store return policies.</strong> {c.what}
            </p>
            <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
              <li>
                Policy table fixed first: commit <span className="mono">{c.policy.commit.slice(0, 7)}</span>, {et(c.policy.at)}.
              </li>
              <li>
                Expected answers corrected next, before any re-run: commit <span className="mono">{c.expectations.commit.slice(0, 7)}</span>, {et(c.expectations.at)}. Development set: {c.expectations.cases.join(", ")}
                {h ? `. Held out: ${h.expectations.cases.join(", ")}` : ""}. Each corrected case keeps the answer it replaced.
              </li>
              <li>
                Development set: {c.before} before, {c.after} after.{c.afterNote ? ` ${c.afterNote}` : ""}
              </li>
              {h && (
                <li>
                  Held out: the headline stays {held.skipCorrect} of {held.n}, read from the scored run in <span className="mono">{held.order.scoredRun.commit.slice(0, 7)}</span>. Effect on that run: {h.scoredRunEffect.charAt(0).toLowerCase() + h.scoredRunEffect.slice(1)}
                  {rerun ? ` Re-run after the correction: ${rerun.skipCorrect} of ${rerun.n} (not a held-out number).` : ""}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </section>
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
                  <Chip verdict={r.got} />
                </td>
              )}
              <td data-label="Why">{r.why}</td>
              <td data-label="Rule that fired" className="small">
                {ruleText(r.rule, r.onDefault)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function DevelopmentSet() {
  await connection();
  const r = runSkipEval();
  const replay = replaySummary();
  const p = r.provenance;
  return (
    <>
      <section className="stack-sm" data-testid="development-set">
        <h2>The set the matching was developed on</h2>
        <p className="small muted" style={{ maxWidth: "48rem" }}>
          {r.n} real products and a different fictional shopper. Expected answers were committed before the engine existed, but this set was then used to improve the matching, so its score is partly fitted. That is why the held-out number above leads.
        </p>
      </section>
      <div className="figures">
        <div className="figure">
          <div className="big">
            {r.skipCorrect} of {r.n}
          </div>
          <p>skip decisions right on the development set, re-run on this request.</p>
        </div>
        <div className="figure">
          <div className="big">
            {baselineScore(r, "always-skip")} of {r.n}
          </div>
          <p>if you said skip to everything.</p>
        </div>
        <div className="figure">
          <div className="big">
            {baselineScore(r, "same-category")} of {r.n}
          </div>
          <p>if you skipped anything in a category you already own.</p>
        </div>
        <div className="figure">
          <div className="big">{formatDollars(r.split.dollarsAvoided)}</div>
          <p>
            of duplicate or hard-to-return buys not made on the {r.skipsRight} right skips ({r.split.onEvidence} on evidence, {r.split.onDefault} on the unknown-policy default).
          </p>
        </div>
      </div>

      <section className="card stack-sm">
        <h2>Its runs</h2>
        <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>
            Expected answers: commit <span className="mono">{p.expectations.commit.slice(0, 7)}</span>, {et(p.expectations.at)}. The engine: <span className="mono">{p.engine.commit.slice(0, 7)}</span>, {et(p.engine.at)}.
          </li>
          {devSetRuns(p).map((run) => (
            <li key={run.commit}>
              {run.label} (<span className="mono">{run.commit.slice(0, 7)}</span>
              {run.at ? `, ${et(run.at)}` : ""}): {run.result}.
            </li>
          ))}
          <li>
            {devCorrections(p).length ? "The expected answers changed once, for a store policy we had misread, before re-running (see Corrections)." : "The expected answers were never touched."} Case by case: eval/skip-set/RESULTS.md in the repository.
          </li>
        </ul>
      </section>

      <RerunEval />

      <section>
        <div className="section-head">
          <h2>Development set: every wrong skip ({r.wrongSkips.length})</h2>
        </div>
        <Rows rows={r.wrongSkips} />
      </section>

      <section>
        <div className="section-head">
          <h2>Development set: every missed skip ({r.missedSkips.length})</h2>
        </div>
        <Rows rows={r.missedSkips} showGot />
      </section>

      <details className="card disclosure">
        <summary>The {r.catches.length} correct development-set skips</summary>
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
        <h2>How the tests were built</h2>
        <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>The products, prices and store policies are real catalogue listings and published policies. The shoppers, shelves and budgets are made up; the shopper&apos;s &quot;today&quot; in both tests is Nov 7, 2026.</li>
          <li>Each expected answer was written by hand from plain-language rules (eval/holdout/README.md) and committed before the engine saw it.</li>
          <li>Full results, case by case: eval/holdout/RESULTS.md and eval/skip-set/RESULTS.md in the repository; both sets as JSON at /api/eval/holdout.</li>
        </ul>
      </section>
    </>
  );
}

/** How many held-out expected answers were corrected, counted from the recorded corrections. */
function correctedCases(corrections: Array<{ expectations: { cases: string[] } }>): string {
  const n = new Set(corrections.flatMap((c) => c.expectations.cases)).size;
  if (!n) return "Nor were the expected answers.";
  return `${n === 1 ? "One expected answer's" : `${n} expected answers'`} reason text ${n === 1 ? "was" : "were"} later corrected for a store policy we had misread; see Corrections.`;
}
