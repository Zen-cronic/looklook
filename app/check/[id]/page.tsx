import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BUDGET_LABELS } from "@/lib/app/budgets";
import { formatDate, formatDay, formatTime } from "@/lib/app/dates";
import { RULE_TEXT, relationText, returnsLine } from "@/lib/app/explain";
import { formatDollars, toCentsSafe } from "@/lib/app/money";
import { offerLines } from "@/lib/app/offers";
import { activeMethod, SELLER_OF_RECORD } from "@/lib/app/payments";
import { waitAction } from "@/lib/app/reminders";
import { cachedOffers } from "@/lib/app/services";
import { currentSession } from "@/lib/app/session";
import type { CheckRecord, StoreOffer } from "@/lib/app/types";
import { attributeWord, shelfLink } from "@/lib/app/shelf-link";
import { targetFor } from "@/lib/app/watch";
import { isSampleWeekCheck } from "@/lib/app/sample-week";
import { atTheTime, boughtReceipt, countedDate, eventTime, SIMULATED } from "@/lib/app/when";
import { PriceHistory } from "../../components/PriceHistory";
import { SampleWeekNote } from "../../components/SampleWeek";
import { SimDate } from "../../components/SimDate";
import { VerdictActions } from "../../components/VerdictActions";
import { VerdictSummary } from "../../components/VerdictSummary";
import { Frames, MaterialStage, ShelfLink } from "../../components/stage/MaterialStage";

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

async function offersFor(check: CheckRecord): Promise<StoreOffer[]> {
  if (check.offers?.length) return check.offers;
  const live = check.product ? await cachedOffers(check.product.id) : [];
  if (live.length) return live;
  const p = check.product;
  return p?.offerDomain && p.offerPrice ? [{ domain: p.offerDomain, price: p.offerPrice, url: p.offerUrl }] : [];
}

