/**
 * Sandbox smoke test for the PayPal module. It moves sandbox money only, so it
 * runs only when PAYPAL_SMOKE=1. Prints ids and statuses, never credentials.
 *
 *   PAYPAL_SMOKE=1 DEMO_NEGATIVE_TESTING=1 npm run smoke:paypal
 *
 * Optional: SMOKE_WALLET_ORDER_ID=<a captured wallet order saved for later>
 * also runs a rebuy on that saved PayPal wallet and refunds it.
 */
import { loadEnv } from "./lib/env";
import {
  CaptureDeclinedError,
  InstrumentDeclinedError,
  PayPalApiError,
  RebuyCapExceededError,
  assertCaptureNotDeclined,
  buildRequestId,
  createCardOrder,
  deletePaymentToken,
  freshRequestId,
  getOrder,
  getPaymentToken,
  getPayPalClient,
  isPaid,
  negativeTestingEnabled,
  readCapture,
  rebuy,
  refundCapture,
  type CardInput,
} from "../lib/paypal";

loadEnv();

if (process.env.PAYPAL_SMOKE !== "1") {
  console.log("Skipped: set PAYPAL_SMOKE=1 to run the PayPal sandbox smoke test.");
  process.exit(0);
}

// PayPal's published sandbox test card (Visa). Not a real card.
const TEST_CARD: CardInput = {
  name: "Sandbox Shopper",
  number: "4012888888881881",
  expiry: "2030-12",
  securityCode: "123",
  billingAddress: { address_line_1: "100 Queen St W", admin_area_2: "Toronto", admin_area_1: "ON", postal_code: "M5H 2N2", country_code: "CA" },
};

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`);
}

async function main() {
  const client = getPayPalClient();
  const run = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  // PayPal customer ids are short; keep this under 22 characters.
  const customerId = `slsmoke${run.slice(2)}`;
  const item = { sku: "cerave-moisturizing-cream-16oz", name: "CeraVe Moisturizing Cream 16 oz", unitCents: 2400 };

  // 1. First purchase by card, saved for later.
  const first = await createCardOrder(client, {
    lines: { referenceId: `first-${run}`, currency: "CAD", description: "First purchase", items: [item] },
    card: TEST_CARD,
    saveForLater: { customerId },
    requestId: buildRequestId("checkout", customerId, item.sku),
  });
  record("card checkout + save", isPaid(first) && first.vault?.status === "VAULTED", `order ${first.orderId} ${first.orderStatus}, capture ${first.captureId} ${first.captureStatus}, vault ${first.vault?.status ?? "none"}`);
  const vaultId = first.vault?.id;
  if (!vaultId || !first.captureId) throw new Error("no vault id or capture from the first purchase");

  // 2. Customer-initiated rebuy on the saved card, keyed by item and cycle.
  const cycle = `smoke-${run}`;
  const rebuyInput = { itemId: item.sku, cycle, title: item.name, unitCents: item.unitCents, currency: "CAD", capCents: 3000, method: { type: "card" as const, vaultId } };
  const receipt = await rebuy(client, rebuyInput);
  record("rebuy (customer-initiated, saved card)", isPaid(receipt), `order ${receipt.orderId}, capture ${receipt.captureId} ${receipt.captureStatus}, request id ${receipt.requestId}`);

  // 3. Same item and cycle again: PayPal answers from the idempotency store, no second charge.
  const again = await rebuy(client, rebuyInput);
  record("rebuy retried with same item+cycle", again.orderId === receipt.orderId && again.captureId === receipt.captureId, `order ${again.orderId}, capture ${again.captureId}`);

  // 4. Above the cap: refused locally.
  try {
    await rebuy(client, { ...rebuyInput, cycle: `${cycle}-cap`, capCents: 2000 });
    record("rebuy above cap refused", false, "charged");
  } catch (e) {
    record("rebuy above cap refused", e instanceof RebuyCapExceededError, (e as Error).name);
  }

  // 5. Refunds: partial on the first purchase, full on the rebuy.
  const partial = await refundCapture(client, first.captureId, { requestId: buildRequestId("refund", first.captureId, "partial"), amountCents: 1000, currency: "CAD" });
  record("partial refund", partial.status === "COMPLETED", `refund ${partial.refundId} ${partial.status} ${partial.amountCents}`);
  const full = await refundCapture(client, receipt.captureId!, { requestId: buildRequestId("refund", receipt.captureId!, "full") });
  record("full refund", full.status === "COMPLETED", `refund ${full.refundId} ${full.status} ${full.amountCents}`);

  // 6. Processor decline: HTTP 201, order COMPLETED, capture DECLINED.
  const declined = await createCardOrder(client, {
    lines: { referenceId: `decline-${run}`, currency: "CAD", items: [item] },
    card: { ...TEST_CARD, name: "CCREJECT-REFUSED" },
    requestId: freshRequestId("checkout"),
  });
  let caught = false;
  try {
    assertCaptureNotDeclined(declined);
  } catch (e) {
    caught = e instanceof CaptureDeclinedError;
  }
  record("processor decline read from capture", !isPaid(declined) && caught, `order ${declined.orderId} ${declined.orderStatus}, capture ${declined.captureStatus}`);

  // 7. Simulated INSTRUMENT_DECLINED on a rebuy (negative testing).
  if (negativeTestingEnabled()) {
    try {
      await rebuy(client, { ...rebuyInput, cycle: `${cycle}-declined`, mockApplicationCode: "INSTRUMENT_DECLINED" });
      record("simulated decline on rebuy", false, "charged");
    } catch (e) {
      record("simulated decline on rebuy", e instanceof InstrumentDeclinedError, (e as Error).name);
    }
  } else {
    console.log("SKIP  simulated decline on rebuy (DEMO_NEGATIVE_TESTING is off)");
  }

  // 8. Optional: rebuy on a saved PayPal wallet.
  const walletOrderId = process.env.SMOKE_WALLET_ORDER_ID;
  if (walletOrderId) {
    const walletVault = readCapture(await getOrder(client, walletOrderId)).vault;
    if (walletVault?.type === "paypal") {
      const w = await rebuy(client, { ...rebuyInput, cycle: `${cycle}-wallet`, method: { type: "paypal", vaultId: walletVault.id } });
      record("rebuy (customer-initiated, saved PayPal wallet)", isPaid(w), `order ${w.orderId}, capture ${w.captureId} ${w.captureStatus}`);
      const wr = await refundCapture(client, w.captureId!, { requestId: buildRequestId("refund", w.captureId!, "full") });
      record("wallet rebuy refunded", wr.status === "COMPLETED", `refund ${wr.refundId} ${wr.status}`);
    } else {
      record("rebuy (saved PayPal wallet)", false, `order ${walletOrderId} shows no saved wallet`);
    }
  }

  // 9. Revoke the saved card; it should be gone.
  await deletePaymentToken(client, vaultId);
  try {
    await getPaymentToken(client, vaultId);
    record("revoke saved card", false, "token still readable");
  } catch (e) {
    record("revoke saved card", e instanceof PayPalApiError && e.status === 404, `GET after delete -> ${(e as PayPalApiError).status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  const err = e as PayPalApiError;
  console.error(`FAIL  ${err.name}: ${err.message}${err.debugId ? ` (debug id ${err.debugId})` : ""}`);
  process.exit(1);
});
