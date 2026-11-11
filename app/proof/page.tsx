import { connection } from "next/server";
import { Suspense } from "react";
import { devCorrections, devSetRuns, runSkipEval, type CaseRow } from "@/lib/app/eval";
import { RULE_TEXT } from "@/lib/app/explain";
import { plainModelBaseline } from "@/lib/app/baseline";
import { baselineScore, heldOutHeadline, heldOutResult, type HeldOutRow } from "@/lib/app/holdout";
import { formatDollars } from "@/lib/app/money";
import type { RuleId } from "@/lib/verdict/types";
import { RerunEval } from "../components/RerunEval";
import { VERDICT_WORD } from "../components/VerdictChip";
import { APP_NAME } from "@/lib/brand";
import { filmOn } from "@/lib/filming/server";
import { neutralDeep } from "@/lib/filming/view";
import l from "../landing.module.css";
import { Eyebrow } from "../components/Eyebrow";

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
      <Suspense fallback={<div className="skeleton" />}>
        <HeldOut />
      </Suspense>
      <Suspense fallback={<div className="skeleton" />}>
        <DevelopmentSet />
      </Suspense>
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
            <th>App said</th>
            <th>Expected answer&apos;s reason</th>
            <th>Rule used</th>
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
              <td data-label="App said">
                <Chip verdict={r.got} />
              </td>
              <td data-label="Expected answer's reason">{r.why}</td>
              <td data-label="Rule used" className="small">
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One disclosure row: a one-line summary, the detail inside. */
function Row({ summary, children, testId }: { summary: string; children: React.ReactNode; testId?: string }) {
  return (
    <details className="proof-row" data-testid={testId}>
      <summary>{summary}</summary>
      <div className="proof-row-body">{children}</div>
    </details>
  );
}

