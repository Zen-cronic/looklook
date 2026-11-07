import type { PayPalClient } from "./client";
import { CaptureDeclinedError } from "./errors";
import { money, toCents, type Money } from "./money";

export interface LineItem {
  /** Our item id; also sent as the PayPal SKU. */
  sku: string;
  name: string;
  unitCents: number;
  quantity?: number;
}

export interface OrderLines {
  referenceId: string;
  currency: string;
  items: LineItem[];
  description?: string;
}

export interface CardInput {
  name: string;
  number: string;
  expiry: string;
  securityCode: string;
  billingAddress: {
    address_line_1: string;
    admin_area_2: string;
    admin_area_1: string;
    postal_code: string;
    country_code: string;
  };
}

export interface ExperienceContext {
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}

/** Orders v2 response, only the fields LookLook reads. */
export interface PayPalOrder {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string; method?: string }>;
  payment_source?: {
    card?: { last_digits?: string; brand?: string; attributes?: { vault?: VaultResult } };
    paypal?: { email_address?: string; attributes?: { vault?: VaultResult } };
  };
  purchase_units?: Array<{
    reference_id?: string;
    payments?: { captures?: Capture[] };
  }>;
}

export interface VaultResult {
  id?: string;
  status?: string;
  customer?: { id?: string };
}

export interface Capture {
  id: string;
  status: string;
  amount?: Money;
  network_transaction_reference?: { id: string; network?: string };
  processor_response?: { response_code?: string };
}

export function orderTotalCents(lines: OrderLines): number {
  return lines.items.reduce((sum, i) => sum + i.unitCents * (i.quantity ?? 1), 0);
}

/** A purchase unit with item lines, so the buyer's PayPal activity shows what was bought. */
export function purchaseUnit(lines: OrderLines) {
  const total = orderTotalCents(lines);
  return {
    reference_id: lines.referenceId,
    description: lines.description,
    amount: {
      ...money(total, lines.currency),
      breakdown: { item_total: money(total, lines.currency) },
    },
    items: lines.items.map((i) => ({
      name: i.name.slice(0, 127),
      sku: i.sku.slice(0, 127),
      quantity: String(i.quantity ?? 1),
      unit_amount: money(i.unitCents, lines.currency),
      category: "PHYSICAL_GOODS",
    })),
  };
}

export type CaptureState = "COMPLETED" | "DECLINED" | "PENDING" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "NONE" | string;

export interface CaptureOutcome {
  orderId: string;
  orderStatus: string;
  captureId?: string;
  captureStatus: CaptureState;
  amountCents?: number;
  currency?: string;
  networkReference?: { id: string; network?: string };
  processorResponseCode?: string;
  vault?: { id: string; status?: string; customerId?: string; type: "card" | "paypal" };
}

/**
 * Read the result of a payment from the capture, not from the order. A
 * processor decline comes back as HTTP 201 with the order COMPLETED and the
 * capture DECLINED.
 */
export function readCapture(order: PayPalOrder): CaptureOutcome {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  const cardVault = order.payment_source?.card?.attributes?.vault;
  const walletVault = order.payment_source?.paypal?.attributes?.vault;
  const vault = cardVault?.id
    ? { id: cardVault.id, status: cardVault.status, customerId: cardVault.customer?.id, type: "card" as const }
    : walletVault?.id
      ? { id: walletVault.id, status: walletVault.status, customerId: walletVault.customer?.id, type: "paypal" as const }
      : undefined;
  return {
    orderId: order.id,
    orderStatus: order.status,
    captureId: capture?.id,
    captureStatus: capture?.status ?? "NONE",
    amountCents: capture?.amount ? toCents(capture.amount.value) : undefined,
    currency: capture?.amount?.currency_code,
    networkReference: capture?.network_transaction_reference,
    processorResponseCode: capture?.processor_response?.response_code,
    vault,
  };
}

/** True only when money actually moved. */
export function isPaid(outcome: CaptureOutcome): boolean {
  return outcome.captureStatus === "COMPLETED";
}

/** Throw unless the capture completed. PENDING is returned to the caller to show as pending. */
export function assertCaptureNotDeclined(outcome: CaptureOutcome): CaptureOutcome {
  if (outcome.captureStatus === "DECLINED" || outcome.captureStatus === "FAILED") {
    throw new CaptureDeclinedError(outcome.orderId, outcome.captureId, outcome.processorResponseCode);
  }
  return outcome;
}

export function payerActionUrl(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}

/** Checkout with the PayPal wallet. The buyer approves at the returned link, then we capture. */
export async function createWalletOrder(
  client: PayPalClient,
  input: { lines: OrderLines; experience: ExperienceContext; saveForLater?: boolean; requestId: string },
) {
  const paypal: Record<string, unknown> = {
    experience_context: {
      brand_name: input.experience.brandName ?? "LookLook",
      return_url: input.experience.returnUrl,
      cancel_url: input.experience.cancelUrl,
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
    },
  };
  if (input.saveForLater) {
    paypal.attributes = { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } };
  }
  const res = await client.request<PayPalOrder>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: input.requestId,
    body: { intent: "CAPTURE", purchase_units: [purchaseUnit(input.lines)], payment_source: { paypal } },
  });
  return { order: res.body, approveUrl: payerActionUrl(res.body) };
}

/** Card checkout. Card orders capture in the same call; read the capture status. */
export async function createCardOrder(
  client: PayPalClient,
  input: { lines: OrderLines; card: CardInput; saveForLater?: { customerId: string }; requestId: string; mockApplicationCode?: string },
): Promise<CaptureOutcome> {
  const card: Record<string, unknown> = {
    name: input.card.name,
    number: input.card.number,
    expiry: input.card.expiry,
    security_code: input.card.securityCode,
    billing_address: input.card.billingAddress,
  };
  if (input.saveForLater) {
    card.attributes = { vault: { store_in_vault: "ON_SUCCESS" }, customer: { id: input.saveForLater.customerId } };
  }
  const res = await client.request<PayPalOrder>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: input.requestId,
    mockApplicationCode: input.mockApplicationCode,
    body: { intent: "CAPTURE", purchase_units: [purchaseUnit(input.lines)], payment_source: { card } },
  });
  return readCapture(res.body);
}

export async function captureOrder(
  client: PayPalClient,
  orderId: string,
  opts: { requestId: string; mockApplicationCode?: string },
): Promise<CaptureOutcome> {
  const res = await client.request<PayPalOrder>({
    method: "POST",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    requestId: opts.requestId,
    mockApplicationCode: opts.mockApplicationCode,
    body: {},
  });
  return readCapture(res.body);
}

export async function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  const res = await client.request<PayPalOrder>({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}` });
  return res.body;
}
