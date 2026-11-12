import { Suspense } from "react";
import { formatTime } from "@/lib/app/dates";
import { formatCents } from "@/lib/app/money";
import { displaySession } from "@/lib/filming/server";
import { MethodControls, RetryRemoval } from "../components/MethodControls";
import { Eyebrow } from "../components/Eyebrow";
import { Lotion } from "../components/stage/MaterialStage";

export const metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <main className="page">
      <div className="page-head">
        <h1>Payments</h1>
        <p className="lede">Cards and PayPal accounts saved for your reorders.</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Methods />
      </Suspense>
    </main>
  );
}

async function Methods() {
  const { state } = await displaySession({ shortIds: true });
  const methods = [...state.methods].reverse();
  if (!methods.length) {
    return (
      <div className="object-layout">
        <div className="empty-frame lead">
          <Eyebrow icon="card">Nothing saved yet</Eyebrow>
          <p className="small muted">The first time you pay with PayPal or a card, you can save it for reorders you approve, with a cap per reorder.</p>
        </div>
      </div>
    );
  }
  // The newest active method's agreement sits beside the list; older ones keep theirs behind a disclosure.
  const primary = methods.find((m) => m.status === "active");
  return (
    <div className="object-layout">
      <section className="panel lead stack" aria-label="Saved methods">
        <Lotion className="panel-material" eager sizes="(min-width: 960px) 40rem, 100vw" />
        <Eyebrow icon="card">Saved for reorders</Eyebrow>
        {methods.map((m) => (
          <div key={m.id} className="panel-frame">
            <article className="method-card stack-sm" style={{ opacity: m.status === "removed" ? 0.6 : 1 }}>
              <div className="method-top">
                <h2>{m.label}</h2>
                <Eyebrow as="span" icon={m.status === "removed" ? "card" : m.declinedAt ? "alert" : "check"} className={m.declinedAt && m.status !== "removed" ? "eyebrow-alert" : undefined}>
                  {m.status === "removed" ? "Removed" : m.declinedAt ? "Declined last time" : "Active"}
                </Eyebrow>
              </div>
              <p className="small muted">
                {m.status === "removed"
                  ? `Removed ${formatTime(m.removedAt!)} ET. ${m.revokeConfirmed ? "PayPal deleted it." : "Waiting for PayPal to confirm the delete."}`
                  : `Saved ${formatTime(m.consentedAt)} ET.`}
              </p>
              {m.status !== "removed" && (
                <dl className="method-cap">
                  <dt>Cap per reorder</dt>
                  <dd className="price-line">{formatCents(m.capCents, m.currency)}</dd>
                </dl>
              )}
              {m !== primary && (
                <details className="why" style={{ margin: 0 }}>
                  <summary>What you agreed to</summary>
                  <p style={{ paddingBottom: "0.85rem" }}>{m.consentText}</p>
                </details>
              )}
              {m.status === "active" && <MethodControls id={m.id} label={m.label} capDollars={m.capCents / 100} />}
              {m.status === "removed" && !m.revokeConfirmed && <RetryRemoval id={m.id} />}
              <details className="ids">
                <summary>PayPal details</summary>
                <dl className="receipt-lines">
                  <dt>Payment token</dt>
                  <dd>{m.vaultId}</dd>
                  <dt>First order</dt>
                  <dd>{m.firstOrderId}</dd>
                </dl>
              </details>
            </article>
          </div>
        ))}
      </section>
      {primary && (
        <section className="context-frame" aria-label="What you agreed to">
          <Eyebrow icon="yes">What you agreed to</Eyebrow>
          <p>{primary.consentText}</p>
        </section>
      )}
    </div>
  );
}