async function Result({ params }: { params: PageProps<"/check/[id]">["params"] }) {
  const { id } = await params;
  const { state, today } = await currentSession();
  const check = state.checks.find((c) => c.id === id);
  if (!check) notFound();
  const d = check.decision;
  const e = d.evidence;
  const price = check.facts.priceShown;
  const storeName = e.policy && !e.policy.fallback ? e.policy.retailerName : storeLabel(check.store);
  const returns = returnsLine(d, storeName);
  const method = activeMethod(state);
  const watch = check.watchId ? state.watch.find((w) => w.id === check.watchId && !w.closedAt) : undefined;
  const product = check.product;
  const wait = waitAction(check, today);
  // Days counted from the shopper's today say so while the simulated date is on.
  const countedDay = (date: string) => (state.dayOffset > 0 ? `${formatDay(date)} (${SIMULATED})` : formatDay(date));
  const reminderOn = check.reminder && !check.reminder.doneAt ? countedDay(check.reminder.on) : undefined;
  const bought = Boolean(check.purchasedReceiptId);
  const receipt = boughtReceipt(state, check);
  const target = price !== null && product ? targetFor(check) : null;
  const offers = d.verdict === "ask" ? [] : offerLines(await offersFor(check), check.facts.category);
  const shelfItem = e.shelf ? state.shelf.find((i) => i.id === e.shelf!.itemId) : undefined;
  const link = shelfLink(check, state.shelf);

  return (
    <div className="stack">
      <Link href="/check" className="btn outline small" style={{ width: "fit-content" }}>
        Check another
      </Link>
      <MaterialStage tag={sourceTag(check)} label="Your verdict">
        <Frames>
          <article className={`verdict ${d.verdict}`}>
            <VerdictSummary
              verdict={d.verdict}
              reason={bought ? atTheTime(check.reason.text) : check.reason.text}
              headNote={
                bought && (
                  <p className="small" data-testid="bought-note">
                    Bought{receipt ? ` ${eventTime(receipt.createdAt)}` : ""}. The verdict and its evidence are from when you checked.
                  </p>
                )
              }
              brand={check.facts.brand}
              name={check.facts.name}
              imageUrl={product?.imageUrl}
              storeName={storeName}
              priceLabel={price !== null ? formatDollars(price) : null}
              returns={d.verdict !== "ask" ? returns : null}
            />
            {d.verdict === "wait" && wait?.kind === "price" && target !== null && (
              <div className="price-wait">
                {check.band?.usable && check.band.weekly ? <PriceHistory weekly={check.band.weekly} target={target} now={price ?? target} /> : null}
                <p className="small">{check.band?.usable ? `Last 90 days: usually ${formatDollars(check.band.typical)}, lowest ${formatDollars(check.band.low)}.` : `Not enough price history to judge, so we'd wait for ${formatDollars(target)} (10% under) or less.`}</p>
              </div>
            )}
            {d.verdict === "wait" && wait?.kind === "budget" && e.budget && <p className="returns maybe">Budget starts again {countedDay(wait.on)}.</p>}
            <details className="why">
              <summary>See why</summary>
              <dl className="evidence">
                <dt>Rule</dt>
                <dd>
                  {RULE_TEXT[d.rule]}
                </dd>
                {e.shelf && (
                  <>
                    <dt>On your shelf</dt>
                    <dd>
                      {e.shelf.brand} {e.shelf.name}: {relationText(e.shelf.relation)}
                      {e.shelf.relation !== "same-product" && <> ({Math.round(e.shelf.score * 100)}% match)</>}
                      {e.shelf.matched.length > 0 && <>, same {e.shelf.matched.map(attributeWord).join(", ")}</>}. {(shelfItem?.opened ?? e.shelf.opened) ? "Opened" : "Unopened"}
                      {shelfItem?.runOutDate ? `, runs out ${countedDate(shelfItem.runOutDate, state.dayOffset)}` : ""}.
                    </dd>
                  </>
                )}
                {e.replaces && (
                  <>
                    <dt>Replaces</dt>
                    <dd>
                      {e.replaces.brand} {e.replaces.name}, {daysText(e.replaces.daysLeft)} ({countedDate(e.replaces.runOutDate!, state.dayOffset)}).
                    </dd>
                  </>
                )}
                {e.policy && (
                  <>
                    <dt>Returns</dt>
                    <dd>
                      {e.policy.fallback ? `${storeLabel(check.store) ?? "This store"} isn't in our policy table.` : `${e.policy.retailerName}: opened ${e.policy.group} returns ${e.policy.returnableOpened === "yes" ? `accepted${e.policy.openedNeeds ? ` ${e.policy.openedNeeds}` : ""}` : e.policy.returnableOpened === "no" ? "may be refused" : e.policy.returnableOpened === "conditional" ? "only on conditions" : "not stated"}${e.policy.windowDays ? `, ${e.policy.windowDays} days` : ""}.`}{" "}
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
                    <dd>{e.price.usable && e.price.typical !== undefined ? `${formatDollars(e.price.shown)} ${bought ? "when you checked" : "now"}. Usually ${formatDollars(e.price.typical)}, lowest ${formatDollars(e.price.low!)} in the last 90 days; a good price is ${formatDollars(e.price.target!)} or less.` : `${formatDollars(e.price.shown)} ${bought ? "when you checked" : "now"}. Not enough price history to judge.`}</dd>
                  </>
                )}
                {e.budget && (
                  <>
                    <dt>Budget</dt>
                    <dd>
                      {formatDollars(e.budget.remaining)} left in {BUDGET_LABELS[e.budget.group].toLowerCase()} {bought ? "when you checked" : "this month"}.
                    </dd>
                  </>
                )}
                {e.waitUntil && (
                  <>
                    <dt>Look again</dt>
                    <dd>{countedDate(e.waitUntil, state.dayOffset)}</dd>
                  </>
                )}
                <dt>Read from</dt>
                <dd>
                  {check.input.kind === "link" ? "The store link" : isSampleWeekCheck(check.input.sample) ? "A sample week entry" : check.input.sample ? "The sample post" : "Your screenshot"}: {[check.fields.brand, check.fields.productName, check.fields.variant, check.fields.price ? formatDollars(check.fields.price.amount) : null, check.fields.store].filter(Boolean).join(", ") || "nothing legible"}.
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
                <dt>Checked</dt>
                <dd>{formatTime(check.createdAt)} ET</dd>
              </dl>
            </details>
            {offers.length > 0 && (
              <section className="offers">
                <h3>Same product at other stores</h3>
                <ul>
                  {offers.map((o) => (
                    <li key={o.domain} className={`offer ${o.returns}`}>
                      <span>
                        {o.url ? (
                          <a href={o.url} target="_blank" rel="noreferrer sponsored">
                            {o.store}
                          </a>
                        ) : (
                          o.store
                        )}
                        <span className="small muted">, {o.returnsText}</span>
                      </span>
                      <span className="price-line small-price">{formatDollars(o.price)}</span>
                    </li>
                  ))}
                </ul>
                <p className="commission">We may earn a commission when you buy through them.</p>
              </section>
            )}
            <VerdictActions checkId={check.id} verdict={d.verdict} rule={d.rule} price={price} priceLabel={price !== null ? formatDollars(price) : null} savedMethod={method ? { id: method.id, label: method.label, capLabel: formatDollars(method.capCents / 100), withinCap: price !== null && toCentsSafe(price) <= method.capCents } : null} watch={watch ? { target: formatDollars(watch.targetPrice) } : null} wait={wait ? { kind: wait.kind, onLabel: "on" in wait ? formatDay(wait.on).replace(/^\w+, /, "") : undefined, reminderOn } : null} sellerLabel={SELLER_OF_RECORD} targetLabel={target !== null ? formatDollars(target) : null} shelfItemId={e.shelf?.itemId ?? null} purchasedReceiptId={check.purchasedReceiptId ?? null} candidates={check.candidates} needsConfirmation={check.needsConfirmation} />
          </article>
        </Frames>
        {link && <ShelfLink label={link.label} brand={link.brand} name={link.name} note={link.note} href={`/shelf#${link.id}`} />}
      </MaterialStage>
      <div className="status-strip">
        <SimDate today={today} dayOffset={state.dayOffset} />
        {check.input.kind === "screenshot" && isSampleWeekCheck(check.input.sample) && <SampleWeekNote />}
      </div>
    </div>
  );
}

/** The eyebrow tag: where this check was read from. */
function sourceTag(check: CheckRecord): string {
  if (check.input.kind === "link") return "From the store link";
  if (isSampleWeekCheck(check.input.sample)) return "From the sample week";
  if (check.input.sample) return "From a sample post";
  return "From your screenshot";
}

function daysText(n: number): string {
  if (n < 0) return `ran out ${-n} ${n === -1 ? "day" : "days"} ago`;
  if (n === 0) return "runs out today";
  return `runs out in ${n} ${n === 1 ? "day" : "days"}`;
}