async function HeldOut() {
  // Filming mode lists the products and stores by generic names; the results are the same.
  const film = await filmOn();
  const r = film ? neutralDeep(heldOutResult()) : heldOutResult();
  const o = r.order;
  const bars = [
    { label: APP_NAME, value: r.skipCorrect, mine: true },
    { label: `The same model with no ${APP_NAME} rules (median of ${plainModelBaseline().runs.length} runs)`, value: plainModelBaseline().median },
    { label: "Skipping anything in a category you own", value: baselineScore(r, "same-category") },
    { label: "Saying skip to everything", value: baselineScore(r, "always-skip") },
  ];
  const last = r.afterChanges.at(-1);
  return (
    <>
      <section className={l.proof} aria-labelledby="chart-title">
        <div>
          <Eyebrow as="h2" icon="chart" id="chart-title" className={l.proofEyebrow}>
            Right skips out of {r.n}
          </Eyebrow>
          <p className={l.proofFigure} aria-hidden="true">
            {r.skipCorrect}
            <span className={l.proofOf}>/{r.n}</span>
          </p>
          <p className={l.proofText}>{`Right skips out of ${r.n} products the app had never seen. The expected answers were written down before the run.`}</p>
          <p className="proof-plain">
            When it said skip, it was right {r.skipsRight} of {r.skipsMade} times, and it caught {r.skipsRight} of the {r.skipsExpected} products that should be skipped.
          </p>
        </div>
        <ul className={l.bars} aria-label={`Right skips out of ${r.n}`}>
          {bars.map((b) => (
            <li key={b.label} className={b.mine ? l.barMine : undefined}>
              <span className={l.barLabel}>{b.label}</span>
              <span className={l.barTrack}>
                <span className={l.barFill} style={{ width: `${(b.value / r.n) * 100}%` }} />
              </span>
              <span className={l.barValue}>{b.value}</span>
            </li>
          ))}
          <li className={l.scale} aria-hidden="true">
            <span>0</span>
            <span>{r.n} products</span>
          </li>
        </ul>
      </section>

      <section className="card stack-sm">
        <h2>What the {r.skipsRight} right skips rest on</h2>
        <div className="split-bars">
          <div className="split-row evidence">
            <strong>{r.split.onEvidence}</strong>
            <span>on evidence: you own the same or a near-identical item, or the store limits opened returns ({formatDollars(r.split.dollarsOnEvidence)}).</span>
          </div>
          <div className="split-row default">
            <strong>{r.split.onDefault}</strong>
            <span>on our default: a partial overlap at a store whose opened-return policy we couldn&apos;t find, which we count as not returnable ({formatDollars(r.split.dollarsOnDefault)}).</span>
          </div>
        </div>
      </section>

      <div className="proof-rows">
        <Row summary={plural(r.wrongSkips.length, "wrong skip: it said skip, the expected answer was different", "wrong skips: it said skip, the expected answer was different")}>
          <HeldOutRows rows={r.wrongSkips} showExpected />
        </Row>
        <Row summary={plural(r.missedSkips.length, "missed skip: the expected answer was skip, it said something else", "missed skips: the expected answer was skip, it said something else")}>
          <HeldOutRows rows={r.missedSkips} showExpected />
        </Row>
        <Row summary={plural(r.otherMisses.length, "other miss: wrong answer, but not about skip", "other misses: wrong answer, but not about skip")}>
          <HeldOutRows rows={r.otherMisses} showExpected />
        </Row>
        <Row summary={plural(r.catches.length, "right skip", "right skips")}>
          <HeldOutRows rows={r.catches} />
        </Row>
        <Row summary="Order of work: app frozen, answers committed, then one scored run" testId="order-of-work">
          <ol style={{ marginLeft: "1.1rem" }} className="stack-sm">
            <li>App last changed: {et(o.engine.at)}.</li>
            <li>Expected answers, shelf and prices committed: {et(o.expectations.at)}.</li>
            <li>
              The one scored run, at {et(o.scoredRun.ranAt)}: {r.skipCorrect} of {r.n}.
            </li>
          </ol>
          <p className="mono small commit-line">
            app {o.engine.commit.slice(0, 7)}, answers {o.expectations.commit.slice(0, 7)}, run {o.scoredRun.commit.slice(0, 7)}
          </p>
          <p className="small muted">
            These numbers come from that run&apos;s saved results, not a re-run, so later changes can&apos;t move them. The app was not changed after seeing the result. {correctedCases(r.corrections)}
          </p>
        </Row>
        {last && (
          <Row summary={`Re-runs after later changes: ${last.skipCorrect} of ${last.n} (not a fresh test)`}>
            {r.afterChanges.map((a) => (
              <p key={a.commit} data-testid="after-changes">
                <span className="mono small">{a.commit.slice(0, 7)}</span> ({et(a.at)}): {a.skipCorrect} of {a.n}. {a.what} Missed: {[...a.wrongSkips, ...a.missedSkips].join(", ") || "none"}.
              </p>
            ))}
            <p className="small muted">
              These products showed the gaps the changes fix, so the re-runs don&apos;t count as a fresh test. The headline stays {r.skipCorrect} of {r.n}.
            </p>
          </Row>
        )}
        <Corrections film={film} />
        <Row summary="How the test was built">
          <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
            <li>
              {r.n} real products not used while building the matching, a second made-up shopper with her own shelf and budgets, and expected answers written by hand before the app saw any of them (eval/holdout/README.md). Scored once. Full agreement on skip, wait, buy or ask: {pct(r.verdictAgreement)}.
            </li>
            <li>
              Skip precision {pct(r.precision)}, recall {pct(r.recall)}. In testing terms these {r.n} are held-out products.
            </li>
            <li>The products, prices and store policies are real catalogue listings and published policies. The shoppers, shelves and budgets are made up. The shopper&apos;s &quot;today&quot; in both tests is Nov 7, 2026.</li>
            <li>Results, case by case: eval/holdout/RESULTS.md (saved as eval/holdout/results.json) and eval/skip-set/RESULTS.md in the repository. Both sets as JSON at /api/eval/holdout.</li>
          </ul>
        </Row>
      </div>
    </>
  );
}

