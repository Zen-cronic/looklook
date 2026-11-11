import type { PayPalClient } from "../paypal/client";
import { CaptureDeclinedError, InstrumentDeclinedError, RebuyCapExceededError } from "../paypal/errors";
import { negativeTestingEnabled } from "../paypal/config";
import { rebuy } from "../paypal/rebuy";
import { appToday } from "./dates";
import { HttpError } from "./http";
import { formatCents } from "./money";
import {
  activeMethod,
  approvalKey,
  approvalVersion,
  boughtFor,
  checkApproval,
  failedTries,
  intentSku,
  PaymentFlowError,
  receiptDetails,
  recordDecline,
  recordPaid,
  savedMethodRequestId,
  sourceDetails,
  StaleApprovalError,
  type SourceDetails,
} from "./payments";
import { budgetHoldFor } from "./reminders";
import { ApprovalBusyError, claimApproval, isInflight, singleFlight } from "./single-flight";
import { indexAdd, loadSession, updateSession } from "./store";
import type { PurchaseSource, SessionState } from "./types";

/** What the card showed when the shopper tapped yes. */
export interface Approved {
  amountCents?: number;
  /** The card's version: a staple's cycle, or when the drop arrived. */
  version?: string;
}

export interface PayInput {
  source: PurchaseSource;
  methodId?: string;
  approved?: Approved;
}

export function parseApproved(raw: unknown): Approved | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const amountCents = Number.isInteger(r.amountCents) ? (r.amountCents as number) : undefined;
  return { amountCents, version: typeof r.version === "string" ? r.version : undefined };
}

function flowError(e: unknown): never {
  if (e instanceof StaleApprovalError) throw new HttpError(409, e.message, { stale: true });
  if (e instanceof PaymentFlowError) throw new HttpError(400, e.message);
  throw e;
}

/**
 * Before a purchase starts (saved method or PayPal checkout): is this
 * approval already bought, still current, and at the amount the card showed?
 * Returns the repeat's receipt when it is the same yes again.
 */
export function resolveApproval(state: SessionState, source: PurchaseSource, approved: Approved | undefined, today: string, opts: { requireAmount?: boolean } = { requireAmount: true }) {
  let key: string;
  try {
    key = approvalKey(state, source);
  } catch (e) {
    flowError(e);
  }
  const bought = boughtFor(state, key);
  if (bought) return { key, bought, details: receiptDetails(bought) };
  let details: SourceDetails;
  try {
    checkApproval(state, source, today);
    details = sourceDetails(state, source);
  } catch (e) {
    flowError(e);
  }
  const hold = budgetHoldFor(state, source);
  if (hold) throw new HttpError(409, hold, { overBudget: true });
  const version = approvalVersion(state, source);
  if (approved?.amountCents === undefined) {
    if (opts.requireAmount) throw new HttpError(400, "Send the amount shown on the card you approved.");
    return { key, bought: undefined, details };
  }
  if (approved.amountCents !== details.amountCents || (approved.version !== undefined && approved.version !== version)) {
    throw new HttpError(
      409,
      approved.amountCents !== details.amountCents
        ? `The price changed from ${formatCents(approved.amountCents)} to ${formatCents(details.amountCents)} since this card was shown. Nothing was charged. Approve the new price if you still want it.`
        : "This card changed since you saw it. Nothing was charged. Look at it again and approve it if you still want it.",
      { priceChanged: true, amountCents: details.amountCents, version },
    );
  }
  return { key, bought: undefined, details };
}

/**
 * The shopper said yes on an approval card: a customer-initiated charge on
 * the saved method, at the amount the card showed. The PayPal-Request-Id
 * comes from the approval itself, so the same yes sent again (a double tap, a
 * stale tab, the receipt's "Send the same yes again") returns the same order,
 * and a second card for an approval already paid is refused.
 */
