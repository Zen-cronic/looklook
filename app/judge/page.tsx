import Link from "next/link";
import { Suspense } from "react";
import { DEV_SET_SIZE } from "@/lib/app/eval";
import { heldOutHeadline, heldOutResult } from "@/lib/app/holdout";
import { REBUY_LEAD_DAYS } from "@/lib/app/payments";
import { numberWord, startHereSteps } from "@/lib/app/start-here";
import { currentSession } from "@/lib/app/session";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { ResetButton } from "../components/RebuyControls";
import { SampleWeekControls } from "../components/SampleWeek";

export const metadata = { title: "Start here" };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function JudgePage() {
  const heldOut = heldOutResult();
  const steps = startHereSteps({ heldOutRight: heldOut.skipCorrect, heldOutN: heldOut.n, devN: DEV_SET_SIZE, rebuyLeadDays: REBUY_LEAD_DAYS });
  const stepsWord = numberWord(steps.length).replace(/^./, (c) => c.toUpperCase());
  return (
    <main className="page stack-lg">
      <div>
        <h1>Start here</h1>
        <p className="lede">
          {APP_NAME}, {APP_TAGLINE}. {stepsWord} short steps through it, about five minutes on a phone or a laptop. Each browser gets its own sample shelf.
        </p>
        <p style={{ marginTop: "0.75rem" }}>PayPal&apos;s shopping tools help you buy what you saw. {APP_NAME} asks whether you should, and when it&apos;s a staple, PayPal Vault makes buying it again one yes.</p>
        <p className="small" style={{ marginTop: "0.75rem" }} data-testid="sandbox-login">
          <strong>Sandbox login and test card:</strong> see the testing instructions on the submission page. Every payment is in the PayPal sandbox; no real money moves.
        </p>
      </div>

      <section className="card stack-sm" data-testid="headline">
        <h2>The number</h2>
        <p>{heldOutHeadline(heldOut)}</p>
        <p className="small muted">
          Precision {pct(heldOut.precision)}, recall {pct(heldOut.recall)}. {heldOut.split.onEvidence} of the {heldOut.skipsRight} right skips rest on evidence; {heldOut.split.onDefault} on our default for a store whose opened-return policy we couldn&apos;t find. Expected answers committed in{" "}
          <span className="mono">{heldOut.order.expectations.commit.slice(0, 7)}</span> after the engine&apos;s last change (<span className="mono">{heldOut.order.engine.commit.slice(0, 7)}</span>), then scored once (<span className="mono">{heldOut.order.scoredRun.commit.slice(0, 7)}</span>).
        </p>
        <div className="actions">
          <Link className="btn small outline" href="/proof">
            Every case and every miss
          </Link>
        </div>
      </section>

      <ol className="steps" data-testid="start-here-steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <div className="stack-sm">
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {step.sampleWeek && (
                <Suspense fallback={<SampleWeekControls loaded={false} />}>
                  <SampleState />
                </Suspense>
              )}
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
          </li>
        ))}
      </ol>

      <section className="card stack-sm">
        <h2>Real and sandbox</h2>
        <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>Real: the product catalogue, prices and 90-day price history (Channel3), the screenshot reading (Claude), and the store return policies, each with its source page.</li>
          <li>Sandbox: every PayPal payment. Money goes to a PayPal sandbox test store; no real money moves.</li>
          <li>Simulated, and labelled where it appears: the date control on Rebuys, the test price drop, the forced decline, and the sample week (a fictional shopper; the products, stores and prices are real catalogue listings).</li>
        </ul>
      </section>

      <section className="stack-sm">
        <h2>Start over</h2>
        <p className="muted">Puts the sample shelf back and clears this browser&apos;s checks and receipts. Saved payment methods are deleted at PayPal first, and each delete is confirmed.</p>
        <ResetButton />
      </section>
    </main>
  );
}

async function SampleState() {
  const { state } = await currentSession();
  return <SampleWeekControls loaded={state.sample?.kind === "week"} />;
}
