import { describe, expect, it, vi } from "vitest";
import {
  CaptureDeclinedError,
  FundingSourceNotSavableError,
  InstrumentDeclinedError,
  NegativeTestingDisabledError,
  OrderNotApprovedError,
  PayPalClient,
  RebuyCapExceededError,
  WebhookEventLog,
  assertCaptureNotDeclined,
  buildRequestId,
  checkRebuyCap,
  isPaid,
  purchaseUnit,
  readCapture,
  rebuy,
  rebuyOrderBody,
  rebuyRequestId,
  verificationBody,
  type PayPalOrder,
} from "./index";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const i = init ?? {};
    calls.push({ url, init: i });
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse(200, { access_token: "tok", expires_in: 32400 });
    return handler(url, i);
  });
  return { fn, calls };
}

const creds = { clientId: "id", clientSecret: "secret" };

describe("idempotency keys", () => {
  it("is deterministic and keyed by item and cycle", () => {
    expect(rebuyRequestId("CeraVe Cream 16oz", "2026-11")).toBe("rebuy:cerave-cream-16oz:2026-11");
    expect(rebuyRequestId("cerave-cream-16oz", "2026-11")).toBe(rebuyRequestId("CeraVe Cream 16oz", "2026-11"));
    expect(rebuyRequestId("x", 1)).not.toBe(rebuyRequestId("x", 2));
  });

  it("hashes ids that would be too long and rejects empty parts", () => {
    const long = buildRequestId("rebuy", "a".repeat(300), "c");
    expect(long.length).toBeLessThanOrEqual(64);
    expect(buildRequestId("rebuy", "s".repeat(24), "staple:sh-ha:2026-11-13", "78a0603885761893t", "live").length).toBeLessThanOrEqual(64);
    expect(long).toBe(buildRequestId("rebuy", "a".repeat(300), "c"));
    expect(() => buildRequestId("rebuy", "!!!")).toThrow();
  });
});

describe("capture status", () => {
  const declined: PayPalOrder = {
    id: "ORDER1",
    status: "COMPLETED",
    purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "DECLINED", processor_response: { response_code: "0500" } }] } }],
  };

  it("treats a COMPLETED order with a DECLINED capture as not paid", () => {
    const outcome = readCapture(declined);
    expect(outcome.orderStatus).toBe("COMPLETED");
    expect(outcome.captureStatus).toBe("DECLINED");
    expect(isPaid(outcome)).toBe(false);
    expect(() => assertCaptureNotDeclined(outcome)).toThrow(CaptureDeclinedError);
  });

  it("reads amount, network reference and vault id from a completed card order", () => {
    const outcome = readCapture({
      id: "O2",
      status: "COMPLETED",
      payment_source: { card: { attributes: { vault: { id: "V1", status: "VAULTED", customer: { id: "c1" } } } } },
      purchase_units: [{ payments: { captures: [{ id: "C2", status: "COMPLETED", amount: { currency_code: "CAD", value: "24.00" }, network_transaction_reference: { id: "N1", network: "VISA" } }] } }],
    });
    expect(isPaid(outcome)).toBe(true);
    expect(outcome.amountCents).toBe(2400);
    expect(outcome.vault).toEqual({ id: "V1", status: "VAULTED", customerId: "c1", type: "card" });
    expect(outcome.networkReference?.id).toBe("N1");
  });

  it("reports NONE when there is no capture yet", () => {
    const outcome = readCapture({ id: "O3", status: "PAYER_ACTION_REQUIRED" });
    expect(outcome.captureStatus).toBe("NONE");
    expect(isPaid(outcome)).toBe(false);
  });
});

describe("purchase unit", () => {
  it("sends item lines whose total matches the amount", () => {
    const pu = purchaseUnit({ referenceId: "r", currency: "CAD", items: [{ sku: "a", name: "A", unitCents: 1250, quantity: 2 }, { sku: "b", name: "B", unitCents: 99 }] });
    expect(pu.amount.value).toBe("25.99");
    expect(pu.amount.breakdown.item_total.value).toBe("25.99");
    expect(pu.items[0]).toMatchObject({ quantity: "2", unit_amount: { value: "12.50" } });
  });
});

describe("rebuy", () => {
  const input = { itemId: "cerave-16oz", cycle: "2026-11", title: "CeraVe Moisturizing Cream 16 oz", unitCents: 2400, currency: "CAD", capCents: 3000, method: { type: "card" as const, vaultId: "V1" } };

  it("is customer-initiated on the saved method", () => {
    const body = rebuyOrderBody(input);
    expect(body.payment_source).toEqual({
      card: { vault_id: "V1", stored_credential: { payment_initiator: "CUSTOMER", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } },
    });
    const wallet = rebuyOrderBody({ ...input, method: { type: "paypal", vaultId: "W1" } });
    expect(wallet.payment_source).toEqual({ paypal: { vault_id: "W1", stored_credential: { payment_initiator: "CUSTOMER", usage: "SUBSEQUENT" } } });
  });

  it("refuses a rebuy above the cap without calling PayPal", async () => {
    const { fn } = fakeFetch(() => jsonResponse(500, {}));
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await expect(rebuy(client, { ...input, capCents: 2000 })).rejects.toBeInstanceOf(RebuyCapExceededError);
    expect(fn).not.toHaveBeenCalled();
    expect(() => checkRebuyCap(100, 0)).toThrow(RebuyCapExceededError);
    expect(() => checkRebuyCap(3000, 3000)).not.toThrow();
  });

  it("sends the item-and-cycle request id and returns a receipt", async () => {
    const { fn, calls } = fakeFetch(() =>
      jsonResponse(201, { id: "O9", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "C9", status: "COMPLETED", amount: { currency_code: "CAD", value: "24.00" } }] } }] }),
    );
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    const receipt = await rebuy(client, input);
    expect(receipt.captureId).toBe("C9");
    expect(receipt.requestId).toBe("rebuy:cerave-16oz:2026-11");
    const orderCall = calls.find((c) => c.url.endsWith("/v2/checkout/orders"));
    expect((orderCall?.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("rebuy:cerave-16oz:2026-11");
  });

  it("raises a typed error for INSTRUMENT_DECLINED", async () => {
    const { fn } = fakeFetch(() => jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "x", details: [{ issue: "INSTRUMENT_DECLINED" }] }));
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await expect(rebuy(client, input)).rejects.toBeInstanceOf(InstrumentDeclinedError);
  });
});

