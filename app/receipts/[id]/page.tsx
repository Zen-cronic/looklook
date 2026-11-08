import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BUDGET_LABELS, remainingBudgets } from "@/lib/app/budgets";
import { formatDay, formatTime, realToday } from "@/lib/app/dates";
import { formatCents, formatDollars } from "@/lib/app/money";
import { chargeKind, receiptStatusLabel, repeatsLine, SELLER_OF_RECORD } from "@/lib/app/payments";
import { currentSession } from "@/lib/app/session";
import { budgetGroupOf } from "@/lib/shelf/categories";
import { ReceiptActions } from "../../components/ReceiptActions";

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
  const { state, today } = await currentSession();
  const r = state.receipts.find((x) => x.id === id);
  if (!r) notFound();
  const method = r.savedMethodId ? state.methods.find((m) => m.id === r.savedMethodId) : undefined;
  const simulatedOn = r.on !== realToday(new Date(r.createdAt)) ? r.on : undefined;
  const group = r.category ? budgetGroupOf(r.category) : undefined;
  const left = group ? remainingBudgets(state.budgets, today)[group] : undefined;
  return (
    <div className="stack">
      <article className="receipt">
        <div className="receipt-head">
          <div className="small" style={{ opacity: 0.85 }}>
            {receiptStatusLabel(r)}, {formatTime(r.createdAt)} ET
          </div>
          <div className="total">{formatCents(r.amountCents, r.currency)}</div>
          <div style={{ marginTop: "0.35rem", fontWeight: 700 }}>{r.title}</div>
          <div className="small" style={{ opacity: 0.85, marginTop: "0.2rem" }}>
            {chargeKind(r)}
            {simulatedOn ? `, counted on the simulated date ${formatDay(simulatedOn)}` : ""}
          </div>
        </div>
        <dl className="receipt-lines">
          <dt>Sold by</dt>
          <dd>{SELLER_OF_RECORD}</dd>
          <dt>Paid with</dt>
          <dd>{r.methodLabel}</dd>
          <dt>How</dt>
          <dd>{r.kind === "first-purchase" ? "You approved it in PayPal checkout" : "Your yes on a saved method (customer-initiated)"}</dd>
          <dt>PayPal order</dt>
          <dd>{r.orderId}</dd>
          <dt>Capture</dt>
          <dd>
            {r.captureId ?? "none"} ({r.captureStatus})
          </dd>
          <dt>Request ID</dt>
          <dd>{r.requestId}</dd>
          <dt>Time</dt>
          <dd>{formatTime(r.createdAt)} ET</dd>
          {r.refund && (
            <>
              <dt>Refund</dt>
              <dd>
                {r.refund.id} ({r.refund.status}){r.refund.at ? `, ${formatTime(r.refund.at)} ET` : ""}
              </dd>
            </>
          )}
        </dl>
        <div className="receipt-foot stack-sm">
          {r.status === "failed" ? (
            <p>
              <strong>Not charged.</strong> PayPal didn&apos;t complete this payment.
            </p>
          ) : (
            <p>
              <strong>Charged once.</strong> {repeatsLine(r)}
            </p>
          )}
          {r.shelfNote && <p>{r.shelfNote}</p>}
          {group && left !== undefined && (
            <p>
              {formatDollars(left)} left in {BUDGET_LABELS[group].toLowerCase()} this month.
            </p>
          )}
          {method && (
            <p>
              Saved for rebuys: {method.label}, up to {formatCents(method.capCents, method.currency)} each, only after your yes.
            </p>
          )}
          {r.kind === "first-purchase" && !method && <p className="muted">This method was not saved.</p>}
          <p className="muted small">{r.webhook ? `PayPal confirmed it by webhook (${r.webhook.type}) at ${formatTime(r.webhook.at)} ET.` : "PayPal's webhook for this payment hasn't arrived here yet."}</p>
        </div>
      </article>
      <ReceiptActions receiptId={r.id} source={r.source} amountCents={r.amountCents} canRepeat={r.kind === "saved-method" && (r.status === "completed" || r.status === "pending")} canRefund={!!r.captureId && (r.status === "completed" || r.status === "partly-refunded") && r.refund?.status !== "PENDING"} />
    </div>
  );
}
