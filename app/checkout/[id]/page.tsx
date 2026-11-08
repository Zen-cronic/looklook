import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { formatCents } from "@/lib/app/money";
import { CONSENT_TEMPLATE, SELLER_OF_RECORD, defaultCapCents } from "@/lib/app/payments";
import { currentSession } from "@/lib/app/session";
import { CheckoutPanel } from "../../components/CheckoutPanel";

export const metadata = { title: "Checkout" };

export default function CheckoutPage(props: PageProps<"/checkout/[id]">) {
  return (
    <main className="page">
      <Suspense fallback={<div className="skeleton" />}>
        <Checkout params={props.params} />
      </Suspense>
    </main>
  );
}

async function Checkout({ params }: { params: PageProps<"/checkout/[id]">["params"] }) {
  const { id } = await params;
  const { state } = await currentSession();
  const intent = state.intents.find((i) => i.id === id);
  if (!intent) notFound();
  if (intent.receiptId) redirect(`/receipts/${intent.receiptId}`);
  const replaced = intent.replacesMethodId ? state.methods.find((m) => m.id === intent.replacesMethodId) : undefined;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const amount = formatCents(intent.amountCents, intent.currency);
  return (
    <div className="stack">
      <div>
        <h1>{replaced ? "Approve with another method" : "Pay with PayPal"}</h1>
        {replaced && <p className="lede">PayPal declined {replaced.label} for this rebuy. Nothing was charged. Pick another card or PayPal account below.</p>}
      </div>
      <div className="card product-row" style={{ padding: "0.9rem 1rem" }}>
        {intent.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={intent.imageUrl} alt="" />
        ) : (
          <span className="thumb empty" />
        )}
        <div className="meta">
          <div className="brand-line">{intent.brand}</div>
          <div className="name-line">{intent.title.startsWith(`${intent.brand} `) ? intent.title.slice(intent.brand.length + 1) : intent.title}</div>
          <div className="small muted">Sold by {SELLER_OF_RECORD}.</div>
        </div>
        <div className="price-line">{amount}</div>
      </div>
      {clientId ? (
        <CheckoutPanel intentId={intent.id} clientId={clientId} amountLabel={amount} defaultCapDollars={defaultCapCents(intent.amountCents) / 100} consentTemplate={CONSENT_TEMPLATE} />
      ) : (
        <p className="error">Payments are off: PAYPAL_CLIENT_ID is not set on the server.</p>
      )}
      <Link className="btn outline" href="/check">
        Cancel
      </Link>
    </div>
  );
}
