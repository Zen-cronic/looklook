import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { ResetButton } from "../components/RebuyControls";

export const metadata = { title: "Start here" };

export default function JudgePage() {
  return (
    <main className="page stack-lg">
      <div>
        <h1>Start here</h1>
        <p className="lede">{APP_NAME}, {APP_TAGLINE}. Six short steps through it, about five minutes on a phone or a laptop. Each browser gets its own sample shelf.</p>
      </div>

      <ol className="steps">
        <li>
          <div className="stack-sm">
            <h2>Check a post</h2>
            <p>On Check, tap the sunscreen post. You already own two sunscreens and CVS may refuse opened sunscreen, so the answer is skip. Open See why for the rule, the shelf item and the cited policy.</p>
            <Link className="btn small" href="/">
              Open Check
            </Link>
          </div>
        </li>
        <li>
          <div className="stack-sm">
            <h2>Buy once and save PayPal for rebuys</h2>
            <p>Tap the peptide serum post (buy). Tick Save this payment method, keep the cap, and pay with PayPal or the card fields. Use the sandbox buyer login or test card from the testing instructions on the project&apos;s submission page.</p>
          </div>
        </li>
        <li>
          <div className="stack-sm">
            <h2>Rebuy with one yes</h2>
            <p>On Rebuys, tap Move a week ahead. Staples due in five days ask for your yes. Tap Yes: a customer-initiated charge on the saved method, with the PayPal order and capture IDs on the receipt. Tap Send the same yes again to see one order, charged once.</p>
            <Link className="btn small" href="/rebuys">
              Open Rebuys
            </Link>
          </div>
        </li>
        <li>
          <div className="stack-sm">
            <h2>Watch a decline and recover</h2>
            <p>Tick Make the next rebuy decline, then tap Yes on another staple. PayPal answers INSTRUMENT_DECLINED, nothing is charged, and the card asks you to approve another card or PayPal account.</p>
          </div>
        </li>
        <li>
          <div className="stack-sm">
            <h2>Wait for a lower price</h2>
            <p>Check the retinol post (wait) and tap Watch for a drop: Channel3 sets a real price alert. On Rebuys, Send a test price drop runs a price event through the same handler, and the item asks for your yes.</p>
          </div>
        </li>
        <li>
          <div className="stack-sm">
            <h2>See the events and the number</h2>
            <p>Webhook events lists what PayPal and Channel3 sent and whether each one verified. How often skip is right re-runs the 65-case test on the server.</p>
            <div className="actions">
              <Link className="btn small" href="/events">
                Webhook events
              </Link>
              <Link className="btn small outline" href="/proof">
                How often skip is right
              </Link>
            </div>
          </div>
        </li>
      </ol>

      <section className="card stack-sm">
        <h2>Real and sandbox</h2>
        <ul style={{ marginLeft: "1.1rem" }} className="stack-sm">
          <li>Real: the product catalogue, prices and 90-day price history (Channel3), the screenshot reading (Claude), and the store return policies, each with its source page.</li>
          <li>Sandbox: every PayPal payment. Money goes to a PayPal sandbox test store; no real money moves.</li>
          <li>Simulated, and labelled where it appears: the date control on Rebuys, the test price drop, and the forced decline.</li>
        </ul>
      </section>

      <section className="stack-sm">
        <h2>Start over</h2>
        <p className="muted">Puts the sample shelf back and clears this browser&apos;s checks, saved methods and receipts. Saved methods stay at PayPal until you remove them first.</p>
        <ResetButton />
      </section>
    </main>
  );
}
