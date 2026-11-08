import { Suspense } from "react";
import { formatTime } from "@/lib/app/dates";
import { formatCents } from "@/lib/app/money";
import { currentSession } from "@/lib/app/session";
import { MethodControls, RetryRemoval } from "../components/MethodControls";

export const metadata = { title: "Saved methods" };

export default function PaymentsPage() {
  return (
    <main className="page">
      <div style={{ marginBottom: "1.5rem" }}>
        <h1>Saved methods</h1>
        <p className="lede">Payment methods PayPal keeps for your rebuys, and what you agreed to when you saved them.</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Methods />
      </Suspense>
    </main>
  );
}

async function Methods() {
  const { state } = await currentSession();
  const methods = [...state.methods].reverse();
  if (!methods.length) {
    return (
      <div className="card stack-sm">
        <h2>Nothing saved</h2>
        <p className="muted">The first time you pay with PayPal or a card, you can save it for rebuys you approve, with a cap per rebuy.</p>
      </div>
    );
  }
  return (
    <ul className="list">
      {methods.map((m) => (
        <li key={m.id} className="stack-sm" style={{ opacity: m.status === "removed" ? 0.6 : 1 }}>
          <div className="split">
            <div>
              <h2>{m.label}</h2>
              <p className="small muted">
                Saved {formatTime(m.consentedAt)} ET. {m.status === "removed" ? `Removed ${formatTime(m.removedAt!)} ET; no rebuy can use it. ${m.revokeConfirmed ? "PayPal confirmed it no longer has it." : "Removal pending at PayPal: the delete isn't confirmed yet."}` : `Up to ${formatCents(m.capCents, m.currency)} per rebuy.`}
              </p>
            </div>
            <span className={`chip ${m.status === "removed" ? "" : m.declinedAt ? "skip" : "buy"}`}>{m.status === "removed" ? "Removed" : m.declinedAt ? "Declined last time" : "Active"}</span>
          </div>
          <details className="why" style={{ margin: 0 }}>
            <summary>What you agreed to</summary>
            <div className="stack-sm" style={{ paddingBottom: "0.85rem" }}>
              <p>{m.consentText}</p>
              <details className="ids">
                <summary>Details</summary>
                <dl className="receipt-lines" style={{ padding: 0 }}>
                  <dt>PayPal token</dt>
                  <dd>{m.vaultId}</dd>
                  {m.customerId && (
                    <>
                      <dt>PayPal customer</dt>
                      <dd>{m.customerId}</dd>
                    </>
                  )}
                  <dt>First order</dt>
                  <dd>{m.firstOrderId}</dd>
                </dl>
              </details>
            </div>
          </details>
          {m.status === "active" && <MethodControls id={m.id} label={m.label} capDollars={m.capCents / 100} />}
          {m.status === "removed" && !m.revokeConfirmed && <RetryRemoval id={m.id} />}
        </li>
      ))}
    </ul>
  );
}
