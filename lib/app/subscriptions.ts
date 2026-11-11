import { indexLookup, loadSession } from "./store";
import type { SessionState } from "./types";

/**
 * Channel3 answers a subscription identical to an active one with that same
 * subscription, so one id can feed several shoppers' watches at once. Does
 * anything in this session still listen to it?
 */
export function listensTo(state: SessionState, subscriptionId: string, except?: { watchId?: string }): boolean {
  const watch = state.watch.some((w) => !w.closedAt && w.id !== except?.watchId && w.subscription.status === "active" && w.subscription.id === subscriptionId);
  // A price guard on a paid item at the same store asks Channel3 for the same thing, so it gets the same subscription.
  const guard = state.receipts.some((r) => (r.guard?.status === "on" || r.guard?.status === "starting") && r.guard.subscriptionId === subscriptionId);
  return watch || guard;
}

/**
 * Is a subscription still needed by any session the index names (other than
 * the watch being stopped), by a watch or a price guard? Only an unused one
 * may be cancelled at Channel3.
 */
export function subscriptionInUse(subscriptionId: string, except: { sessionId: string; watchId?: string }, sessions: string[] = indexLookup("subscription", subscriptionId)): boolean {
  const ids = new Set([...sessions, except.sessionId]);
  for (const sid of ids) {
    const state = loadSession(sid);
    if (listensTo(state, subscriptionId, sid === except.sessionId ? { watchId: except.watchId } : undefined)) return true;
  }
  return false;
}
