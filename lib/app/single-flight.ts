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
