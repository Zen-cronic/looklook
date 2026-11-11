"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDay } from "@/lib/app/dates";
import { formatCents } from "@/lib/app/money";
import type { SlipLine, WeekInput } from "@/lib/app/types";
import type { GuardView } from "@/lib/app/guard";
import { guardHead, guardRefundLine, guardTestLabel } from "@/lib/app/guard-words";
import type { SentLineView, WeekView } from "@/lib/app/week";
import { Eyebrow } from "./Eyebrow";
import { ProductGlyph, glyphFor } from "./ProductGlyph";
import { SampleWeekNote } from "./SampleWeek";
import { VerdictChip } from "./VerdictChip";
import s from "./WeekFlow.module.css";

const money = (c: number) => formatCents(c);

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** Start a week from the sample week's posts. */
export function WeekStart({ hasMethod }: { hasMethod: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/week", { from: "sample-week" });
    if (!r.ok || typeof r.data.id !== "string") {
      setError(typeof r.data.error === "string" ? r.data.error : "Couldn't hand the week over. Try again.");
      setBusy(false);
      return;
    }
    router.push(`/week?run=${r.data.id}`);
  }
  return (
    <section className={`card ${s.start}`} aria-labelledby="week-start">
      <Eyebrow as="h2" icon="post" id="week-start">
        Posts in
      </Eyebrow>
      <p>
        Hand over the posts you saved this week. Each one is checked against your shelf, your budget, the price history and the store&apos;s returns. Then one slip lists what the week needs paid, and one yes pays it.
      </p>
      <p className="small muted">
        The sample week is four posts a made-up shopper saved: a sunscreen and a vitamin C serum, a retinol and a peptide serum. Loading it replaces this browser&apos;s checks and keeps saved payment methods.
        {hasMethod ? "" : " The first payment opens PayPal checkout, where you can save the method for the rest."}
      </p>
      <div className="actions">
        <button className="btn" onClick={start} disabled={busy} data-testid="week-start">
          {busy ? "Checking the week…" : "Use the sample week"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Thumb({ imageUrl, category, brand }: { imageUrl?: string; category?: WeekInput["category"]; brand: string }) {
  return imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={s.thumb} src={imageUrl} alt="" />
  ) : (
    <span className={`${s.thumb} ${s.glyph}`}>
      <ProductGlyph shape={category ? glyphFor(category) : "bottle"} letter={brand} />
    </span>
  );
}

function postLine(i: WeekInput, view: WeekView): string {
  if (i.group === "skip") return i.keptCents !== undefined ? `Already on your shelf. ${money(i.keptCents)} kept.` : "Already on your shelf.";
  if (i.group === "buy") {
    const sent = view.sent.find((l) => l.source.kind === "check" && l.source.checkId === i.checkId);
    return sent?.status === "paid" ? `Paid, ${money(sent.amountCents)}.` : `${i.priceCents !== undefined ? money(i.priceCents) : "Price"} on the slip.`;
  }
  if (i.group === "wait") {
    if (i.waitKind === "price" && i.targetPrice !== undefined) {
      const w = view.run.watches.find((x) => x.checkId === i.checkId);
      const target = money(Math.round(i.targetPrice * 100));
      if (w?.status === "armed") return `Watching for ${target} or less. You get a yes card when it drops.`;
      if (w?.status === "unavailable") return w.message ?? "The price feed didn't accept this product.";
      return `Watching for ${target} or less starts with your yes.`;
    }
    if (i.waitKind === "budget" && i.waitUntil) return `Waits for next month's budget, ${formatDay(i.waitUntil)}.`;
    if (i.waitKind === "run-out" && i.waitUntil) return `You still have one. Look again ${formatDay(i.waitUntil)}.`;
    return "Waits: set when the one you own runs out.";
  }
  return "Confirm which product it is first.";
}

const VERDICT_OF: Record<WeekInput["group"], "skip" | "wait" | "buy" | "ask"> = { skip: "skip", wait: "wait", buy: "buy", ask: "ask" };

function lineTag(l: SlipLine): string {
  if (l.why === "buy") return "From your posts";
  if (l.daysLeft === undefined) return "Coming due";
  return l.daysLeft < 0 ? `Ran out ${-l.daysLeft} ${l.daysLeft === -1 ? "day" : "days"} ago` : l.daysLeft === 0 ? "Runs out today" : `Runs out in ${l.daysLeft} ${l.daysLeft === 1 ? "day" : "days"}`;
}

const STATUS_WORD: Record<SentLineView["status"], string> = {
  queued: "Paying",
  paid: "Paid",
  declined: "Declined",
  "price-changed": "Price changed",
  "over-cap": "Over your cap",
  "over-budget": "Over budget",
  stale: "Out of date",
  "needs-checkout": "Needs checkout",
  unconfirmed: "Not confirmed",
};

function SentRow({ l }: { l: SentLineView }) {
  const note =
    l.status === "paid"
      ? `Charged ${money(l.amountCents)} once.`
      : l.status === "queued"
        ? "Waiting for PayPal…"
        : l.status === "declined"
          ? "PayPal declined the card. Nothing was charged."
          : (l.message ?? "Nothing was charged.");
  return (
    <li className={s.sentRow} data-status={l.status}>
      <Thumb imageUrl={l.imageUrl} category={l.category} brand={l.brand} />
      <div className={s.meta}>
        <div className="brand-line">{l.brand}</div>
        <div className="name-line">{l.title.startsWith(l.brand) ? l.title.slice(l.brand.length).trim() || l.title : l.title}</div>
        <p className="small muted">{note}</p>
        {l.status === "paid" && (
          <p className={`small ${s.ids}`}>
            PayPal order <span className="mono">{l.orderId}</span>
            {l.receiptId && (
              <>
                {" "}
                <Link href={`/receipts/${l.receiptId}`}>Receipt</Link>
              </>
            )}
          </p>
        )}
        {l.status === "declined" && (
          <p className="small">
            <Link href="/rebuys">Pay it another way on Rebuys</Link>
          </p>
        )}
      </div>
      <span className={s.state} data-status={l.status}>
        {STATUS_WORD[l.status]}
      </span>
    </li>
  );
}

/** After the yes: the price guard on one paid item, its refunds, and the labelled test drop. */
export function GuardRow({ g, onChange }: { g: GuardView; onChange: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function testDrop() {
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/receipts/${g.receiptId}/drop`, { priceCents: g.testCents });
    if (!r.ok) setError(typeof r.data.error === "string" ? r.data.error : "The test drop didn't go through. Nothing was refunded.");
    await onChange();
    setBusy(false);
  }
  const head = guardHead(g);
  return (
    <li className={s.guard} data-testid="week-guard" data-status={g.status}>
      <span>{head}</span>
      {g.refunds.map((x) => (
        <span key={x.refundId} className={`small ${s.guardRefund}`} data-testid="guard-refund">
          {guardRefundLine(g, x)} PayPal refund <span className="mono">{x.refundId}</span>
          {x.simulated ? " (test drop)" : ""}
        </span>
      ))}
      {g.testCents !== undefined && (
        <button className="btn outline small" onClick={testDrop} disabled={busy} data-testid="guard-drop">
          {busy ? "Asking PayPal…" : guardTestLabel(g)}
        </button>
      )}
      {error && <span className="small">{error}</span>}
    </li>
  );
}

/** The price guard on a receipt page: the same row, refreshed in place after a test drop. */
export function ReceiptGuard({ g }: { g: GuardView }) {
  const router = useRouter();
  return (
    <ul className={s.guards} aria-live="polite">
      <GuardRow g={g} onChange={() => router.refresh()} />
    </ul>
  );
}

export function WeekFlow({ initial, paidReceipt }: { initial: WeekView; paidReceipt?: string }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(paidReceipt ? "First payment done. One yes pays the rest with the method you saved." : null);
  const poll = useRef<number | null>(null);
  const runId = view.run.id;

  useEffect(() => () => {
    if (poll.current !== null) window.clearInterval(poll.current);
  }, []);

  async function refresh() {
    const res = await fetch(`/api/week/${runId}`);
    if (res.ok) setView((await res.json()) as WeekView);
  }

  async function firstAtCheckout(line: SlipLine) {
    const r = await postJson("/api/intents", { source: line.source, approved: { amountCents: line.amountCents, version: line.version }, returnTo: `/week?run=${runId}` });
    if (r.ok && typeof r.data.id === "string") {
      router.push(`/checkout/${r.data.id}`);
      return;
    }
    setPaying(false);
    setMessage(typeof r.data.error === "string" ? r.data.error : "Couldn't open checkout. Try again.");
    await refresh();
  }

  async function yes() {
    setPaying(true);
    setMessage(null);
    if (view.slip.lines.length > 0 && !view.slip.methodId) return firstAtCheckout(view.slip.lines[0]);
    poll.current = window.setInterval(refresh, 700);
    const r = await postJson(`/api/week/${runId}/approve`, { hash: view.slip.hash });
    if (poll.current !== null) window.clearInterval(poll.current);
    poll.current = null;
    if (r.ok) setView(r.data as unknown as WeekView);
    else {
      if (r.data.needsCheckout && view.slip.lines[0]) return firstAtCheckout(view.slip.lines[0]);
      setMessage(typeof r.data.error === "string" ? r.data.error : "The payment didn't go through. Nothing was charged.");
      await refresh();
    }
    setPaying(false);
    router.refresh();
  }

  const { slip, sent } = view;
  const posts = view.run.inputs;
  const due = slip.lines.filter((l) => l.why === "due");
  const paid = sent.filter((l) => l.status === "paid");
  const paidCents = paid.reduce((sum, l) => sum + l.amountCents, 0);
  const armed = view.run.watches.filter((w) => w.status === "armed").length;
  const done = sent.length > 0 && slip.lines.length === 0 && slip.watches.length === 0 && !view.paying;
  const counts = {
    skip: posts.filter((p) => p.group === "skip").length,
    wait: posts.filter((p) => p.group === "wait").length,
    buy: posts.filter((p) => p.group === "buy").length,
  };

  return (
    <div className="object-layout">
      <div className={`lead ${s.flow}`}>
        {view.sample && <SampleWeekNote />}
        <section className={s.step} aria-labelledby="week-posts">
          <Eyebrow as="h2" icon="post" id="week-posts">
            {`${posts.length} posts in`}
          </Eyebrow>
          <p className={`small muted ${s.sum}`}>
            {counts.skip} skipped, {counts.wait} waiting, {counts.buy} to buy. {view.keptCents > 0 ? `${money(view.keptCents)} kept by skipping.` : ""}
          </p>
          <ul className={s.rows}>
            {posts.map((p) => (
              <li key={p.checkId} className={s.row} data-group={p.group}>
                <Thumb imageUrl={p.imageUrl} category={p.category} brand={p.brand} />
                <div className={s.meta}>
                  <div className="brand-line">{p.brand}</div>
                  <div className="name-line">{p.title.startsWith(p.brand) ? p.title.slice(p.brand.length).trim() || p.title : p.title}</div>
                  <p className={`small ${p.group === "skip" ? s.kept : "muted"}`}>{postLine(p, view)}</p>
                  {p.group === "ask" && (
                    <p className="small">
                      <Link href={`/check/${p.checkId}`}>Confirm it</Link>
                    </p>
                  )}
                </div>
                <Link className={s.chipLink} href={`/check/${p.checkId}`} aria-label={`Why: ${p.title}`}>
                  <VerdictChip verdict={VERDICT_OF[p.group]} />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {due.length > 0 && (
          <section className={s.step} aria-labelledby="week-due">
            <Eyebrow as="h2" icon="shelf" id="week-due">
              Coming due from your shelf
            </Eyebrow>
            <ul className={s.rows}>
              {due.map((l) => (
                <li key={l.approvalKey} className={s.row}>
                  <Thumb imageUrl={l.imageUrl} category={l.category} brand={l.brand} />
                  <div className={s.meta}>
                    <div className="brand-line">{l.brand}</div>
                    <div className="name-line">{l.title.startsWith(l.brand) ? l.title.slice(l.brand.length).trim() || l.title : l.title}</div>
                    <p className="small muted">{lineTag(l)}. On the slip.</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sent.length > 0 && (
          <section className={s.step} aria-labelledby="week-paid" aria-live="polite">
            <Eyebrow as="h2" icon="receipt" id="week-paid">
              What your yes did
            </Eyebrow>
            <ul className={s.rows}>
              {sent.map((l) => (
                <SentRow key={l.approvalKey} l={l} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className={s.side}>
        {done ? (
          <section className={`card ${s.slip} ${s.done}`} aria-labelledby="week-done" data-testid="week-done">
            <Eyebrow as="h2" icon="check" id="week-done">
              One yes
            </Eyebrow>
            <p className={s.total}>
              Week done. {money(paidCents)} paid.
            </p>
            <ul className={s.doneList}>
              <li>
                {counts.skip} skipped, {money(view.keptCents)} kept
              </li>
              <li>
                {armed} {armed === 1 ? "price watch" : "price watches"} on
              </li>
              <li>Shelf updated: bought items added, staples restocked</li>
              {view.guards.some((g) => g.refundedCents > 0) && <li>{money(view.guards.reduce((n, g) => n + g.refundedCents, 0))} back to your card and your budget after you paid</li>}
              {Object.entries(view.budgetsLeft)
                .filter(([g]) => posts.some((p) => p.category && g === "skincare"))
                .map(([g, left]) => (
                  <li key={g}>
                    {money(Math.round((left ?? 0) * 100))} left in {g} this month
                  </li>
                ))}
            </ul>
            {view.guards.length > 0 && (
              <ul className={s.guards} aria-label="After you paid" aria-live="polite">
                {view.guards.map((g) => (
                  <GuardRow key={g.receiptId} g={g} onChange={refresh} />
                ))}
              </ul>
            )}
            <div className="actions">
              <Link className="btn outline" href="/shelf">
                See your shelf
              </Link>
              <Link className="btn outline" href="/rebuys">
                Rebuys and watches
              </Link>
            </div>
          </section>
        ) : (
          <section className={`card ${s.slip}`} aria-labelledby="week-slip" data-testid="week-slip">
            <Eyebrow as="h2" icon="yes" id="week-slip">
              Approve this week
            </Eyebrow>
            {slip.lines.length > 0 ? (
              <ul className={s.slipLines}>
                {slip.lines.map((l) => (
                  <li key={l.approvalKey}>
                    <span>
                      <span className={s.slipTitle}>{l.title}</span>
                      <span className="small muted">{lineTag(l)}</span>
                    </span>
                    <span className="mono">{money(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Nothing to pay this week.</p>
            )}
            {slip.watches.length > 0 && (
              <ul className={s.slipWatches}>
                {slip.watches.map((w) => (
                  <li key={w.checkId}>
                    Watch {w.title} for {money(Math.round(w.targetPrice * 100))} or less
                  </li>
                ))}
              </ul>
            )}
            {slip.leftOff.length > 0 && (
              <ul className={s.leftOff}>
                {slip.leftOff.map((l) => (
                  <li key={l.approvalKey}>
                    <span className={s.slipTitle}>Not on this yes: {l.title}</span>
                    <span className="small muted">{l.note}</span>
                  </li>
                ))}
              </ul>
            )}
            {slip.lines.length > 0 && (
              <p className={s.total}>
                <span>
                  {slip.lines.length} {slip.lines.length === 1 ? "payment" : "payments"}
                </span>
                <span className="mono">{money(slip.totalCents)}</span>
              </p>
            )}
            <p className="small muted">
              {slip.methodLabel
                ? `Paid with ${slip.methodLabel}, up to ${money(slip.capCents ?? 0)} each. Each line is its own PayPal payment.`
                : slip.lines.length > 0
                  ? `The first payment opens PayPal checkout. Tick save there, then one yes pays the other ${slip.lines.length - 1}.`
                  : ""}
            </p>
            {(slip.lines.length > 0 || slip.watches.length > 0) && (
              <>
                <button className={`btn block ${s.yes}`} onClick={yes} disabled={paying || view.paying} data-testid="week-yes">
                  {paying || view.paying ? "Paying…" : slip.lines.length === 0 ? "Yes, start watching" : slip.methodId ? `Yes, pay ${money(slip.totalCents)}` : `Pay the first with PayPal, ${money(slip.lines[0].amountCents)}`}
                </button>
                <p className="small muted">Your yes here is your yes for each line above, at the price on that line. Nothing else is charged.</p>
              </>
            )}
            {message && <p className={`small ${s.message}`}>{message}</p>}
          </section>
        )}
      </aside>
    </div>
  );
}
