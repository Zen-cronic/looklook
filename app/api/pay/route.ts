import { appToday } from "@/lib/app/dates";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { activeMethod, intentSku, PaymentFlowError, recordDecline, recordPaid, savedMethodRequestId, sourceDetails } from "@/lib/app/payments";
import { parseSource } from "@/lib/app/sources";
import { isInflight, singleFlight } from "@/lib/app/single-flight";
import { indexAdd, loadSession, updateSession } from "@/lib/app/store";
import { formatCents } from "@/lib/app/money";
import { budgetHoldFor } from "@/lib/app/reminders";
import { CaptureDeclinedError, getPayPalClient, InstrumentDeclinedError, negativeTestingEnabled, rebuy, RebuyCapExceededError } from "@/lib/paypal";

/**
 * The shopper said yes on an approval card: a customer-initiated charge on
 * the saved method. The PayPal-Request-Id is built from the shopper, the item
 * and cycle, and the method, so a second tap returns the same order.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ source?: unknown; methodId?: string }>(request);
    const source = parseSource(body.source);
    const state = loadSession(sid);
    const method = body.methodId ? state.methods.find((m) => m.id === body.methodId && m.status === "active") : activeMethod(state);
    if (!method) throw new HttpError(409, "No saved payment method. Pay with PayPal once and save it for rebuys.", { needsCheckout: true });
    let details;
    try {
      details = sourceDetails(state, source);
    } catch (e) {
      if (e instanceof PaymentFlowError) throw new HttpError(400, e.message);
      throw e;
    }
    const hold = budgetHoldFor(state, source);
    if (hold) throw new HttpError(409, hold, { overBudget: true });
    const simulated = state.demo.declineNextRebuy && negativeTestingEnabled();
    if (state.demo.declineNextRebuy) {
      await updateSession(sid, (s) => {
        s.demo.declineNextRebuy = false;
      });
    }
    const requestId = savedMethodRequestId(sid, details.key, method.vaultId, simulated);
    const merged = isInflight(requestId);
    let outcome;
    try {
      outcome = await singleFlight(requestId, () => rebuy(getPayPalClient(), {
        itemId: intentSku({ id: details.key, category: details.category, source }, details.productId),
        cycle: details.key,
        title: details.title,
        unitCents: details.amountCents,
        currency: method.currency,
        capCents: method.capCents,
        method: { type: method.type, vaultId: method.vaultId },
        requestId,
        ...(simulated ? { mockApplicationCode: "INSTRUMENT_DECLINED" } : {}),
      }));
    } catch (e) {
      if (e instanceof RebuyCapExceededError) {
        throw new HttpError(409, `${formatCents(details.amountCents)} is above your ${formatCents(method.capCents)} per-rebuy cap. Nothing was charged. Raise the cap in Saved methods or pay once with PayPal.`, { overCap: true });
      }
      if (e instanceof InstrumentDeclinedError || e instanceof CaptureDeclinedError) {
        const issue = e instanceof InstrumentDeclinedError ? "INSTRUMENT_DECLINED" : `CAPTURE_DECLINED${e.processorResponseCode ? ` (${e.processorResponseCode})` : ""}`;
        const decline = await updateSession(sid, (s) => recordDecline(s, source, details, method, { issue, debugId: e instanceof InstrumentDeclinedError ? e.debugId : undefined, simulated }));
        throw new HttpError(402, `PayPal declined ${method.label} for this rebuy. Nothing was charged.`, { declined: true, issue, declineId: decline.id });
      }
      throw e;
    }
    const result = await updateSession(sid, (s) =>
      recordPaid(s, source, details, { outcome, merged, requestId, kind: "saved-method", methodLabel: method.label, methodId: method.id }, appToday(s.dayOffset)),
    );
    await indexAdd("order", outcome.orderId, sid);
    if (outcome.captureId) await indexAdd("capture", outcome.captureId, sid);
    return Response.json({
      receiptId: result.receipt.id,
      repeat: result.repeat,
      attempts: result.receipt.attempts,
      sameOrderEveryTime: result.receipt.sameOrderEveryTime,
      orderId: outcome.orderId,
      captureId: outcome.captureId,
      captureStatus: outcome.captureStatus,
    });
  });
}
