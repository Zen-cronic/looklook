/**
 * Pure helpers for the PayPal JS SDK v6 checkout (`/checkout/<id>?sdk=v6`).
 * The v5 checkout stays the default; v6 is opt-in per visit and has a kill switch.
 */

/** The v6 core script. The app talks to the PayPal sandbox only (see config.ts). */
export const SDK_V6_SCRIPT_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

export type PaymentFlow = "ONE_TIME_PAYMENT" | "VAULT_WITH_PAYMENT";

/** The eligibility flow for the save box: saving during the purchase is VAULT_WITH_PAYMENT. */
export function paymentFlow(save: boolean): PaymentFlow {
  return save ? "VAULT_WITH_PAYMENT" : "ONE_TIME_PAYMENT";
}

export type SubmitOutcome = { kind: "capture"; orderId: string } | { kind: "retry"; message: string };

/**
 * What to do after Card Fields `submit(orderId)`: capture only on `succeeded`.
 * `canceled` is the shopper closing 3-D Secure; `failed` is a declined or invalid card.
 */
export function submitOutcome(result: { state?: string; data?: { orderId?: string; message?: string } } | undefined, orderId: string): SubmitOutcome {
  if (result?.state === "succeeded") return { kind: "capture", orderId: result.data?.orderId ?? orderId };
  if (result?.state === "canceled") return { kind: "retry", message: "Card verification was closed. Nothing was charged." };
  return { kind: "retry", message: "The card couldn't be charged. Check the details or use PayPal." };
}

/**
 * Use the v6 checkout for this visit? Only when asked for with `?sdk=v6` and the
 * kill switch `PAYPAL_SDK_V6=0` is not set. Filming mode stays on v5 unless the
 * visit asks for v6 the same explicit way.
 */
export function wantsSdkV6(opts: { sdk?: string | string[]; env?: string; film?: boolean }): boolean {
  const sdk = Array.isArray(opts.sdk) ? opts.sdk[0] : opts.sdk;
  return sdk === "v6" && opts.env !== "0";
}

/**
 * Both SDK versions put their namespace on `window.paypal`. A loader may reuse
 * what is there only when it is its own version: v5 has `Buttons`, v6 has `createInstance`.
 */
export function sdkFits(ns: unknown, version: "v5" | "v6"): boolean {
  if (!ns || typeof ns !== "object") return false;
  const key = version === "v5" ? "Buttons" : "createInstance";
  return typeof (ns as Record<string, unknown>)[key] === "function";
}
