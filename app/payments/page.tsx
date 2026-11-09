import { Suspense } from "react";
import { formatTime } from "@/lib/app/dates";
import { formatCents } from "@/lib/app/money";
import { currentSession } from "@/lib/app/session";
import { MethodControls, RetryRemoval } from "../components/MethodControls";
import { Eyebrow } from "../components/Eyebrow";
import { Lotion } from "../components/stage/MaterialStage";

export const metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <main className="page">
      <div className="page-head">
        <h1>Payments</h1>
        <p className="lede">Cards and PayPal accounts saved for your rebuys.</p>
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
      <div className="object-layout">
        <div className="empty-frame lead">
          <Eyebrow icon="card">Nothing saved yet</Eyebrow>
          <p className="small muted">The first time you pay with PayPal or a card, you can save it for rebuys you approve, with a cap per rebuy.</p>
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
        <Eyebrow icon="card">Saved for rebuys</Eyebrow>
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
                Saved {formatTime(m.consentedAt)} ET.{m.status === "removed" ? ` Removed ${formatTime(m.removedAt!)} ET; no rebuy can use it. ${m.revokeConfirmed ? "PayPal confirmed it no longer has it." : "Removal pending at PayPal: the delete isn't confirmed yet."}` : ""}
              </p>
              {m.status !== "removed" && (
                <dl className="method-cap">
                  <dt>Cap per rebuy</dt>
                  <dd className="price-line">{formatCents(m.capCents, m.currency)}</dd>
                </dl>
              )}
              {m !== primary && (
                <details className="why" style={{ margin: 0 }}>
                  <summary>What you agreed to</summary>
                  <div className="stack-sm" style={{ paddingBottom: "0.85rem" }}>
                    <p>{m.consentText}</p>
                    <p className="small muted mono">
                      PayPal token: {m.vaultId}. First order: {m.firstOrderId}.
                    </p>
                  </div>
                </details>
              )}
              {m.status === "active" && <MethodControls id={m.id} label={m.label} capDollars={m.capCents / 100} />}
              {m.status === "removed" && !m.revokeConfirmed && <RetryRemoval id={m.id} />}
            </article>
          </div>
        ))}
      </section>
      {primary && (
        <section className="context-frame" aria-label="What you agreed to">
          <Eyebrow icon="yes">What you agreed to</Eyebrow>
          <p>{primary.consentText}</p>
          <p className="small muted mono">
            PayPal token: {primary.vaultId}. First order: {primary.firstOrderId}.
          </p>
        </section>
      )}
    </div>
  );
}