/** Inputs found wrong after a run: what was wrong, the commits that fixed it (input first, then the expected answers), and the numbers before and after. */
function Corrections({ film }: { film: boolean }) {
  const held = film ? neutralDeep(heldOutResult()) : heldOutResult();
  const dev = film ? neutralDeep(devCorrections()) : devCorrections();
  if (!held.corrections.length && !dev.length) return null;
  return (
    <Row summary={`Corrections (${dev.length})`} testId="corrections">
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
                {h ? `. Never-seen set: ${h.expectations.cases.join(", ")}` : ""}. Each corrected case keeps the answer it replaced.
              </li>
              <li>
                Development set: {c.before} before, {c.after} after.{c.afterNote ? ` ${c.afterNote}` : ""}
              </li>
              {h && (
                <li>
                  Never-seen set: the headline stays {held.skipCorrect} of {held.n}, read from the scored run in <span className="mono">{held.order.scoredRun.commit.slice(0, 7)}</span>. Effect on that run: {h.scoredRunEffect.charAt(0).toLowerCase() + h.scoredRunEffect.slice(1)}
                  {rerun ? ` Re-run after the correction: ${rerun.skipCorrect} of ${rerun.n} (not a fresh test).` : ""}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </Row>
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
            {showGot && <th>App said</th>}
            <th>Expected answer&apos;s reason</th>
            <th>Rule used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Product">{r.product}</td>
              <td data-label="Store">{r.store}</td>
              {showGot && (
                <td data-label="App said">
                  <Chip verdict={r.got} />
                </td>
              )}
              <td data-label="Expected answer's reason">{r.why}</td>
              <td data-label="Rule used" className="small">
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
  const r = (await filmOn()) ? neutralDeep(runSkipEval()) : runSkipEval();
  const p = r.provenance;
  const runs = devSetRuns(p);
  return (
    <>
      <section className="card stack-sm" data-testid="development-set">
        <div className="step-head">
          <h2>The {r.n} products it was built on</h2>
          <RerunEval n={r.n} />
        </div>
        <p>
          {r.skipCorrect} of {r.n} right, re-run now (same category: {baselineScore(r, "same-category")}; skip everything: {baselineScore(r, "always-skip")}). This set was used to tune the matching, so the score at the top leads.
        </p>
        <div className="proof-rows">
          <Row summary={plural(r.wrongSkips.length, "wrong skip", "wrong skips")}>
            <Rows rows={r.wrongSkips} />
          </Row>
          <Row summary={plural(r.missedSkips.length, "missed skip", "missed skips")}>
            <Rows rows={r.missedSkips} showGot />
          </Row>
          <Row summary={plural(r.catches.length, "right skip", "right skips")}>
            <Rows rows={r.catches} />
          </Row>
          <Row summary={`Run history (${runs.length} runs)`}>
            <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
              <li>
                Expected answers committed {et(p.expectations.at)}; the app as of {et(p.engine.at)}. <span className="mono small">answers {p.expectations.commit.slice(0, 7)}, app {p.engine.commit.slice(0, 7)}</span>
              </li>
              {runs.map((run) => (
                <li key={run.commit}>
                  {run.label} (<span className="mono">{run.commit.slice(0, 7)}</span>
                  {run.at ? `, ${et(run.at)}` : ""}): {run.result}.
                </li>
              ))}
              <li>
                On its {r.skipsRight} right skips: {formatDollars(r.split.dollarsAvoided)} of duplicate or hard-to-return buys not made ({r.split.onEvidence} on evidence, {r.split.onDefault} on the unknown-policy default).
              </li>
              <li>
                {devCorrections(p).length ? "The expected answers changed once, for a store policy we had misread, before re-running (see Corrections)." : "The expected answers were never touched."} Case by case: eval/skip-set/RESULTS.md in the repository.
              </li>
            </ul>
          </Row>
        </div>
      </section>

    </>
  );
}

/** How many held-out expected answers were corrected, counted from the recorded corrections. */
function correctedCases(corrections: Array<{ expectations: { cases: string[] } }>): string {
  const n = new Set(corrections.flatMap((c) => c.expectations.cases)).size;
  if (!n) return "Nor were the expected answers.";
  return `${n === 1 ? "One expected answer's" : `${n} expected answers'`} reason text ${n === 1 ? "was" : "were"} later corrected for a store policy we had misread. See Corrections.`;
}
