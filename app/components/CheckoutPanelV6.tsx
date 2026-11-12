"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SDK_V6_SCRIPT_URL, paymentFlow, sdkFits, submitOutcome } from "@/lib/paypal/sdk-v6";

/* Minimal shape of the PayPal JS SDK v6 used here. */
interface EligibleMethods {
  isEligible(method: string): boolean;
}

interface PayPalSession {
  start(options: { presentationMode: "auto" }, orderPromise: Promise<{ orderId: string }>): Promise<void>;
}

interface CardFieldsSession {
  createCardFieldsComponent(options: { type: "name" | "number" | "expiry" | "cvv"; placeholder?: string; style?: Record<string, unknown> }): HTMLElement;
  submit(orderId: string): Promise<{ state?: string; data?: { orderId?: string; message?: string } }>;
}

interface SdkInstance {
  findEligibleMethods(options: { currencyCode: string; paymentFlow: string }): Promise<EligibleMethods>;
  createPayPalOneTimePaymentSession(callbacks: {
    onApprove: (data: { orderId: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }): PayPalSession;
  createCardFieldsOneTimePaymentSession(): CardFieldsSession;
}

interface PayPalV6Namespace {
  createInstance(options: { clientId: string; components: string[]; pageType?: string }): Promise<SdkInstance>;
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string };
    }
  }
}

function paypalGlobal(): unknown {
  return (window as unknown as { paypal?: unknown }).paypal;
}

