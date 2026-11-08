import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signChannel3 } from "../channel3/webhooks";

const env = { ...process.env };
const SECRET = `whsec_${Buffer.from("webhook-test-secret-0123").toString("base64")}`;

beforeAll(() => {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "webhook-data-"));
  process.env.CHANNEL3_WEBHOOK_SECRET = SECRET;
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
});
afterAll(() => {
  process.env = env;
});
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./watch");
  vi.doUnmock("./paypal-events");
  vi.doUnmock("../paypal");
});

/** Throws on the first call only, as a disk error or a bad session file would. */
function failOnce<T extends (...a: never[]) => unknown>(real: T) {
  let calls = 0;
  const fn = (...a: Parameters<T>) => {
    calls += 1;
    if (calls === 1) throw new Error("disk full");
    return real(...a);
  };
  return { fn, calls: () => calls };
}

describe("a webhook is handled once, and only after its effect is applied", () => {
  it("Channel3: a failed apply answers 500, the redelivery applies it, a later copy is a duplicate", async () => {
    const real = await import("./watch");
    const flaky = failOnce(real.applyPriceEvent);
    vi.doMock("./watch", () => ({ ...real, applyPriceEvent: flaky.fn }));
    const store = await import("./store");
    await store.indexAdd("subscription", "sub_wh", "webhooksession01");
    const { POST } = await import("../../app/api/webhooks/channel3/route");
    const body = JSON.stringify({ id: "evt_wh_1", timestamp: new Date().toISOString(), type: "offer.price.changed", data: { subscription_id: "sub_wh", current: { price: 10, currency: "USD" } } });
    const deliver = () => {
      const ts = Math.floor(Date.now() / 1000);
      return POST(new Request("http://localhost/api/webhooks/channel3", { method: "POST", body, headers: { "svix-id": "msg_wh", "svix-timestamp": String(ts), "svix-signature": `v1,${signChannel3(SECRET, "msg_wh", ts, body)}` } }));
    };
    const first = await deliver();
    expect(first.status).toBeGreaterThanOrEqual(500);
    const second = await deliver();
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(false);
    expect(flaky.calls()).toBe(2);
    const third = await deliver();
    expect((await third.json()).duplicate).toBe(true);
    expect(flaky.calls()).toBe(2);
    const logged = store.listEvents(10).filter((e) => e.eventId === "evt_wh_1");
    expect(logged.some((e) => e.effect && !e.duplicate)).toBe(true);
  });

  it("PayPal: a failed apply answers 500 so PayPal redelivers, and the redelivery is applied", async () => {
    const paypal = await import("../paypal");
    vi.doMock("../paypal", () => ({ ...paypal, getPayPalClient: () => ({}), verifyWebhookSignature: async () => ({ verified: true, eventId: "WH-RETRY-1", eventType: "PAYMENT.CAPTURE.COMPLETED" }) }));
    const real = await import("./paypal-events");
    const flaky = failOnce(real.applyPayPalEvent);
    vi.doMock("./paypal-events", () => ({ ...real, applyPayPalEvent: flaky.fn }));
    const store = await import("./store");
    await store.indexAdd("capture", "CAP-RETRY", "webhooksession02");
    const { POST } = await import("../../app/api/webhooks/paypal/route");
    const body = JSON.stringify({ id: "WH-RETRY-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-RETRY", status: "COMPLETED" } });
    const deliver = () => POST(new Request("http://localhost/api/webhooks/paypal", { method: "POST", body }));
    expect((await deliver()).status).toBeGreaterThanOrEqual(500);
    const again = await deliver();
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(false);
    expect((await (await deliver()).json()).duplicate).toBe(true);
    expect(flaky.calls()).toBe(2);
  });
});
