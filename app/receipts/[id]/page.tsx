import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BUDGET_LABELS, remainingBudgets } from "@/lib/app/budgets";
import { formatDay, formatTime, realToday } from "@/lib/app/dates";
import { formatCents, formatDollars } from "@/lib/app/money";
import { chargeKind, receiptStatusLabel, repeatsLine, SELLER_OF_RECORD } from "@/lib/app/payments";
import { shortId } from "@/lib/filming/neutral";
import { displaySession } from "@/lib/filming/server";
import { budgetGroupOf } from "@/lib/shelf/categories";
import { guardView } from "@/lib/app/guard";
import { ReceiptActions } from "../../components/ReceiptActions";
import { ReceiptGuard } from "../../components/WeekFlow";
import { Eyebrow } from "../../components/Eyebrow";
import { Lotion } from "../../components/stage/MaterialStage";

export const metadata = { title: "Receipt" };

export default function ReceiptPage(props: PageProps<"/receipts/[id]">) {
  return (
    <main className="page">
      <Suspense fallback={<div className="skeleton" />}>
        <ReceiptView params={props.params} />
      </Suspense>
    </main>
  );
}

async function ReceiptView({ params }: { params: PageProps<"/receipts/[id]">["params"] }) {
  const { id } = await params;
  const { state, today, film } = await displaySession({ shortIds: true });
  const r = state.receipts.find((x) => x.id === id);
  if (!r) notFound();
  const method = r.savedMethodId ? state.methods.find((m) => m.id === r.savedMethodId) : undefined;
  const simulatedOn = r.on !== realToday(new Date(r.createdAt)) ? r.on : undefined;
  const group = r.category ? budgetGroupOf(r.category) : undefined;
  const left = group ? remainingBudgets(state.budgets, today)[group] : undefined;
  const guard = guardView(r);
  return (
    <div className="object-layout">
      <section className="panel lead" aria-label="Receipt">
      <Lotion className="panel-material" eager />
      <Eyebrow icon="receipt">Receipt</Eyebrow>
      <div className="panel-frame">
      <article className="receipt">
        <div className="receipt-head">
          <div className="small receipt-status">
            {receiptStatusLabel(r)}, {formatTime(r.createdAt)} ET
          </div>
          <div className="total">{formatCents(r.amountCents, r.currency)}</div>
          <div className="receipt-title">{r.title}</div>
          <div className="small receipt-status">
            {chargeKind(r)}
            {simulatedOn ? (film ? `, counted on ${formatDay(simulatedOn)} (simulated)` : `, counted on the simulated date ${formatDay(simulatedOn)}`) : ""}
          </div>
        </div>
        <dl className="receipt-lines">
          <dt>Sold by</dt>
          <dd>{SELLER_OF_RECORD}</dd>
          <dt>Paid with</dt>
          <dd>{r.methodLabel}</dd>
          <dt>Approved</dt>
          <dd>{r.kind === "first-purchase" ? "In PayPal checkout" : "With your yes"}</dd>
          {r.refund && (
            <>
              <dt>Refund</dt>
              <dd>
                {film ? shortId(r.refund.id) : r.refund.id} ({r.refund.status}){r.refund.at ? `, ${formatTime(r.refund.at)} ET` : ""}
              </dd>
            </>
          )}
        </dl>
        <details className="ids receipt-ids">
          <summary>PayPal details</summary>
          <dl className="receipt-lines">
            <dt>PayPal order</dt>
            <dd>{r.orderId}</dd>
            <dt>Capture</dt>
            <dd>
              {r.captureId ?? "none"} ({r.captureStatus})
            </dd>
            <dt>Request ID</dt>
            <dd>{r.requestId}</dd>
            {r.kind !== "first-purchase" && (
              <>
                <dt>Charge type</dt>
                <dd>customer-initiated</dd>
              </>
            )}
            {r.webhook && (
              <>
                <dt>Webhook</dt>
                <dd>{r.webhook.type}</dd>
              </>
            )}
          </dl>
        </details>
        <div className="receipt-foot stack-sm">
          {r.status === "failed" ? (
            <p>
              <strong className="sticker failed">Not charged.</strong> PayPal didn&apos;t complete this payment.
            </p>
          ) : (
            <p>
              <strong className="sticker paid">Charged once.</strong> {r.attempts > 1 ? repeatsLine(r) : null}
            </p>
          )}
          {r.shelfNote && <p>{r.shelfNote}</p>}
          {r.kind === "first-purchase" && !method && <p className="muted">This method was not saved.</p>}
          <p className="muted small">{r.webhook ? `PayPal confirmed it at ${formatTime(r.webhook.at)} ET.` : "Waiting for PayPal's confirmation."}</p>
        </div>
      </article>
      </div>
      </section>
      {group && left !== undefined && (
        <section className="context-frame" aria-label="Budget">
          <Eyebrow icon="card">{BUDGET_LABELS[group]} budget</Eyebrow>
          <p className="figure-line">{formatDollars(left)} left</p>
          <p className="small">This month.</p>
        </section>
      )}
      {guard && (
        <section className="context-frame" aria-label="Price protection">
          <Eyebrow icon="shelf">Price protection</Eyebrow>
          <ReceiptGuard g={guard} />
        </section>
      )}
      {method && (
        <section className="context-frame" aria-label="Saved for reorders">
          <Eyebrow icon="yes">Saved for reorders</Eyebrow>
          <p className="figure-line">{formatCents(method.capCents, method.currency)} cap</p>
          <p className="small">
            {method.label}, charged only after your yes.
          </p>
        </section>
      )}
      <ReceiptActions receiptId={r.id} source={r.source} amountCents={r.amountCents} canRepeat={r.kind === "saved-method" && (r.status === "completed" || r.status === "pending")} canRefund={!!r.captureId && (r.status === "completed" || r.status === "partly-refunded") && r.refund?.status !== "PENDING"} />
    </div>
  );
}