function loadSdkV6(): Promise<PayPalV6Namespace> {
  const now = paypalGlobal();
  if (sdkFits(now, "v6")) return Promise.resolve(now as PayPalV6Namespace);
  return new Promise((resolve, reject) => {
    // Reuse a v6 tag still loading; one that loaded but was overwritten by v5 is loaded again.
    const existing = now ? null : document.querySelector<HTMLScriptElement>(`script[data-sdk="paypal-v6"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => {
      const ns = paypalGlobal();
      if (sdkFits(ns, "v6")) resolve(ns as PayPalV6Namespace);
      else reject(new Error("PayPal didn't load"));
    });
    s.addEventListener("error", () => reject(new Error("PayPal didn't load")));
    if (!existing) {
      s.src = SDK_V6_SCRIPT_URL;
      s.async = true;
      s.dataset.sdk = "paypal-v6";
      document.head.appendChild(s);
    }
  });
}

// The same field look as the v5 checkout, in v6's camelCase style keys. The fields are PayPal's
// iframes, which can't load the app's fonts, so they use a close system face.
const FIELD_STYLE = {
  input: { fontSize: "16px", fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", fontWeight: "500", padding: "13px 14px", color: "#0a0a0a", border: "1.5px solid #0a0a0a", borderRadius: "12px", boxShadow: "none" },
  ":focus": { border: "1.5px solid #2b3bff", boxShadow: "0 0 0 3px #e3e6ff" },
  ".invalid": { color: "#0a0a0a", border: "1.5px solid #0a0a0a", boxShadow: "0 0 0 3px #ff8bc7" },
};

interface Props {
  intentId: string;
  clientId: string;
  amountLabel: string;
  defaultCapDollars: number;
  /** The agreement lines, with {cap} where the cap goes. */
  consentTemplate: string[];
  /** After paying, go back here (a week) instead of to the receipt. */
  returnTo?: string;
}

/**
 * The checkout on PayPal's JS SDK v6 (`?sdk=v6`): the PayPal button through a
 * one-time payment session and Card Fields through a card one-time session.
 * Saving during the purchase uses the same server order (vault ON_SUCCESS);
 * eligibility is checked for VAULT_WITH_PAYMENT when the save box is ticked.
 */
export function CheckoutPanelV6({ intentId, clientId, amountLabel, defaultCapDollars, consentTemplate, returnTo }: Props) {
  const router = useRouter();
  const [save, setSave] = useState(false);
  const [cap, setCap] = useState(String(defaultCapDollars));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "paying" | "failed">("loading");
  const [sdk, setSdk] = useState<SdkInstance | null>(null);
  const [paypalReady, setPaypalReady] = useState<"pending" | "yes" | "no">("pending");
  const [cardReady, setCardReady] = useState<"pending" | "yes" | "no">("pending");
  const [submitting, setSubmitting] = useState(false);
  const saveRef = useRef(save);
  const capRef = useRef(cap);
  const nameEl = useRef<HTMLDivElement>(null);
  const numberEl = useRef<HTMLDivElement>(null);
  const expiryEl = useRef<HTMLDivElement>(null);
  const cvvEl = useRef<HTMLDivElement>(null);
  const paypalSession = useRef<PayPalSession | null>(null);
  const cardSession = useRef<CardFieldsSession | null>(null);

  useEffect(() => {
    saveRef.current = save;
    capRef.current = cap;
  }, [save, cap]);

  async function createOrder(funding: "paypal" | "card"): Promise<string> {
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

  async function capture(orderId: string) {
    setStatus("paying");
    const res = await fetch("/api/checkout/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, orderId }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(returnTo ? `${returnTo}&paid=${data.receiptId}` : `/receipts/${data.receiptId}`);
      return;
    }
    setStatus("ready");
    setError(data.error ?? "The payment didn't go through.");
  }
  // The session callbacks are created once; they call the latest capture through this ref.
  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  });

  // Load the v6 core script and create the SDK instance once.
  useEffect(() => {
    let cancelled = false;
    loadSdkV6()
      .then((paypal) => paypal.createInstance({ clientId, components: ["paypal-payments", "card-fields"], pageType: "checkout" }))
      .then((instance) => {
        if (cancelled) return;
        paypalSession.current ??= instance.createPayPalOneTimePaymentSession({
          onApprove: ({ orderId }) => captureRef.current(orderId),
          onCancel: () => setError("PayPal was closed before approving. Nothing was charged."),
          onError: () => setError((e) => e ?? "PayPal couldn't finish. Nothing was charged."),
        });
        setSdk(instance);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("failed");
          setError("PayPal didn't load. Check your connection and reload the page.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Eligibility for this flow (re-checked when the save box changes), then the card fields once.
  useEffect(() => {
    if (!sdk) return;
    let cancelled = false;
    sdk
      .findEligibleMethods({ currencyCode: "USD", paymentFlow: paymentFlow(save) })
      .then((methods) => {
        if (cancelled) return;
        setPaypalReady(methods.isEligible("paypal") ? "yes" : "no");
        const cards = methods.isEligible("advanced_cards");
        if (cards && !cardSession.current) {
          const slots = [nameEl.current, numberEl.current, expiryEl.current, cvvEl.current];
          if (slots.every((x) => x && !x.hasChildNodes())) {
            const session = sdk.createCardFieldsOneTimePaymentSession();
            const fields = [
              session.createCardFieldsComponent({ type: "name", placeholder: "Name on card", style: FIELD_STYLE }),
              session.createCardFieldsComponent({ type: "number", placeholder: "Card number", style: FIELD_STYLE }),
              session.createCardFieldsComponent({ type: "expiry", placeholder: "MM / YY", style: FIELD_STYLE }),
              session.createCardFieldsComponent({ type: "cvv", placeholder: "CVV", style: FIELD_STYLE }),
            ];
            // The hosted field's iframe defaults to 150px tall; size it to one input line.
            fields.forEach((f, i) => {
              f.style.display = "block";
              f.style.height = "52px";
              slots[i]!.appendChild(f);
            });
            cardSession.current = session;
          }
        }
        setCardReady(cards && cardSession.current ? "yes" : "no");
        setStatus((s) => (s === "loading" ? "ready" : s));
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("failed");
          setError("PayPal didn't load. Check your connection and reload the page.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sdk, save]);

  async function payByCard() {
    const session = cardSession.current;
    if (!session) return;
    setError(null);
    setSubmitting(true);
    try {
      let orderId: string;
      try {
        orderId = await createOrder("card");
      } catch {
        return;
      }
      const result = await session.submit(orderId).catch(() => undefined);
      const outcome = submitOutcome(result, orderId);
      if (outcome.kind === "capture") await capture(outcome.orderId);
      else {
        setStatus("ready");
        setError(outcome.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function payWithPayPal() {
    const session = paypalSession.current;
    if (!session) return;
    setError(null);
    // The order promise goes straight to start() so PayPal opens inside the click.
    session.start({ presentationMode: "auto" }, createOrder("paypal").then((orderId) => ({ orderId }))).catch(() => {
      setError((e) => e ?? "PayPal couldn't finish. Nothing was charged.");
    });
  }

  const capValid = !save || (Number(cap) >= 1 && Number(cap) <= 1000);
  const capLabel = `$${Number(cap || 0).toFixed(2)}`;

  return (
    <div className="stack" data-sdk="v6">
      <section className="consent stack-sm">
        <label className="check-row">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save this payment method for reorders I approve
        </label>
        {save && (
          <>
            <div className="cap-input">
              <label htmlFor="cap">Cap per reorder</label>
              <span>$</span>
              <input id="cap" type="number" min="1" max="1000" step="1" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
            <ul>
              {consentTemplate.map((l) => (
                <li key={l}>{l.replace("{cap}", capLabel)}</li>
              ))}
            </ul>
          </>
        )}
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

      <div className="pay-box stack-sm" style={{ pointerEvents: capValid && status !== "paying" ? "auto" : "none", opacity: capValid ? 1 : 0.5 }}>
        <div className="paypal-area">
          <paypal-button type="pay" hidden={paypalReady !== "yes"} onClick={payWithPayPal} style={{ width: "100%", display: paypalReady === "yes" ? "block" : "none" }} />
        </div>
        {status === "loading" && <div className="skeleton" style={{ height: "3rem" }} />}
        {paypalReady === "no" && <p className="small muted">PayPal isn&apos;t available here. Pay by card.</p>}
        <div className="or">or pay by card</div>
        <div className={`card-fields stack-sm${cardReady === "pending" ? " pending" : ""}`} hidden={cardReady === "no"}>
          <div ref={nameEl} className="field-slot" />
          <div ref={numberEl} className="field-slot" />
          <div className="field-row">
            <div ref={expiryEl} className="field-slot" />
            <div ref={cvvEl} className="field-slot" />
          </div>
          <button className="btn block" disabled={cardReady !== "yes" || status === "paying" || submitting} onClick={payByCard}>
            Pay {amountLabel} by card
          </button>
        </div>
        {cardReady === "no" && <p className="small muted">Card payment isn&apos;t available here. Use PayPal.</p>}
        <p className="small muted">This checkout runs on PayPal&apos;s JS SDK v6.</p>
      </div>
    </div>
  );
}
