import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatDate, formatTime } from "@/lib/app/dates";
import { formatCents } from "@/lib/app/money";
import { SELLER_OF_RECORD } from "@/lib/app/payments";
import { currentSession } from "@/lib/app/session";
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
  const { state } = await currentSession();
  const r = state.receipts.find((x) => x.id === id);
  if (!r) notFound();
  const method = r.savedMethodId ? state.methods.find((m) => m.id === r.savedMethodId) : undefined;
  const sent = r.attempts === 1 ? "Sent to PayPal once." : `Sent to PayPal ${r.attempts} times with the same request ID; ${r.sameOrderEveryTime ? "PayPal answered with this one order every time, so you were charged once." : "PayPal answered with different orders. Check your activity."}`;
  return (
    <div className="stack">
      <article className="receipt">
        <div className="receipt-head">
          <div className="small" style={{ opacity: 0.8 }}>
            {r.status === "refunded" ? "Refunded" : r.captureStatus === "COMPLETED" ? "Paid" : `Payment ${r.captureStatus.toLowerCase()}`}, {formatDate(r.on)}
          </div>
          <div className="total">{formatCents(r.amountCents, r.currency)}</div>
          <div style={{ marginTop: "0.35rem", fontWeight: 700 }}>{r.title}</div>
        </div>
        <dl className="receipt-lines">
          <dt>Paid to</dt>
          <dd>{SELLER_OF_RECORD}</dd>
          <dt>Paid with</dt>
          <dd>{r.methodLabel}</dd>
          <dt>How</dt>
          <dd>{r.kind === "first-purchase" ? "Approved in PayPal checkout" : "Your yes on a saved method (customer-initiated)"}</dd>
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
                {r.refund.id} ({r.refund.status})
              </dd>
            </>
          )}
        </dl>
        <div className="receipt-foot stack-sm">
          <p>
            <strong>Charged once.</strong> {sent}
          </p>
          {r.shelfNote && <p>{r.shelfNote}</p>}
          {r.budgetNote && <p>{r.budgetNote}</p>}
          {method && (
            <p>
              Saved for rebuys: {method.label}, up to {formatCents(method.capCents, method.currency)} each, only after your yes.
            </p>
          )}
          {r.kind === "first-purchase" && !method && <p className="muted">This method was not saved.</p>}
          <p className="muted small">{r.webhook ? `PayPal confirmed it by webhook (${r.webhook.type}) at ${formatTime(r.webhook.at)} ET.` : "PayPal's webhook for this payment hasn't arrived here yet."}</p>
        </div>
      </article>
      <ReceiptActions receiptId={r.id} source={r.source} canRepeat={r.kind === "saved-method" && r.status !== "refunded"} canRefund={!!r.captureId && r.status === "completed"} />
    </div>
  );
}
