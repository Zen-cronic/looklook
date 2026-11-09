import Link from "next/link";
import { Suspense } from "react";
import { DEV_SET_SIZE } from "@/lib/app/eval";
import { heldOutHeadline, heldOutResult } from "@/lib/app/holdout";
import { REBUY_LEAD_DAYS } from "@/lib/app/payments";
import { numberWord, startHereSteps } from "@/lib/app/start-here";
import { currentSession } from "@/lib/app/session";
import { APP_NAME } from "@/lib/brand";
import { Eyebrow, type EyebrowIcon } from "../components/Eyebrow";
import { SampleWeekControls } from "../components/SampleWeek";
import { Lotion } from "../components/stage/MaterialStage";

/** One small drawn icon per step, in order: a post, a price chart, a card, a yes, the workspace, the checks. */
const STEP_ICONS: EyebrowIcon[] = ["post", "chart", "card", "yes", "check", "receipt"];

export const metadata = { title: "Start here" };

export default function JudgePage() {
  const heldOut = heldOutResult();
  const steps = startHereSteps({ heldOutRight: heldOut.skipCorrect, heldOutN: heldOut.n, devN: DEV_SET_SIZE, rebuyLeadDays: REBUY_LEAD_DAYS });
  const stepsWord = numberWord(steps.length).replace(/^./, (c) => c.toUpperCase());
  return (
    <main className="page">
      <div className="page-head">
        <h1>Start here</h1>
        <p className="lede">
          {APP_NAME} looks at a product you saw online and says skip, wait or buy, using what you already own, your budget, the price history and the store&apos;s return policy. {stepsWord} steps, about five minutes. Your browser gets its own sample shelf.
        </p>
        <p className="small" style={{ marginTop: "0.75rem" }} data-testid="sandbox-login">
          <strong>Sandbox login and test card:</strong> see the testing instructions on the submission page. No real money moves.
        </p>
      </div>

      <div className="object-layout">
      <section className="card signature stack-sm" data-testid="headline">
        <Eyebrow as="h2" icon="chart">
          How often skip is right
        </Eyebrow>
        <p className="headline-text">{heldOutHeadline(heldOut)}</p>
        <div className="actions">
          <Link className="btn small outline" href="/proof">
            See every case
          </Link>
        </div>
      </section>

      <div className="panel lead">
      <ol className="steps" data-testid="start-here-steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <div className="stack-sm">
              <Eyebrow icon={STEP_ICONS[i % STEP_ICONS.length]}>Step {i + 1}</Eyebrow>
              <div className="step-head">
                <h2>{step.title}</h2>
                {step.links.length > 0 && (
                  <div className="actions">
                    {step.links.map((l) => (
                      <Link key={`${i}-${l.href}`} className={l.outline ? "btn small outline" : "btn small"} href={l.href}>
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <p>{step.body}</p>
              {step.sampleWeek && (
                <Suspense fallback={<SampleWeekControls loaded={false} />}>
                  <SampleState />
                </Suspense>
              )}
              {step.more && (
                <details className="disclosure step-more">
                  <summary>More</summary>
                  <p>{step.more}</p>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Lotion className="panel-material" sizes="(min-width: 720px) 42rem, 100vw" />
      </div>

      <p className="small" data-testid="share-from-phone">
        <strong>From a phone:</strong> share a store link or a screenshot straight to {APP_NAME} with the &ldquo;Look twice&rdquo; Shortcut (iPhone) or the share sheet (Android).{" "}
        <a href="https://github.com/Zen-cronic/looklook/blob/main/docs/share-shortcut.md">How to set it up</a> (tested on desktop; phone test after deploy).
      </p>

      <details className="card disclosure">
        <summary>What&apos;s real and what&apos;s a test</summary>
        <ul style={{ margin: "0.85rem 0 0 1.1rem" }} className="stack-sm">
          <li>Real: products, prices and 90-day price history (Channel3), the screenshot reading (Claude), and store return policies, each with its source page.</li>
          <li>Sandbox: every PayPal payment. No real money moves.</li>
          <li>Simulated, and labelled where shown: the Rebuys date control, the test price drop, the forced decline and the sample week (a made-up shopper; the products, stores and prices are real).</li>
        </ul>
      </details>
      </div>
    </main>
  );
}

async function SampleState() {
  const { state } = await currentSession();
  return <SampleWeekControls loaded={state.sample?.kind === "week"} />;
}
