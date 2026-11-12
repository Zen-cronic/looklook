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
import s from "./proof.module.css";
import { Eyebrow } from "../components/Eyebrow";

export const metadata = { title: "How often skip is right" };

/** "Nov 6, 2026, 10:28 PM EST" from an ISO time with its offset. */
function et(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(iso));
}

const CATEGORY_WORDS: Record<string, string> = { conditioner: "conditioner", "hair-oil": "hair oil", kettle: "kettle", "lip-balm": "lip balm" };

function Chip({ verdict }: { verdict: string }) {
  return <span className={`chip ${verdict}`}>{VERDICT_WORD[verdict as keyof typeof VERDICT_WORD] ?? verdict}</span>;
}

/** The reason the app gave, in words. For a category the app didn't have yet, says so. */
function reasonText(rule: string, onDefault: boolean, unsupported?: string): string {
  if (unsupported) return `It had no ${CATEGORY_WORDS[unsupported] ?? unsupported} category yet, so it couldn't match the product and asked`;
  return `${RULE_TEXT[rule as RuleId] ?? rule}${onDefault ? " (store policy unknown)" : ""}`;
}

/** Recorded notes use semicolons; on the page each clause becomes its own sentence. */
const sentences = (text: string) => text.replace(/; (\S)/g, (_, c: string) => `. ${c.toUpperCase()}`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (commit: string) => commit.slice(0, 7);

export default function ProofPage() {
  const held = heldOutResult();
  return (
    <main className={`page wide ${s.page}`}>
      <header className={s.hero}>
        <Eyebrow icon="chart">Accuracy test</Eyebrow>
        <h1>How often is skip right?</h1>
        <p className={s.lede} data-testid="headline">
          {heldOutHeadline(held)}
        </p>
      </header>
      <Suspense fallback={<div className="skeleton" />}>
        <HeldOut />
      </Suspense>
      <Suspense fallback={<div className="skeleton" />}>
        <DevelopmentSet />
      </Suspense>
      <Suspense fallback={<div className="skeleton" />}>
        <HowWeTested />
      </Suspense>
    </main>
  );
}

/** One disclosure row: a one-line summary, the detail inside. */
function Row({ summary, children, testId }: { summary: string; children: React.ReactNode; testId?: string }) {
  return (
    <details className="proof-row" data-testid={testId}>
      <summary>{summary}</summary>
      <div className="proof-row-body">{children}</div>
    </details>
  );
}

type Mark = "skip" | "keep" | "other" | "wrong";
const MARKS: Mark[] = ["skip", "keep", "other", "wrong"];

/** Each product as one square: a right skip, a right "don't skip", right on skip but wrong between buy, wait and ask, or a skip mistake. */
function markOf(c: HeldOutRow): Mark {
  const said = c.got === "skip";
  if (said !== (c.expected === "skip")) return "wrong";
  if (said) return "skip";
  return c.got === c.expected ? "keep" : "other";
}

async function HeldOut() {
  // Filming mode lists the products and stores by generic names; the results are the same.
  const film = await filmOn();
  const r = film ? neutralDeep(heldOutResult()) : heldOutResult();
  const plain = plainModelBaseline();
  const bars = [
    { label: APP_NAME, value: r.skipCorrect, mine: true },
    { label: `Same AI model without ${APP_NAME}'s rules (middle of ${plain.runs.length} runs)`, value: plain.median },
    { label: "Skip anything in a category you own", value: baselineScore(r, "same-category") },
    { label: "Skip everything", value: baselineScore(r, "always-skip") },
  ];
  const squares = [...r.cases].sort((a, b) => MARKS.indexOf(markOf(a)) - MARKS.indexOf(markOf(b)));
  const count = (m: Mark) => r.cases.filter((c) => markOf(c) === m).length;
  const skipMisses = r.wrongSkips.length + r.missedSkips.length;
  const evidenceShare = r.skipsRight ? (r.split.onEvidence / r.skipsRight) * 100 : 0;
  return (
    <>
      <section className={`${l.proof} ${s.result}`} aria-labelledby="chart-title">
        <div>
          <Eyebrow as="h2" icon="chart" id="chart-title" className={l.proofEyebrow}>
            Products it had never seen
          </Eyebrow>
          <p className={l.proofFigure} aria-hidden="true">
            {r.skipCorrect}
            <span className={l.proofOf}>/{r.n}</span>
          </p>
          <p className={l.proofText}>Right to skip or not, on {r.n} real products. We wrote down each right answer first.</p>
        </div>
        <ul className={l.bars} aria-label={`Right out of ${r.n}`}>
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

      <section className={s.section} aria-labelledby="misses-title">
        <h2 id="misses-title" className={s.title}>
          Where it went wrong
        </h2>
        <p className={s.note}>
          When it said skip, it was right {r.skipsRight} of {r.skipsMade} times. It caught {r.skipsRight} of the {r.skipsExpected} products it should skip.
        </p>
        <ol className={s.grid} aria-hidden="true">
          {squares.map((c) => (
            <li key={c.id} className={s[markOf(c)]} />
          ))}
        </ol>
        <ul className={s.legend}>
          <li>
            <i className={s.skip} aria-hidden="true" />
            <span>
              <b>{count("skip")}</b> right skips
            </span>
          </li>
          <li>
            <i className={s.keep} aria-hidden="true" />
            <span>
              <b>{count("keep")}</b> right not to skip
            </span>
          </li>
          <li>
            <i className={s.other} aria-hidden="true" />
            <span>
              <b>{count("other")}</b> right not to skip, but the wrong pick of {VERDICT_WORD.buy}, {VERDICT_WORD.wait} or {VERDICT_WORD.ask}
            </span>
          </li>
          <li>
            <i className={s.wrong} aria-hidden="true" />
            <span>
              <b>{r.wrongSkips.length}</b> {r.wrongSkips.length === 1 ? "wrong skip" : "wrong skips"} and <b>{r.missedSkips.length}</b> {r.missedSkips.length === 1 ? "missed skip" : "missed skips"}
            </span>
          </li>
        </ul>

        <h3 className={s.subhead}>The {plural(skipMisses, "skip mistake", "skip mistakes")}</h3>
        <MissList rows={[...r.wrongSkips, ...r.missedSkips]} />

        <div className="proof-rows">
          {r.otherMisses.length > 0 && (
            <Row summary={`The ${plural(r.otherMisses.length, "other wrong answer", "other wrong answers")}: right not to skip`}>
              <MissList rows={r.otherMisses} />
            </Row>
          )}
          <Row summary={`Every case: all ${r.n} products`}>
            <CaseTable rows={r.cases} />
          </Row>
        </div>
      </section>

      <section className={s.section} aria-labelledby="split-title">
        <h2 id="split-title" className={s.title}>
          Why the {r.skipsRight} right skips were right
        </h2>
        <div className={s.split} aria-hidden="true">
          <span className={s.splitEvidence} style={{ flexBasis: `${evidenceShare}%` }} />
          <span className={s.splitDefault} />
        </div>
        <dl className={s.splitRows}>
          <div>
            <dt>
              <i className={s.splitEvidence} aria-hidden="true" />
              {r.split.onEvidence}
            </dt>
            <dd>You already own one like it, or the store won&apos;t take it back opened. {formatDollars(r.split.dollarsOnEvidence)} not spent.</dd>
          </div>
          <div>
            <dt>
              <i className={s.splitDefault} aria-hidden="true" />
              {r.split.onDefault}
            </dt>
            <dd>You own something close, and we couldn&apos;t find the store&apos;s rule for opened returns, so we count it as no returns. {formatDollars(r.split.dollarsOnDefault)} not spent.</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

/** Wrong answers, one row each: the product, the right answer against what it said, and why. */
function MissList({ rows }: { rows: HeldOutRow[] }) {
  return (
    <ul className={s.misses}>
      {rows.map((m) => (
        <li key={m.id} className={markOf(m) === "wrong" ? s.missSkip : undefined}>
          <div className={s.missHead}>
            <strong>{m.product}</strong>
            <span className={s.store}>{m.store}</span>
          </div>
          <div className={s.missChips}>
            <span className={s.chipLabel}>Right answer</span>
            <Chip verdict={m.expected} />
            <span className={s.chipLabel}>It said</span>
            <Chip verdict={m.got} />
          </div>
          <p className={s.missWhy}>{sentences(m.why)}</p>
        </li>
      ))}
    </ul>
  );
}

function CaseTable({ rows }: { rows: HeldOutRow[] }) {
  return (
    <div className="table-wrap stacked">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Right answer</th>
            <th>It said</th>
            <th>Its reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Product">
                {r.product} <span className="small muted">{r.store}</span>
              </td>
              <td data-label="Right answer">
                <Chip verdict={r.expected} />
              </td>
              <td data-label="It said">
                <Chip verdict={r.got} />
              </td>
              <td data-label="Its reason" className="small">
                {reasonText(r.rule, r.onDefault, r.unsupportedCategory)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevRows({ rows, showGot, showWhy = true }: { rows: CaseRow[]; showGot?: boolean; showWhy?: boolean }) {
  return (
    <div className="table-wrap stacked">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            {showGot && <th>It said</th>}
            {showWhy && <th>Why that&apos;s the right answer</th>}
            <th>Its reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Product">
                {r.product} <span className="small muted">{r.store}</span>
              </td>
              {showGot && (
                <td data-label="It said">
                  <Chip verdict={r.got} />
                </td>
              )}
              {showWhy && <td data-label="Why that's the right answer">{sentences(r.why)}</td>}
              <td data-label="Its reason" className="small">
                {reasonText(r.rule, r.onDefault)}
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
  const bars = [
    { label: APP_NAME, value: r.skipCorrect, mine: true },
    { label: "Skip anything in a category you own", value: baselineScore(r, "same-category") },
    { label: "Skip everything", value: baselineScore(r, "always-skip") },
  ];
  return (
    <section className={s.section} data-testid="development-set" aria-labelledby="dev-title">
      <div className={s.devHead}>
        <div>
          <h2 id="dev-title" className={s.title}>
            The {r.n} products we built it on
          </h2>
          <p className={s.note}>We tuned the matching on these, so the new products above are the fairer test.</p>
        </div>
        <RerunEval n={r.n} />
      </div>
      <ul className={s.inkBars} aria-label={`Right out of ${r.n}`}>
        {bars.map((b) => (
          <li key={b.label} className={b.mine ? s.inkMine : undefined}>
            <span className={s.inkLabel}>{b.label}</span>
            <span className={s.inkTrack}>
              <span className={s.inkFill} style={{ width: `${(b.value / r.n) * 100}%` }} />
            </span>
            <span className={s.inkValue}>{b.value}</span>
          </li>
        ))}
      </ul>
      <div className="proof-rows">
        <Row summary={`Every case: ${plural(r.wrongSkips.length, "wrong skip", "wrong skips")}, ${plural(r.missedSkips.length, "missed skip", "missed skips")}, ${plural(r.catches.length, "right skip", "right skips")}`}>
          <h3 className={s.rowHead}>{plural(r.wrongSkips.length, "wrong skip", "wrong skips")}</h3>
          <DevRows rows={r.wrongSkips} />
          <h3 className={s.rowHead}>{plural(r.missedSkips.length, "missed skip", "missed skips")}</h3>
          <DevRows rows={r.missedSkips} showGot />
          <h3 className={s.rowHead}>{plural(r.catches.length, "right skip", "right skips")}</h3>
          <DevRows rows={r.catches} showWhy={false} />
        </Row>
      </div>
    </section>
  );
}

async function HowWeTested() {
  await connection();
  const film = await filmOn();
  const r = film ? neutralDeep(heldOutResult()) : heldOutResult();
  const dev = film ? neutralDeep(runSkipEval()) : runSkipEval();
  const o = r.order;
  const p = dev.provenance;
  const runs = devSetRuns(p);
  const last = r.afterChanges.at(-1);
  return (
    <section className={s.section} aria-labelledby="method-title">
      <h2 id="method-title" className={s.title}>
        How we tested
      </h2>
      <ol className={s.steps}>
        <li>
          <span className={s.stepNum}>1</span>
          <strong>App locked</strong>
          <span className={s.stepWhen}>{et(o.engine.at)}</span>
        </li>
        <li>
          <span className={s.stepNum}>2</span>
          <strong>Right answers written</strong>
          <span className={s.stepWhen}>{et(o.expectations.at)}</span>
        </li>
        <li>
          <span className={s.stepNum}>3</span>
          <strong>One scored run</strong>
          <span className={s.stepWhen}>{et(o.scoredRun.ranAt)}</span>
        </li>
      </ol>
      <p className={s.note}>
        Our own test set: real products, prices and store policies, with a sample shopper and shelf we wrote.
      </p>
      <div className="proof-rows">
        <Row summary="The order of work, with commits" testId="order-of-work">
          <ol className={s.list}>
            <li>App last changed: {et(o.engine.at)}.</li>
            <li>Right answers, shelf and prices committed: {et(o.expectations.at)}.</li>
            <li>
              The one scored run, at {et(o.scoredRun.ranAt)}: {r.skipCorrect} of {r.n}.
            </li>
          </ol>
          <p className="mono small commit-line">
            app {short(o.engine.commit)}, answers {short(o.expectations.commit)}, run {short(o.scoredRun.commit)}
          </p>
          <p className="small muted">We didn&apos;t change the app after seeing the result. {correctedCases(r.corrections)}</p>
        </Row>
        {last && (
          <Row summary={`Re-runs after later fixes: ${last.skipCorrect} of ${last.n}`}>
            {r.afterChanges.map((a) => (
              <p key={a.commit} data-testid="after-changes">
                <span className="mono small">{short(a.commit)}</span> ({et(a.at)}): {a.skipCorrect} of {a.n}. {sentences(a.what)} Missed: {[...a.wrongSkips, ...a.missedSkips].map((id) => r.cases.find((c) => c.id === id)?.product ?? id).join(", ") || "none"}.
              </p>
            ))}
            <p className="small muted">
              We made these fixes after seeing the misses, so the re-runs aren&apos;t a fresh test. The score stays {r.skipCorrect} of {r.n}.
            </p>
          </Row>
        )}
        <Corrections film={film} />
        <Row summary={`The ${dev.n} products we built it on: ${runs.length} runs`}>
          <ul className={s.list}>
            <li>
              Right answers committed {et(p.expectations.at)}. The app as of {et(p.engine.at)}. <span className="mono small">answers {short(p.expectations.commit)}, app {short(p.engine.commit)}</span>
            </li>
            {runs.map((run) => (
              <li key={run.commit}>
                {sentences(run.label)} (<span className="mono">{short(run.commit)}</span>
                {run.at ? `, ${et(run.at)}` : ""}): {run.result}.
              </li>
            ))}
            <li>
              Its {dev.skipsRight} right skips kept {formatDollars(dev.split.dollarsAvoided)} of repeat or hard-to-return buys unspent ({dev.split.onEvidence} on evidence, {dev.split.onDefault} on our unknown-policy default).
            </li>
          </ul>
        </Row>
        <Row summary="Run it yourself">
          <ul className={s.list}>
            <li>
              <span className="mono">npm run eval:skip</span> re-runs the {dev.n} products on your machine, with no network calls. The button above does the same on our server.
            </li>
            <li>
              Every case for both tests: <span className="mono">eval/holdout/RESULTS.md</span> and <span className="mono">eval/skip-set/RESULTS.md</span> in the repository.
            </li>
          </ul>
        </Row>
      </div>
    </section>
  );
}

/** Inputs found wrong after a run: what was wrong, the commits that fixed it (policy first, then the right answers), and the numbers before and after. */
function Corrections({ film }: { film: boolean }) {
  const held = film ? neutralDeep(heldOutResult()) : heldOutResult();
  const dev = film ? neutralDeep(devCorrections()) : devCorrections();
  if (!held.corrections.length && !dev.length) return null;
  return (
    <Row summary={`Corrections (${dev.length})`} testId="corrections">
      {dev.map((c) => {
        const h = held.corrections.find((x) => x.expectations.commit === c.expectations.commit);
        return (
          <div key={c.expectations.commit} className="stack-sm">
            <p>
              <strong>{et(c.policy.at).split(",").slice(0, 2).join(",")}: we had misread a store return policy.</strong> {sentences(c.what)}
            </p>
            <ul className={s.list}>
              <li>
                Policy fixed first: <span className="mono">{short(c.policy.commit)}</span>, {et(c.policy.at)}.
              </li>
              <li>
                Right answers fixed next, before any re-run: <span className="mono">{short(c.expectations.commit)}</span>, {et(c.expectations.at)}.
              </li>
              <li>
                Products we built it on: {c.before} before, {c.after} after.{c.afterNote ? ` ${sentences(c.afterNote)}` : ""}
              </li>
              {h && (
                <li>
                  Products it had never seen: the score stays {held.skipCorrect} of {held.n}. {sentences(h.scoredRunEffect)}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </Row>
  );
}

/** How many right answers for the new products were corrected, counted from the recorded corrections. */
function correctedCases(corrections: Array<{ expectations: { cases: string[] } }>): string {
  const n = new Set(corrections.flatMap((c) => c.expectations.cases)).size;
  if (!n) return "Nor did we change the right answers.";
  return `${n === 1 ? "One right answer's reason was" : `${n} right answers' reasons were`} later fixed for a store policy we had misread (see Corrections).`;
}
