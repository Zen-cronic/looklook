import { APP_NAME } from "../brand";
import type { PayPalClient } from "./client";
import type { CardInput, ExperienceContext } from "./orders";

export interface SetupToken {
  id: string;
  status: string;
  customer?: { id: string };
  links?: Array<{ href: string; rel: string }>;
}

export interface PaymentToken {
  id: string;
  customer?: { id: string };
  payment_source?: {
    card?: { last_digits?: string; brand?: string; expiry?: string; verification_status?: string };
    paypal?: { email_address?: string };
  };
}

/** Plain consent text shown before a method is saved. Kept with the code that saves it. */
export const SAVE_FOR_LATER_CONSENT =
  `Save this payment method with PayPal so ${APP_NAME} can rebuy items you approve. ` +
  "Each rebuy asks for your yes, stays under the cap you set, and you get a notice after every charge. " +
  "You can remove the saved method at any time in Saved methods.";

export type SetupSource =
  | { type: "card"; card?: CardInput }
  | { type: "paypal"; experience: ExperienceContext; description?: string };

/** Start saving a method without a purchase. A PayPal setup token needs the buyer's approval. */
export async function createSetupToken(
  client: PayPalClient,
  input: { source: SetupSource; customerId?: string; requestId: string },
): Promise<{ token: SetupToken; approveUrl?: string }> {
  let payment_source: Record<string, unknown>;
  if (input.source.type === "card") {
    const c = input.source.card;
    payment_source = {
      card: c
        ? {
            name: c.name,
            number: c.number,
            expiry: c.expiry,
            security_code: c.securityCode,
            billing_address: c.billingAddress,
            experience_context: { brand_name: APP_NAME },
          }
        : {},
    };
  } else {
    payment_source = {
      paypal: {
        description: input.source.description ?? `${APP_NAME}: rebuy staples you approve`,
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: false,
        experience_context: {
          brand_name: input.source.experience.brandName ?? APP_NAME,
          return_url: input.source.experience.returnUrl,
          cancel_url: input.source.experience.cancelUrl,
          shipping_preference: "NO_SHIPPING",
          vault_instruction: "ON_PAYER_APPROVAL",
        },
      },
    };
  }
  const body: Record<string, unknown> = { payment_source };
  if (input.customerId) body.customer = { id: input.customerId };
  const res = await client.request<SetupToken>({ method: "POST", path: "/v3/vault/setup-tokens", requestId: input.requestId, body });
  return { token: res.body, approveUrl: res.body.links?.find((l) => l.rel === "approve")?.href };
}

export async function getSetupToken(client: PayPalClient, id: string): Promise<SetupToken> {
  return (await client.request<SetupToken>({ method: "GET", path: `/v3/vault/setup-tokens/${encodeURIComponent(id)}` })).body;
}

/** Turn an approved setup token into a saved payment token (the vault id). */
export async function createPaymentToken(client: PayPalClient, setupTokenId: string, requestId: string): Promise<PaymentToken> {
  const res = await client.request<PaymentToken>({
    method: "POST",
    path: "/v3/vault/payment-tokens",
    requestId,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return res.body;
}

export async function getPaymentToken(client: PayPalClient, id: string): Promise<PaymentToken> {
  return (await client.request<PaymentToken>({ method: "GET", path: `/v3/vault/payment-tokens/${encodeURIComponent(id)}` })).body;
}

/**
 * Saved methods for a customer. The list can lag a new save by about a minute,
 * so keep the vault id from the order or token response rather than relying on this.
 */
export async function listPaymentTokens(client: PayPalClient, customerId: string): Promise<PaymentToken[]> {
  const res = await client.request<{ payment_tokens?: PaymentToken[] }>({
    method: "GET",
    path: "/v3/vault/payment-tokens",
    query: { customer_id: customerId },
  });
  return res.body?.payment_tokens ?? [];
}

/** Revoke: remove the saved method so no further rebuys can use it. */
export async function deletePaymentToken(client: PayPalClient, id: string): Promise<void> {
  await client.request<unknown>({ method: "DELETE", path: `/v3/vault/payment-tokens/${encodeURIComponent(id)}` });
}
