import Link from "next/link";
import { ProductGlyph } from "../../components/ProductGlyph";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { BUDGET_LABELS, remainingBudgets } from "@/lib/app/budgets";
import { returnsLine } from "@/lib/app/explain";
import { formatCents, formatDollars } from "@/lib/app/money";
import { budgetGroupOf } from "@/lib/shelf/categories";
import { Eyebrow } from "../../components/Eyebrow";
import { Lotion } from "../../components/stage/MaterialStage";
import { CONSENT_TEMPLATE, SELLER_OF_RECORD, defaultCapCents } from "@/lib/app/payments";
import { displaySession } from "@/lib/filming/server";
import { CheckoutPanel } from "../../components/CheckoutPanel";
import { CheckoutPanelV6 } from "../../components/CheckoutPanelV6";
import { wantsSdkV6 } from "@/lib/paypal/sdk-v6";

export const metadata = { title: "Checkout" };

export default function CheckoutPage(props: PageProps<"/checkout/[id]">) {
  return (
    <main className="page">
      <Suspense fallback={<div className="skeleton" />}>
        <Checkout params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Checkout({ params, searchParams }: { params: PageProps<"/checkout/[id]">["params"]; searchParams: PageProps<"/checkout/[id]">["searchParams"] }) {
  const { id } = await params;
  const { state, raw, today, film } = await displaySession();
  // PayPal JS SDK v6 only at ?sdk=v6 (PAYPAL_SDK_V6=0 turns it off; never in filming mode). v5 is the default.
  const v6 = wantsSdkV6({ sdk: (await searchParams).sdk, env: process.env.PAYPAL_SDK_V6, film });
  const intent = state.intents.find((i) => i.id === id);
  if (!intent) notFound();
  if (intent.receiptId) redirect(`/receipts/${intent.receiptId}`);
  const replaced = intent.replacesMethodId ? state.methods.find((m) => m.id === intent.replacesMethodId) : undefined;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const amount = formatCents(intent.amountCents, intent.currency);
  // Context beside the payment: what's left in this budget, and the store's returns from the verdict.
  const group = intent.category ? budgetGroupOf(intent.category) : undefined;
  const left = group ? remainingBudgets(state.budgets, today)[group] : undefined;
  const fromCheck = intent.source.kind === "check" ? state.checks.find((c) => intent.source.kind === "check" && c.id === intent.source.checkId) : undefined;
  const returns = fromCheck && fromCheck.decision.verdict !== "ask" ? returnsLine(fromCheck.decision, fromCheck.store?.replace(/^https?:\/\//, "").replace(/^www\./, "")) : undefined;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>{replaced ? "Approve with another method" : "Checkout"}</h1>
        {replaced && <p className="lede">PayPal declined {replaced.label} for this reorder. Nothing was charged. Pick another card or PayPal account below.</p>}
      </div>
      <div className="object-layout">
      <div className="lead stack">
      <section className="panel" aria-label="Order and payment">
      <Lotion className="panel-material" eager sizes="(min-width: 960px) 40rem, 100vw" />
      <Eyebrow icon="card">Order and payment</Eyebrow>
      <div className="panel-frame">
      <div className="checkout-card">
      <div className="product-row">
        {intent.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={intent.imageUrl} alt="" />
        ) : (
          <span className="thumb empty">
            <ProductGlyph shape="bottle" letter={intent.brand} />
          </span>
        )}
        <div className="meta">
          <div className="brand-line">{intent.brand}</div>
          <div className="name-line">{intent.title.startsWith(`${intent.brand} `) ? intent.title.slice(intent.brand.length + 1) : intent.title}</div>
          <div className="small muted">Sold by {SELLER_OF_RECORD}.</div>
        </div>
        <div className="price-line">{amount}</div>
      </div>
      <div className="checkout-pay">
      {clientId ? (
        v6 ? (
          <CheckoutPanelV6 intentId={intent.id} clientId={clientId} amountLabel={amount} defaultCapDollars={defaultCapCents(intent.amountCents) / 100} consentTemplate={CONSENT_TEMPLATE} returnTo={raw.intents.find((i) => i.id === intent.id)?.returnTo} />
        ) : (
          <CheckoutPanel intentId={intent.id} clientId={clientId} amountLabel={amount} defaultCapDollars={defaultCapCents(intent.amountCents) / 100} consentTemplate={CONSENT_TEMPLATE} returnTo={raw.intents.find((i) => i.id === intent.id)?.returnTo} />
        )
      ) : (
        <p className="error">Payments are off: PAYPAL_CLIENT_ID is not set on the server.</p>
      )}
      </div>
      </div>
      </div>
      </section>
      <Link className="btn outline" href="/check" style={{ width: "fit-content" }}>
        Cancel
      </Link>
      </div>
      {group && left !== undefined && (
        <section className="context-frame" aria-label="Budget">
          <Eyebrow icon="card">{BUDGET_LABELS[group]} budget</Eyebrow>
          <p className="figure-line">{formatDollars(left)} left</p>
          <p className="small">This month, before this purchase.</p>
        </section>
      )}
      {returns && (
        <section className="context-frame" aria-label="Returns">
          <Eyebrow icon="receipt">Returns once opened</Eyebrow>
          <p className={`returns ${returns.tone}`}>{returns.text}</p>
        </section>
      )}
      </div>
    </div>
  );
}
