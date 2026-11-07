import { appToday } from "@/lib/app/dates";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { recordPaid, recordSavedMethod, sourceDetails } from "@/lib/app/payments";
import { singleFlight } from "@/lib/app/single-flight";
import { indexAdd, loadSession, updateSession } from "@/lib/app/store";
import { buildRequestId, captureOrder, getPayPalClient, InstrumentDeclinedError, isPaid } from "@/lib/paypal";

/**
 * Capture after the shopper approved in the PayPal buttons. Success is read
 * from the capture status. With save on, the vaulted method is stored with
 * the agreement the shopper accepted.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { intentId, orderId } = await readJsonBody<{ intentId?: string; orderId?: string }>(request);
    const state = loadSession(sid);
    const intent = state.intents.find((i) => i.id === intentId);
    if (!intent || !intent.order || intent.order.id !== orderId) throw new HttpError(404, "No such order for this purchase.");
    if (intent.receiptId) return Response.json({ receiptId: intent.receiptId });
    const requestId = buildRequestId("capture", orderId);
    let outcome;
    try {
      outcome = await singleFlight(requestId, () => captureOrder(getPayPalClient(), orderId!, { requestId }));
    } catch (e) {
      if (e instanceof InstrumentDeclinedError) {
        throw new HttpError(402, "PayPal declined that funding source. Pick another one in the PayPal window.", { issue: "INSTRUMENT_DECLINED", restart: true });
      }
      throw e;
    }
    if (!isPaid(outcome) && outcome.captureStatus !== "PENDING") {
      throw new HttpError(402, `The payment was ${outcome.captureStatus.toLowerCase()}. Nothing was charged. Try another card or PayPal.`, { captureStatus: outcome.captureStatus, orderId });
    }
    const order = intent.order;
    const result = await updateSession(sid, (s) => {
      const today = appToday(s.dayOffset);
      const method = order.save ? recordSavedMethod(s, outcome, { funding: order.funding, capCents: order.capCents, currency: intent.currency, replacesMethodId: intent.replacesMethodId }) : undefined;
      const details = { ...sourceDetails(s, intent.source), amountCents: intent.amountCents };
      const label = method?.label ?? (outcome.payer?.type === "card" ? `Card ending ${outcome.payer.lastDigits ?? ""}`.trim() : "PayPal");
      const { receipt } = recordPaid(s, intent.source, details, { outcome, requestId, kind: "first-purchase", methodLabel: label, methodId: method?.id }, today);
      receipt.savedMethodId = method?.id;
      const i = s.intents.find((x) => x.id === intent.id);
      if (i) i.receiptId = receipt.id;
      return { receipt, method, vaultStatus: outcome.vault?.status };
    });
    if (outcome.captureId) await indexAdd("capture", outcome.captureId, sid);
    if (result.method) await indexAdd("token", result.method.vaultId, sid);
    return Response.json({ receiptId: result.receipt.id, savedMethod: result.method?.label ?? null, vaultStatus: result.vaultStatus ?? null, saveRequested: order.save });
  });
}