export async function payWithSavedMethod(sid: string, input: PayInput, deps: { client: () => PayPalClient }) {
  const { source } = input;
  const state = loadSession(sid);
  const today = appToday(state.dayOffset);
  const method = input.methodId ? state.methods.find((m) => m.id === input.methodId && m.status === "active") : activeMethod(state);
  if (!method) throw new HttpError(409, "No saved payment method. Pay with PayPal once and save it for reorders.", { needsCheckout: true });

  const resolved = resolveApproval(state, source, input.approved, today);
  const { key, bought } = resolved;
  let details = resolved.details;
  let requestId: string;
  let simulated = false;
  if (bought) {
    // The same yes again: only the identical request may go to PayPal, and it names the same order.
    requestId = savedMethodRequestId(sid, key, bought.amountCents, method.vaultId, false, failedTries(state, key));
    if (requestId !== bought.requestId || (input.approved?.amountCents !== undefined && input.approved.amountCents !== bought.amountCents)) {
      throw new HttpError(409, `Already bought: ${bought.title}, ${formatCents(bought.amountCents, bought.currency)} with ${bought.methodLabel}. Nothing more was charged.`, { alreadyBought: true, receiptId: bought.id });
    }
    details = receiptDetails(bought);
  } else {
    simulated = state.demo.declineNextRebuy && negativeTestingEnabled();
    requestId = savedMethodRequestId(sid, key, details.amountCents, method.vaultId, simulated, failedTries(state, key));
  }

  let release: () => void;
  try {
    release = claimApproval(key, requestId);
  } catch (e) {
    if (e instanceof ApprovalBusyError) throw new HttpError(409, "This item is already being paid for from another card. Nothing more was charged.", { alreadyBought: true });
    throw e;
  }
  try {
    if (simulated) {
      await updateSession(sid, (s) => {
        s.demo.declineNextRebuy = false;
      });
    }
    const merged = isInflight(requestId);
    let outcome;
    try {
      outcome = await singleFlight(requestId, () =>
        rebuy(deps.client(), {
          itemId: intentSku({ id: details.key, category: details.category, source }, details.productId),
          cycle: details.key,
          title: details.title,
          unitCents: details.amountCents,
          currency: method.currency,
          capCents: method.capCents,
          method: { type: method.type, vaultId: method.vaultId },
          requestId,
          ...(simulated ? { mockApplicationCode: "INSTRUMENT_DECLINED" } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof RebuyCapExceededError) {
        throw new HttpError(409, `${formatCents(details.amountCents)} is above your ${formatCents(method.capCents)} per-reorder cap. Nothing was charged. Raise the cap on the Payments page or pay once with PayPal.`, { overCap: true });
      }
      if (e instanceof InstrumentDeclinedError || e instanceof CaptureDeclinedError) {
        const issue = e instanceof InstrumentDeclinedError ? "INSTRUMENT_DECLINED" : `CAPTURE_DECLINED${e.processorResponseCode ? ` (${e.processorResponseCode})` : ""}`;
        const decline = await updateSession(sid, (s) => recordDecline(s, source, details, method, { issue, debugId: e instanceof InstrumentDeclinedError ? e.debugId : undefined, simulated }));
        throw new HttpError(402, `PayPal declined ${method.label} for this reorder. Nothing was charged.`, { declined: true, issue, declineId: decline.id });
      }
      throw e;
    }
    const recordSource = bought ? bought.source : source;
    const result = await updateSession(sid, (s) =>
      recordPaid(s, recordSource, details, { outcome, merged, requestId, kind: "saved-method", methodLabel: method.label, methodId: method.id }, appToday(s.dayOffset)),
    );
    await indexAdd("order", outcome.orderId, sid);
    if (outcome.captureId) await indexAdd("capture", outcome.captureId, sid);
    return {
      receiptId: result.receipt.id,
      repeat: result.repeat,
      attempts: result.receipt.attempts,
      sameOrderEveryTime: result.receipt.sameOrderEveryTime,
      orderId: outcome.orderId,
      captureId: outcome.captureId,
      captureStatus: outcome.captureStatus,
    };
  } finally {
    release();
  }
}
