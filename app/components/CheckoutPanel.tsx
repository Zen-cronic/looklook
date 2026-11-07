"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* Minimal shape of the PayPal JS SDK used here. */
interface PayPalActions {
  restart?: () => Promise<void>;
}

interface CardFieldsInstance {
  isEligible(): boolean;
  NameField(o?: Record<string, unknown>): { render(el: HTMLElement): Promise<void> };
  NumberField(o?: Record<string, unknown>): { render(el: HTMLElement): Promise<void> };
  ExpiryField(o?: Record<string, unknown>): { render(el: HTMLElement): Promise<void> };
  CVVField(o?: Record<string, unknown>): { render(el: HTMLElement): Promise<void> };
  submit(): Promise<void>;
}

interface PayPalNamespace {
  FUNDING: { PAYPAL: string };
  Buttons(options: Record<string, unknown>): { isEligible(): boolean; render(el: HTMLElement): Promise<void> };
  CardFields?(options: Record<string, unknown>): CardFieldsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function loadSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&components=buttons,card-fields&currency=USD&intent=capture`;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-sdk="paypal"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load"))));
    s.addEventListener("error", () => reject(new Error("PayPal didn't load")));
    if (!existing) {
      s.src = src;
      s.dataset.sdk = "paypal";
      document.head.appendChild(s);
    }
  });
}

const FIELD_STYLE = {
  input: { "font-size": "16px", "font-family": "Helvetica, Arial, sans-serif", padding: "12px", color: "#1c1a1f" },
  ".invalid": { color: "#a32640" },
};

interface Props {
  intentId: string;
  clientId: string;
  amountLabel: string;
  defaultCapDollars: number;
  /** The agreement lines, with {cap} where the cap goes. */
  consentTemplate: string[];
}

export function CheckoutPanel({ intentId, clientId, amountLabel, defaultCapDollars, consentTemplate }: Props) {
  const router = useRouter();
  const [save, setSave] = useState(false);
  const [cap, setCap] = useState(String(defaultCapDollars));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "paying" | "failed">("loading");
  const [cardReady, setCardReady] = useState<"pending" | "yes" | "no">("pending");
  const saveRef = useRef(save);
  const capRef = useRef(cap);
  const buttonsEl = useRef<HTMLDivElement>(null);
  const nameEl = useRef<HTMLDivElement>(null);
  const numberEl = useRef<HTMLDivElement>(null);
  const expiryEl = useRef<HTMLDivElement>(null);
  const cvvEl = useRef<HTMLDivElement>(null);
  const cardFields = useRef<CardFieldsInstance | null>(null);

  useEffect(() => {
    saveRef.current = save;
    capRef.current = cap;
  }, [save, cap]);

  useEffect(() => {
    let cancelled = false;

    async function createOrder(funding: "paypal" | "card") {
      setError(null);
      const capCents = Math.round(Number(capRef.current) * 100);
      const res = await fetch("/api/checkout/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, funding, save: saveRef.current, capCents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the payment.");
        throw new Error(data.error);
      }
      return data.orderId as string;
    }

    async function capture(orderId: string, actions?: PayPalActions) {
      setStatus("paying");
      const res = await fetch("/api/checkout/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, orderId }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/receipts/${data.receiptId}`);
        return;
      }
      setStatus("ready");
      setError(data.error ?? "The payment didn't go through.");
      if (data.restart && actions?.restart) await actions.restart();
    }

    async function mount() {
      const paypal = await loadSdk(clientId);
      if (cancelled) return;
      const buttonsHost = buttonsEl.current;
      if (buttonsHost && !buttonsHost.hasChildNodes()) {
        await paypal
          .Buttons({
            fundingSource: paypal.FUNDING.PAYPAL,
            style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 48 },
            createOrder: () => createOrder("paypal"),
            onApprove: (data: { orderID: string }, actions: PayPalActions) => capture(data.orderID, actions),
            onCancel: () => setError("PayPal was closed before approving. Nothing was charged."),
            onError: () => setError((e) => e ?? "PayPal couldn't finish. Nothing was charged."),
          })
          .render(buttonsHost);
      }
      if (!paypal.CardFields) {
        setCardReady("no");
      } else {
        const cf = paypal.CardFields({
          createOrder: () => createOrder("card"),
          onApprove: (data: { orderID: string }) => capture(data.orderID),
          onError: () => {
            setStatus("ready");
            setError((e) => e ?? "The card couldn't be charged. Check the details or use PayPal.");
          },
          style: FIELD_STYLE,
        });
        const slots = [nameEl.current, numberEl.current, expiryEl.current, cvvEl.current];
        if (cf.isEligible() && slots.every((x) => x && !x.hasChildNodes())) {
          cardFields.current = cf;
          await Promise.all([
            cf.NameField({ placeholder: "Name on card" }).render(slots[0]!),
            cf.NumberField({ placeholder: "Card number" }).render(slots[1]!),
            cf.ExpiryField({ placeholder: "MM / YY" }).render(slots[2]!),
            cf.CVVField({ placeholder: "CVV" }).render(slots[3]!),
          ]);
          if (!cancelled) setCardReady("yes");
        } else if (!cardFields.current && !cancelled) {
          setCardReady("no");
        }
      }
      if (!cancelled) setStatus("ready");
    }

    mount().catch(() => {
      if (!cancelled) {
        setStatus("failed");
        setError("PayPal didn't load. Check your connection and reload the page.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, intentId, router]);

  const capValid = !save || (Number(cap) >= 1 && Number(cap) <= 1000);
  const capLabel = `$${Number(cap || 0).toFixed(2)}`;

  return (
    <div className="stack">
      <section className="consent stack-sm">
        <label className="check-row">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save this payment method for rebuys I approve
        </label>
        <div className="cap-input" style={{ opacity: save ? 1 : 0.5 }}>
          <label htmlFor="cap">Per-rebuy cap</label>
          <span>$</span>
          <input id="cap" type="number" min="1" max="1000" step="1" inputMode="numeric" value={cap} disabled={!save} onChange={(e) => setCap(e.target.value)} />
        </div>
        <ul>
          {consentTemplate.map((l) => (
            <li key={l}>{l.replace("{cap}", capLabel)}</li>
          ))}
        </ul>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!capValid && <p className="error">Set a cap between $1 and $1,000.</p>}
      {status === "paying" && (
        <p className="working" role="status">
          <span className="spinner" aria-hidden /> Confirming the payment with PayPal…
        </p>
      )}

      <div className="stack-sm" style={{ pointerEvents: capValid && status !== "paying" ? "auto" : "none", opacity: capValid ? 1 : 0.5 }}>
        <div ref={buttonsEl} className="paypal-area" />
        {status === "loading" && <div className="skeleton" style={{ height: "3rem" }} />}
        <div className="or">or pay by card</div>
        <div className="card-fields stack-sm" hidden={cardReady === "no"}>
          <div ref={nameEl} className="field-slot" />
          <div ref={numberEl} className="field-slot" />
          <div className="field-row">
            <div ref={expiryEl} className="field-slot" />
            <div ref={cvvEl} className="field-slot" />
          </div>
          <button
            className="btn block"
            disabled={cardReady !== "yes" || status === "paying"}
            onClick={() => {
              setError(null);
              cardFields.current?.submit().catch(() => {
                setStatus("ready");
                setError((e) => e ?? "Check the card details and try again.");
              });
            }}
          >
            Pay {amountLabel} by card
          </button>
        </div>
        {cardReady === "no" && <p className="small muted">Card payment isn&apos;t available here; use PayPal.</p>}
      </div>
    </div>
  );
}
