/**
 * Same-key calls that overlap share one promise. PayPal's sandbox answered
 * two simultaneous order requests carrying the same PayPal-Request-Id with
 * two separate orders (both captured); sequential repeats got the first
 * order back. So a double tap is merged here before it reaches PayPal, and
 * the request id still covers retries that come later.
 *
 * In-process only: run one instance of the web service, or move this to a
 * shared lock.
 */
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/** True when a call with this key is running now (a new call would join it). */
export function isInflight(key: string): boolean {
  return inflight.has(key);
}

export function inflightCount(): number {
  return inflight.size;
}

/**
 * One approval (an item's cycle, a watch, a check) is paid by one request at
 * a time. A second yes with the same request id joins the first; a yes for
 * the same approval with a different request (a drop card and the run-out
 * card for the same cycle) is refused until the first is recorded.
 * In-process, like singleFlight.
 */
const approvals = new Map<string, { requestId: string; holders: number }>();

export class ApprovalBusyError extends Error {}

export function claimApproval(key: string, requestId: string): () => void {
  const held = approvals.get(key);
  if (held && held.requestId !== requestId) throw new ApprovalBusyError(key);
  const entry = held ?? { requestId, holders: 0 };
  entry.holders += 1;
  approvals.set(key, entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holders -= 1;
    if (entry.holders <= 0 && approvals.get(key) === entry) approvals.delete(key);
  };
}
