export interface PayPalIssue {
  issue: string;
  description?: string;
  field?: string;
}

/** Any non-2xx answer from the PayPal REST API. */
export class PayPalApiError extends Error {
  readonly status: number;
  readonly errorName: string;
  readonly issues: PayPalIssue[];
  readonly debugId?: string;

  constructor(status: number, errorName: string, message: string, issues: PayPalIssue[], debugId?: string) {
    super(`${status} ${errorName}: ${message}${issues.length ? ` [${issues.map((i) => (i.field ? `${i.issue} at ${i.field}` : i.issue)).join(", ")}]` : ""}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.errorName = errorName;
    this.issues = issues;
    this.debugId = debugId;
  }

  hasIssue(issue: string): boolean {
    return this.issues.some((i) => i.issue === issue);
  }
}

/**
 * The bank or card network refused the funding instrument. Recovery: send the
 * buyer to approve again and pick another funding source.
 */
export class InstrumentDeclinedError extends PayPalApiError {
  readonly recovery = "Ask the buyer to approve again with another card or funding source.";
  constructor(base: PayPalApiError) {
    super(base.status, base.errorName, base.message, base.issues, base.debugId);
    this.name = "InstrumentDeclinedError";
  }
}

/**
 * PayPal refused the funding source picked while saving the wallet (for
 * example PayPal balance, which can't be saved for later payments). The code
 * starts with INVALID_SELECTED_. Recovery: save a card or bank instead.
 */
export class FundingSourceNotSavableError extends PayPalApiError {
  readonly recovery = "PayPal balance can't be saved for later payments. Pick a card or bank account in PayPal.";
  constructor(base: PayPalApiError) {
    super(base.status, base.errorName, base.message, base.issues, base.debugId);
    this.name = "FundingSourceNotSavableError";
  }
}

/** Capture was attempted before the buyer approved the order. */
export class OrderNotApprovedError extends PayPalApiError {
  constructor(base: PayPalApiError) {
    super(base.status, base.errorName, base.message, base.issues, base.debugId);
    this.name = "OrderNotApprovedError";
  }
}

/**
 * The order call succeeded (HTTP 201, order COMPLETED) but the capture inside
 * it was declined by the processor. Only the capture status tells you this.
 */
export class CaptureDeclinedError extends Error {
  readonly orderId: string;
  readonly captureId?: string;
  readonly processorResponseCode?: string;
  constructor(orderId: string, captureId?: string, processorResponseCode?: string) {
    super(`Capture ${captureId ?? "(none)"} on order ${orderId} was declined${processorResponseCode ? ` (processor ${processorResponseCode})` : ""}.`);
    this.name = "CaptureDeclinedError";
    this.orderId = orderId;
    this.captureId = captureId;
    this.processorResponseCode = processorResponseCode;
  }
}

/** A rebuy above the buyer's per-rebuy cap. Raised before any request is sent. */
export class RebuyCapExceededError extends Error {
  readonly amountCents: number;
  readonly capCents: number;
  constructor(amountCents: number, capCents: number) {
    super(`Rebuy of ${(amountCents / 100).toFixed(2)} is above the per-rebuy cap of ${(capCents / 100).toFixed(2)}.`);
    this.name = "RebuyCapExceededError";
    this.amountCents = amountCents;
    this.capCents = capCents;
  }
}

export class NegativeTestingDisabledError extends Error {
  constructor() {
    super("Simulated PayPal failures are off. Set DEMO_NEGATIVE_TESTING=1 to use them in the sandbox.");
    this.name = "NegativeTestingDisabledError";
  }
}

export function isInvalidSelectedIssue(issue: string): boolean {
  return issue.startsWith("INVALID_SELECTED_");
}

/** Turn a generic API error into the typed error the product handles. */
export function classifyPayPalError(err: PayPalApiError): PayPalApiError {
  if (err.hasIssue("INSTRUMENT_DECLINED")) return new InstrumentDeclinedError(err);
  if (err.issues.some((i) => isInvalidSelectedIssue(i.issue))) return new FundingSourceNotSavableError(err);
  if (err.hasIssue("ORDER_NOT_APPROVED")) return new OrderNotApprovedError(err);
  return err;
}
