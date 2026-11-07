import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BUDGET_LABELS } from "@/lib/app/budgets";
import { formatDate } from "@/lib/app/dates";
import { RULE_ORDER, RULE_TEXT, relationText, returnsLine } from "@/lib/app/explain";
import { formatDollars, toCentsSafe } from "@/lib/app/money";
import { activeMethod } from "@/lib/app/payments";
import { currentSession } from "@/lib/app/session";
import { VerdictActions } from "../../components/VerdictActions";
import { VERDICT_WORD } from "../../components/VerdictChip";

export default function CheckResultPage(props: PageProps<"/check/[id]">) {
  return (
    <main className="page">
      <Suspense fallback={<div className="skeleton" />}>
        <Result params={props.params} />
      </Suspense>
    </main>
  );
}

function storeLabel(store: string | undefined): string | undefined {
  if (!store) return undefined;
  return store.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

async function Result({ params }: { params: PageProps<"/check/[id]">["params"] }) {
  const { id } = await params;
  const { state } = await currentSession();
  const check = state.checks.find((c) => c.id === id);
  if (!check) notFound();
  const d = check.decision;
  const e = d.evidence;
  const price = check.facts.priceShown;
  const returns = returnsLine(d, storeLabel(check.store));
  const method = activeMethod(state);
  const watch = check.watchId ? state.watch.find((w) => w.id === check.watchId && !w.closedAt) : undefined;
  const ruleIndex = RULE_ORDER.indexOf(d.rule) + 1;
  const product = check.product;
  const offerUrl = product?.offerUrl;

  return (
    <div className="stack">
      <Link href="/" className="btn outline small" style={{ width: "fit-content" }}>
        Check another
      </Link>
      <article className={`verdict ${d.verdict}`}>
        <div className="verdict-head">
          <div className="verdict-word">{VERDICT_WORD[d.verdict]}</div>
          <p className="verdict-reason">{check.reason.text}</p>
        </div>
        <div className="product-row">
          {product?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="thumb" src={product.imageUrl} alt="" />
          ) : (
            <span className="thumb empty" />
          )}
          <div className="meta">
            <div className="brand-line">{check.facts.brand || "Brand not shown"}</div>
            <div className="name-line">{check.facts.name || "Product not readable"}</div>
            {check.store && <div className="small muted">at {storeLabel(check.store)}</div>}
          </div>
          {price !== null && <div className="price-line">{formatDollars(price)}</div>}
        </div>
        {returns && d.verdict !== "ask" && <p className={`returns ${returns.tone}`}>{returns.text}</p>}
        <details className="why">
          <summary>See why</summary>
          <dl className="evidence">
            <dt>Rule</dt>
            <dd>
              {RULE_TEXT[d.rule]} <span className="muted small">(rule {ruleIndex} of 12)</span>
            </dd>
            {e.shelf && (
              <>
                <dt>On your shelf</dt>
                <dd>
                  {e.shelf.brand} {e.shelf.name}: {relationText(e.shelf.relation)}
                  {e.shelf.relation !== "same-product" && <> (match {Math.round(e.shelf.score * 100)}%)</>}
                  {e.shelf.matched.length > 0 && <>, same {e.shelf.matched.join(", ")}</>}. {e.shelf.opened ? "Opened" : "Unopened"}
                  {e.shelf.runOutDate ? `, runs out ${formatDate(e.shelf.runOutDate)}` : ""}.
                </dd>
              </>
            )}
            {e.replaces && (
              <>
                <dt>Replaces</dt>
                <dd>
                  {e.replaces.brand} {e.replaces.name}, runs out in {e.replaces.daysLeft} days.
                </dd>
              </>
            )}
            {e.policy && (
              <>
                <dt>Returns</dt>
                <dd>
                  {e.policy.fallback ? `${storeLabel(check.store) ?? "This store"} isn't in our policy table.` : `${e.policy.retailerName}: opened ${e.policy.group} returns ${e.policy.returnableOpened === "yes" ? "accepted" : e.policy.returnableOpened === "no" ? "may be refused" : e.policy.returnableOpened === "conditional" ? "only on conditions" : "not stated"}${e.policy.windowDays ? `, ${e.policy.windowDays} days` : ""}.`}{" "}
                  {e.policy.sourceUrl && (
                    <>
                      <a href={e.policy.sourceUrl} target="_blank" rel="noreferrer">
                        Policy page
                      </a>
                      , checked {formatDate(e.policy.checkedOn)}.
                    </>
                  )}
                </dd>
              </>
            )}
            {e.price && (
              <>
                <dt>Price</dt>
                <dd>
                  {e.price.usable && e.price.typical !== undefined
                    ? `${formatDollars(e.price.shown)} now. Usually ${formatDollars(e.price.typical)}, lowest ${formatDollars(e.price.low!)} in the last 90 days; good price is ${formatDollars(e.price.target!)} or less.`
                    : `${formatDollars(e.price.shown)} now. Not enough clean price history to judge.`}
                </dd>
              </>
            )}
            {e.budget && (
              <>
                <dt>Budget</dt>
                <dd>
                  {formatDollars(e.budget.remaining)} left in {BUDGET_LABELS[e.budget.group].toLowerCase()} this month.
                </dd>
              </>
            )}
            {e.waitUntil && (
              <>
                <dt>Look again</dt>
                <dd>{formatDate(e.waitUntil)}</dd>
              </>
            )}
            <dt>Read from</dt>
            <dd>
              {check.input.kind === "link" ? "The store link" : "Your screenshot"}: {[check.fields.brand, check.fields.productName, check.fields.variant, check.fields.price ? formatDollars(check.fields.price.amount) : null, check.fields.store].filter(Boolean).join(", ") || "nothing legible"}.
            </dd>
            {product && (
              <>
                <dt>Matched to</dt>
                <dd>
                  {product.brand} {product.title}
                  {check.candidates[0] && !check.facts.identityConfirmed ? ` (${Math.round(check.candidates[0].confidence * 100)}% sure)` : check.facts.identityConfirmed ? " (you confirmed it)" : ""}
                </dd>
              </>
            )}
          </dl>
        </details>
        {offerUrl && (
          <div style={{ padding: "0 1.2rem" }} className="stack-sm">
            <a className="btn outline small" href={offerUrl} target="_blank" rel="noreferrer sponsored" style={{ width: "fit-content" }}>
              View at {product?.offerDomain}
            </a>
            <p className="commission">We may earn a commission when you buy through links on this page.</p>
          </div>
        )}
        <VerdictActions
          checkId={check.id}
          verdict={d.verdict}
          rule={d.rule}
          price={price}
          priceLabel={price !== null ? formatDollars(price) : null}
          savedMethod={method ? { id: method.id, label: method.label, capLabel: formatDollars(method.capCents / 100), withinCap: price !== null && toCentsSafe(price) <= method.capCents } : null}
          watch={watch ? { target: formatDollars(watch.targetPrice) } : null}
          targetLabel={e.price?.target && price !== null && e.price.target < price ? formatDollars(e.price.target) : price !== null ? formatDollars(Math.round(price * 90) / 100) : null}
          shelfItemId={e.shelf?.itemId ?? null}
          purchasedReceiptId={check.purchasedReceiptId ?? null}
          candidates={check.candidates}
          needsConfirmation={check.needsConfirmation}
        />
      </article>
    </div>
  );
}
