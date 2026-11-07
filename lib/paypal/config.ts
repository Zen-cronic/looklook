/**
 * LookLook talks to the PayPal sandbox only. There is no switch for live
 * keys: the base URL is fixed here and every request is checked against it.
 */
export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalCredentials {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (sandbox app).");
  }
  return { clientId, clientSecret };
}

/** Negative testing (PayPal-Mock-Response) is only sent when this flag is on. */
export function negativeTestingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_NEGATIVE_TESTING === "1";
}
