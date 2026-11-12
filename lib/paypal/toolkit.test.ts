import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// PayPal's own sandbox shapes (GET /v2/checkout/orders/{id} after a capture and a refund, GET /v2/payments/refunds/{id}).
const ORDER_ID = "5O190127TN364715T";
const REFUND_ID = "1JU08902781691411";
const ORDER = {
  id: ORDER_ID,
  status: "COMPLETED",
  intent: "CAPTURE",
  purchase_units: [
    {
      reference_id: "default",
      amount: { currency_code: "USD", value: "32.00" },
      payments: {
        captures: [{ id: "3C679366HH908993F", status: "REFUNDED", amount: { currency_code: "USD", value: "32.00" }, links: [{ href: "https://api.sandbox.paypal.com/v2/payments/captures/3C679366HH908993F/refund", rel: "refund", method: "POST" }] }],
        refunds: [{ id: REFUND_ID, status: "COMPLETED", amount: { currency_code: "USD", value: "32.00" }, links: [{ href: `https://api.sandbox.paypal.com/v2/payments/refunds/${REFUND_ID}`, rel: "self", method: "GET" }] }],
      },
    },
  ],
};
const REFUND = { id: REFUND_ID, status: "COMPLETED", amount: { currency_code: "USD", value: "32.00" } };

/** Stand-in tools shaped like the toolkit's: each records its arguments and answers with a JSON string, as the toolkit does. */
function fakeTools(order: unknown = ORDER, refund: unknown = REFUND) {
  const calls: Array<[string, unknown]> = [];
  const tool = (name: string, answer: unknown) => ({
    parameters: { parse: (x: unknown) => x },
    execute: async (args: unknown) => {
      calls.push([name, args]);
      return JSON.stringify(answer);
    },
  });
  return { calls, tools: { get_order: tool("get_order", order), get_refund: tool("get_refund", refund) } };
}

