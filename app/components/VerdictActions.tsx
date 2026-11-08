"use client";

import Link from "next/link";
import { useState } from "react";
import type { CheckCandidate } from "@/lib/app/types";
import type { Verdict } from "@/lib/verdict/types";
import { useApi } from "./useApi";

interface Props {
  checkId: string;
  verdict: Verdict;
  rule: string;
  price: number | null;
  priceLabel: string | null;
  savedMethod: { id: string; label: string; capLabel: string; withinCap: boolean } | null;
  watch: { target: string } | null;
  /** What a wait offers, from the rule that fired. */
  wait: { kind: "budget" | "price" | "run-out" | "set-run-out"; onLabel?: string; reminderOn?: string } | null;
  /** Who sells it when you buy here. */
  sellerLabel: string;
  targetLabel: string | null;
  shelfItemId: string | null;
  purchasedReceiptId: string | null;
  candidates: CheckCandidate[];
  needsConfirmation: boolean;
}

export function VerdictActions(p: Props) {
  const { call, busy, error, router } = useApi();
  const [price, setPrice] = useState("");

  async function startCheckout() {
    const r = await call<{ id: string }>("checkout", "/api/intents", "POST", { source: { kind: "check", checkId: p.checkId }, ...(p.price !== null ? { approved: { amountCents: Math.round(p.price * 100) } } : {}) }, { refresh: false });
    if (r) router.push(`/checkout/${r.id}`);
  }

  async function paySaved() {
    const r = await call<{ receiptId: string }>("pay", "/api/pay", "POST", { source: { kind: "check", checkId: p.checkId }, approved: { amountCents: Math.round((p.price ?? 0) * 100) } }, { refresh: false });
    if (r) router.push(`/receipts/${r.receiptId}`);
  }

  if (p.purchasedReceiptId) {
    return (
      <div className="verdict-actions">
        <Link className="btn" href={`/receipts/${p.purchasedReceiptId}`}>
          Bought. See the receipt
        </Link>
      </div>
    );
  }

  const errorBox = error && <p className="error">{error.error}</p>;

  if (p.verdict === "ask" && p.needsConfirmation) {
    return (
      <div className="verdict-actions">
        {errorBox}
        <h3>Which one is it?</h3>
        {p.candidates.length ? (
          <ul className="candidates">
            {p.candidates.map((c) => (
              <li key={c.product.id} className="candidate">
                {c.product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={c.product.imageUrl} alt="" />
                ) : (
                  <span className="thumb empty" />
                )}
                <span className="meta">
                  <span className="brand-line">{c.product.brand}</span>
                  <span className="name-line" style={{ display: "block" }}>
                    {c.product.title}
                  </span>
                  {c.product.offerPrice !== undefined && (
                    <span className="small muted">
                      ${c.product.offerPrice.toFixed(2)} at {c.product.offerDomain}
                    </span>
                  )}
                </span>
                <button className="btn small" disabled={!!busy} onClick={() => call("confirm", `/api/check/${p.checkId}/confirm`, "POST", { productId: c.product.id })}>
                  {busy === "confirm" ? "Checking…" : "This one"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">We couldn&apos;t find it in the catalogue. Try a clearer screenshot or paste the store link.</p>
        )}
        <Link className="btn outline" href="/">
          None of these, try again
        </Link>
      </div>
    );
  }

  if (p.verdict === "ask" && p.rule === "price-unknown") {
    return (
      <form
        className="verdict-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void call("price", `/api/check/${p.checkId}/price`, "POST", { price: Number(price) });
        }}
      >
        {errorBox}
        <label className="field">
          Price you saw (USD)
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <button className="btn" disabled={!!busy}>
          {busy === "price" ? "Checking…" : "Check with this price"}
        </button>
      </form>
    );
  }

  const remind = () => call("remind", `/api/check/${p.checkId}/remind`, "POST");

  return (
    <div className="verdict-actions">
      {errorBox}
      {p.verdict === "wait" && p.wait?.kind === "budget" &&
        (p.wait.reminderOn ? (
          <p className="notice">We&apos;ll remind you on {p.wait.reminderOn}, when next month&apos;s budget starts. Until then there&apos;s no buy button for this one.</p>
        ) : (
          <button className="btn" disabled={!!busy} onClick={remind}>
            {busy === "remind" ? "Saving…" : `Remind me when next month's budget starts (${p.wait.onLabel})`}
          </button>
        ))}
      {p.verdict === "wait" && p.wait?.kind === "run-out" &&
        (p.wait.reminderOn ? (
          <p className="notice">We&apos;ll remind you on {p.wait.reminderOn}.</p>
        ) : (
          <button className="btn" disabled={!!busy} onClick={remind}>
            {busy === "remind" ? "Saving…" : `Remind me on ${p.wait.onLabel}`}
          </button>
        ))}
      {p.verdict === "wait" && (p.wait?.kind === "run-out" || p.wait?.kind === "set-run-out") && p.shelfItemId && (
        <Link className={p.wait.kind === "set-run-out" ? "btn" : "btn outline"} href={`/shelf#${p.shelfItemId}`}>
          {p.wait.kind === "set-run-out" ? "Set when yours runs out" : "See yours on your shelf"}
        </Link>
      )}
      {p.verdict === "wait" &&
        p.wait?.kind === "price" &&
        (p.watch ? (
          <Link className="btn" href="/rebuys">
            Watching for {p.watch.target} or less
          </Link>
        ) : (
          <button className="btn" disabled={!!busy} onClick={() => call("watch", `/api/check/${p.checkId}/watch`, "POST")}>
            {busy === "watch" ? "Starting the price alert…" : `Watch for a drop${p.targetLabel ? ` to ${p.targetLabel}` : ""}`}
          </button>
        ))}
      {p.verdict === "buy" &&
        (p.savedMethod && p.savedMethod.withinCap ? (
          <>
            <button className="btn" disabled={!!busy} onClick={paySaved}>
              {busy === "pay" ? "Paying…" : `Pay ${p.priceLabel} with ${p.savedMethod.label}`}
            </button>
            <button className="btn outline" disabled={!!busy} onClick={startCheckout}>
              Pay another way
            </button>
          </>
        ) : (
          <button className="btn" disabled={!!busy || p.price === null} onClick={startCheckout}>
            {busy === "checkout" ? "Opening checkout…" : `Buy for ${p.priceLabel} with PayPal`}
          </button>
        ))}
      {p.verdict === "skip" && (
        <>
          {p.shelfItemId && (
            <Link className="btn" href={`/shelf#${p.shelfItemId}`}>
              See what you own
            </Link>
          )}
          <button className="btn outline" disabled={!!busy || p.price === null} onClick={startCheckout}>
            Buy it anyway
          </button>
        </>
      )}
      {p.verdict === "wait" && p.wait?.kind === "price" && (
        <button className="btn outline" disabled={!!busy || p.price === null} onClick={startCheckout}>
          Buy now anyway
        </button>
      )}
      {(p.verdict === "buy" || p.verdict === "skip" || (p.verdict === "wait" && p.wait?.kind === "price")) && p.price !== null && <p className="small muted">Buying here: sold by {p.sellerLabel}.</p>}
    </div>
  );
}