describe("client", () => {
  it("caches the OAuth token across requests", async () => {
    const { fn, calls } = fakeFetch(() => jsonResponse(200, { id: "x", status: "CREATED" }));
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await client.request({ method: "GET", path: "/v2/checkout/orders/1" });
    await client.request({ method: "GET", path: "/v2/checkout/orders/2" });
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("refreshes the token when it is about to expire", async () => {
    let t = 0;
    const { fn, calls } = fakeFetch(() => jsonResponse(200, {}));
    const client = new PayPalClient({ credentials: creds, fetch: fn, now: () => t });
    await client.accessToken();
    t = 32400 * 1000 - 30_000;
    await client.accessToken();
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("requires a PayPal-Request-Id on POST", async () => {
    const { fn } = fakeFetch(() => jsonResponse(200, {}));
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await expect(client.request({ method: "POST", path: "/v2/checkout/orders", body: {} })).rejects.toThrow(/PayPal-Request-Id/);
  });

  it("only sends a mock response header when the demo flag is on", async () => {
    const { fn, calls } = fakeFetch(() => jsonResponse(200, {}));
    const off = new PayPalClient({ credentials: creds, fetch: fn, env: {} as NodeJS.ProcessEnv });
    await expect(off.request({ method: "POST", path: "/v2/checkout/orders", requestId: "r", body: {}, mockApplicationCode: "INSTRUMENT_DECLINED" })).rejects.toBeInstanceOf(NegativeTestingDisabledError);
    const on = new PayPalClient({ credentials: creds, fetch: fn, env: { DEMO_NEGATIVE_TESTING: "1" } as unknown as NodeJS.ProcessEnv });
    await on.request({ method: "POST", path: "/v2/checkout/orders", requestId: "r", body: {}, mockApplicationCode: "INSTRUMENT_DECLINED" });
    const last = calls.at(-1)!;
    expect((last.init.headers as Record<string, string>)["PayPal-Mock-Response"]).toBe('{"mock_application_codes":"INSTRUMENT_DECLINED"}');
  });

  it("classifies wallet funding and approval errors", async () => {
    const { fn } = fakeFetch((url) =>
      url.includes("/capture")
        ? jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "x", details: [{ issue: "ORDER_NOT_APPROVED" }] })
        : jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "x", details: [{ issue: "INVALID_SELECTED_FUNDING_SOURCE" }] }),
    );
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await expect(client.request({ method: "POST", path: "/v2/checkout/orders/1/capture", requestId: "a", body: {} })).rejects.toBeInstanceOf(OrderNotApprovedError);
    await expect(client.request({ method: "POST", path: "/v3/vault/payment-tokens", requestId: "b", body: {} })).rejects.toBeInstanceOf(FundingSourceNotSavableError);
  });

  it("never sends requests anywhere but the sandbox", async () => {
    const { fn } = fakeFetch(() => jsonResponse(200, {}));
    const client = new PayPalClient({ credentials: creds, fetch: fn });
    await expect(client.request({ method: "GET", path: "https://api-m.paypal.com/v2/checkout/orders/1" })).rejects.toThrow(/sandbox/);
  });
});

describe("webhooks", () => {
  const headers = new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-transmission-id": "t1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-07T00:00:00Z",
  });

  it("splices the raw event into the verification body unchanged", () => {
    const raw = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"24.00"}}}';
    const body = verificationBody(headers, raw, "WEBHOOK")!;
    const parsed = JSON.parse(body);
    expect(parsed.webhook_id).toBe("WEBHOOK");
    expect(parsed.transmission_id).toBe("t1");
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
  });

  it("returns nothing when a transmission header is missing", () => {
    expect(verificationBody(new Headers(), "{}", "W")).toBeUndefined();
  });

  it("handles each event id once", () => {
    const log = new WebhookEventLog(2);
    expect(log.record("e1", "A")).toBe(true);
    expect(log.record("e1", "A")).toBe(false);
    log.record("e2", "B");
    log.record("e3", "C");
    expect(log.record("e1", "A")).toBe(true);
  });
});

describe("webhook verify request id", () => {
  it("covers the body as well as the transmission id, so a replayed id with another body is verified afresh", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");
    const ids: string[] = [];
    const client = { request: async (req: { requestId?: string }) => (ids.push(req.requestId!), { status: 200, body: { verification_status: "FAILURE" } }) };
    const headers = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-transmission-id": "T-1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-08T00:00:00Z" });
    const real = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" });
    const forged = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.REFUNDED" });
    await verifyWebhookSignature(client as never, { headers, rawBody: real, webhookId: "W" });
    await verifyWebhookSignature(client as never, { headers, rawBody: forged, webhookId: "W" });
    await verifyWebhookSignature(client as never, { headers, rawBody: real, webhookId: "W" });
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[0].length).toBeLessThanOrEqual(64);
  });
});