describe("PayPal Agent Toolkit, read only", () => {
  it("builds the real toolkit with only get_order and get_refund, for the sandbox", async () => {
    const { buildReadOnlyTools, READ_ONLY_TOOLS, toolkitConfiguration } = await import("./toolkit");
    const config = toolkitConfiguration();
    expect(config.context.sandbox).toBe(true);
    expect(config.actions).toEqual({ orders: { get: true }, payments: { getRefunds: true } });
    // Constructing the toolkit makes no request; it only reads the configuration.
    const tools = await buildReadOnlyTools({ clientId: "test-id", clientSecret: "test-secret" });
    expect(Object.keys(tools).sort()).toEqual([...READ_ONLY_TOOLS].sort());
    expect(READ_ONLY_TOOLS).toEqual(["get_order", "get_refund"]);
    // The toolkit's own parameter names: id for an order, refund_id for a refund.
    expect(() => tools.get_order.parameters.parse({ id: ORDER_ID })).not.toThrow();
    expect(() => tools.get_refund.parameters.parse({ refund_id: REFUND_ID })).not.toThrow();
    expect(() => tools.get_order.parameters.parse({ order_id: ORDER_ID })).toThrow();
  });

  it("offers nothing that creates, pays, refunds or acts as the merchant, and refuses a wider tool set", async () => {
    const { ALL_TOOLS_ENABLED, PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
    const { assertReadOnly, toolkitConfiguration } = await import("./toolkit");
    const ours = Object.keys(new PayPalAgentToolkit({ clientId: "a", clientSecret: "b", configuration: toolkitConfiguration() }).getTools());
    const everything = Object.keys(new PayPalAgentToolkit({ clientId: "a", clientSecret: "b", configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } } }).getTools());
    for (const t of ["create_order", "pay_order", "create_refund", "create_invoice", "send_invoice", "create_product", "create_subscription", "accept_dispute_claim", "create_shipment_tracking", "list_transactions"]) {
      expect(everything).toContain(t);
      expect(ours).not.toContain(t);
    }
    expect(() => assertReadOnly({ get_order: {}, get_refund: {}, create_refund: {} })).toThrow(/expected only get_order, get_refund/);
    expect(() => assertReadOnly({ get_order: {}, get_refund: {} })).not.toThrow();
  });

  it("reads the order, then each refund it lists, into one record and one sentence", async () => {
    const { describeRecord, lookUpPayment } = await import("./toolkit");
    const { calls, tools } = fakeTools();
    const record = await lookUpPayment(ORDER_ID, tools);
    expect(calls).toEqual([
      ["get_order", { id: ORDER_ID }],
      ["get_refund", { refund_id: REFUND_ID }],
    ]);
    expect(record).toEqual({
      orderId: ORDER_ID,
      status: "COMPLETED",
      amount: { currency: "USD", value: "32.00" },
      capture: { id: "3C679366HH908993F", status: "REFUNDED", amount: { currency: "USD", value: "32.00" } },
      refunds: [{ id: REFUND_ID, status: "COMPLETED", amount: { currency: "USD", value: "32.00" } }],
    });
    expect(describeRecord("Peptide Serum", record)).toBe(`PayPal's record for Peptide Serum: order ${ORDER_ID} is COMPLETED, $32.00 taken, capture REFUNDED. Refund ${REFUND_ID} COMPLETED, $32.00.`);
    const plain = { ...ORDER, purchase_units: [{ ...ORDER.purchase_units[0], payments: { captures: [{ ...ORDER.purchase_units[0].payments.captures[0], status: "COMPLETED" }] } }] };
    const one = fakeTools(plain);
    const r2 = await lookUpPayment(ORDER_ID, one.tools);
    expect(one.calls.map((c) => c[0])).toEqual(["get_order"]);
    expect(describeRecord("Peptide Serum", r2)).toBe(`PayPal's record for Peptide Serum: order ${ORDER_ID} is COMPLETED, $32.00 taken, capture COMPLETED. No refund.`);
  });

  it("turns the toolkit's error answer into a lookup error", async () => {
    const { lookUpPayment, LookupError } = await import("./toolkit");
    const { tools } = fakeTools({ error: { message: "The specified resource does not exist.", type: "paypal_error" } });
    await expect(lookUpPayment(ORDER_ID, tools)).rejects.toBeInstanceOf(LookupError);
    await expect(lookUpPayment(ORDER_ID, tools)).rejects.toThrow(/does not exist/);
  });

  it("in filming mode names the paid item generically, so the assistant's answer names no brand", async () => {
    const { describeRecord, lookUpPayment, paidOrderFor } = await import("./toolkit");
    const { namesABrand } = await import("../filming/neutral");
    const line = { source: { kind: "staple", shelfItemId: "sh-serum" }, approvalKey: "k1", amountCents: 3200, version: "v1", why: "due", title: "The Ordinary Multi-Peptide + HA Serum", brand: "The Ordinary", category: "skincare", productId: "p1" };
    const state = { weeks: [{ id: "w1", sent: [line], outcomes: {} }], receipts: [{ id: "r1", approvalKey: "k1", status: "paid", orderId: ORDER_ID, captureId: "3C679366HH908993F" }] } as never;
    expect(paidOrderFor(state, "w1", "k1")).toEqual({ orderId: ORDER_ID, title: line.title });
    const film = paidOrderFor(state, "w1", "k1", { film: true });
    expect(film.orderId).toBe(ORDER_ID);
    expect(film.title).not.toMatch(/Ordinary/);
    expect(namesABrand(film.title)).toBeNull();
    const text = describeRecord(film.title, await lookUpPayment(ORDER_ID, fakeTools().tools));
    expect(namesABrand(text)).toBeNull();
    expect(text).toContain(ORDER_ID);
  });

  it("is off when PAYPAL_AGENT_TOOLKIT=0", async () => {
    const { lookupsEnabled } = await import("./toolkit");
    expect(lookupsEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(lookupsEnabled({ PAYPAL_AGENT_TOOLKIT: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(lookupsEnabled({ PAYPAL_AGENT_TOOLKIT: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("is imported only by server code", async () => {
    const { execSync } = await import("node:child_process");
    const { readFileSync } = await import("node:fs");
    const users = execSync("grep -rl --include=*.ts --include=*.tsx 'paypal/toolkit\\|@paypal/agent-toolkit' app lib", { encoding: "utf8" }).trim().split("\n").filter((f) => !f.endsWith(".test.ts"));
    expect(users.sort()).toEqual(["app/api/week/[id]/paypal/route.ts", "lib/paypal/toolkit.ts"]);
    for (const f of users) expect(readFileSync(f, "utf8")).not.toMatch(/^"use client"/m);
  });
});

describe("GET /api/week/[id]/paypal", () => {
  const SECRET = "test-secret-for-sessions";
  const env = { ...process.env };
  let cookieValue: string | undefined;

  beforeAll(() => {
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "paypal-lookup-"));
    process.env.SESSION_SECRET = SECRET;
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  });
  afterAll(() => {
    process.env = env;
  });
  // The first block loaded the real toolkit package: each request here gets fresh modules and the mocked package.
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("next/headers");
    vi.doUnmock("@paypal/agent-toolkit/ai-sdk");
    delete process.env.PAYPAL_AGENT_TOOLKIT;
  });

  /** Mocks the request cookie and the toolkit package; returns what the toolkit was built with and asked. */
  function setUp() {
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }), headers: async () => new Headers() }));
    const built: unknown[] = [];
    const { calls, tools } = fakeTools();
    vi.doMock("@paypal/agent-toolkit/ai-sdk", () => ({
      PayPalAgentToolkit: class {
        constructor(opts: { configuration: unknown }) {
          built.push(opts.configuration);
        }
        getTools() {
          return tools;
        }
      },
    }));
    return { built, calls };
  }

  /** A session whose week paid one item (the serum) with ORDER_ID. */
  async function paidSession() {
    const { newSessionId, signSession } = await import("../app/session-cookie");
    const { updateSession } = await import("../app/store");
    const sid = newSessionId();
    const line = { source: { kind: "check" as const, checkId: "c1" }, approvalKey: "check:c1", amountCents: 3200, version: "", why: "buy" as const, title: "Peptide Serum", brand: "B" };
    await updateSession(sid, (s) => {
      s.weeks = [{ id: "w1", createdAt: "2026-11-12T10:00:00Z", on: "2026-11-12", from: "sample-week", inputs: [], sent: [line], outcomes: {}, watches: [], approvedAt: "2026-11-12T10:00:00Z" }];
      s.receipts.push({ id: "r1", kind: "saved-method", source: line.source, createdAt: "2026-11-12T10:00:00Z", on: "2026-11-12", title: "Peptide Serum", brand: "B", approvalKey: "check:c1", amountCents: 3200, currency: "USD", methodLabel: "Visa", orderId: ORDER_ID, captureStatus: "COMPLETED", requestId: "q1", attempts: 1, status: "completed" } as never);
    });
    return { sid, cookie: await signSession(sid, SECRET) };
  }

  const get = async (runId: string, key: string) => {
    const { GET } = await import("../../app/api/week/[id]/paypal/route");
    const res = await GET(new Request(`http://localhost/api/week/${runId}/paypal?key=${encodeURIComponent(key)}`), { params: Promise.resolve({ id: runId }) } as never);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("answers with PayPal's record for this session's paid item, through the sandbox toolkit", async () => {
    const { built, calls } = setUp();
    const a = await paidSession();
    cookieValue = a.cookie;
    const res = await get("w1", "check:c1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: "check:c1", title: "Peptide Serum", orderId: ORDER_ID, status: "COMPLETED" });
    expect(res.body.text).toContain(`order ${ORDER_ID} is COMPLETED, $32.00 taken`);
    expect(built).toEqual([{ actions: { orders: { get: true }, payments: { getRefunds: true } }, context: { sandbox: true } }]);
    expect(calls[0]).toEqual(["get_order", { id: ORDER_ID }]);
  });

  it("answers 404 for another session's week or item, or an unpaid key, without calling PayPal", async () => {
    const { built, calls } = setUp();
    await paidSession();
    const { newSessionId, signSession } = await import("../app/session-cookie");
    cookieValue = await signSession(newSessionId(), SECRET);
    expect((await get("w1", "check:c1")).status).toBe(404);
    const own = await paidSession();
    cookieValue = own.cookie;
    expect((await get("w1", "check:nope")).status).toBe(404);
    expect((await get("w1", "")).status).toBe(404);
    expect(built).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("answers 503 with PAYPAL_AGENT_TOOLKIT=0, and 401 without a session", async () => {
    const { built, calls } = setUp();
    const a = await paidSession();
    cookieValue = a.cookie;
    process.env.PAYPAL_AGENT_TOOLKIT = "0";
    const off = await get("w1", "check:c1");
    expect(off).toEqual({ status: 503, body: { error: "PayPal lookups are off." } });
    delete process.env.PAYPAL_AGENT_TOOLKIT;
    cookieValue = undefined;
    expect((await get("w1", "check:c1")).status).toBe(401);
    expect(built).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("exports only GET: nothing to post, pay or refund", async () => {
    setUp();
    const route = await import("../../app/api/week/[id]/paypal/route");
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});
