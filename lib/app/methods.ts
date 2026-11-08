import type { PayPalClient } from "../paypal/client";
import { revokePaymentToken } from "../paypal/vault";
import { HttpError } from "./http";
import { singleFlight } from "./single-flight";
import { updateSession } from "./store";
import type { SavedMethod } from "./types";

const noticeId = () => `nt_${crypto.randomUUID().slice(0, 12)}`;

/**
 * Remove a saved method. It is marked removed first, so no rebuy can use it
 * while PayPal deletes the token; then the token is deleted at PayPal and
 * confirmed gone (two 404s). If PayPal's delete fails, the method stays
 * removed here and shows "removal pending" with a retry.
 */
export async function removeSavedMethod(sid: string, id: string, deps: { client: () => PayPalClient; waitMs?: number; sleep?: (ms: number) => Promise<void> }) {
  const m = await updateSession(sid, (s): SavedMethod => {
    const x = s.methods.find((y) => y.id === id);
    if (!x) throw new HttpError(404, "No such saved method.");
    if (x.status === "removed" && x.revokeConfirmed) return { ...x };
    x.status = "removed";
    x.removedAt ??= new Date().toISOString();
    x.revokeConfirmed = false;
    x.revokePending = true;
    return { ...x };
  });
  if (m.revokeConfirmed) return { removed: true, confirmedGone: true, deletes: 0, checks: 0 };
  let result;
  try {
    result = await singleFlight(`revoke:${m.vaultId}`, () => revokePaymentToken(deps.client(), m.vaultId, { waitMs: deps.waitMs ?? 2000, sleep: deps.sleep }));
  } catch {
    await updateSession(sid, (s) => {
      s.notices.push({ id: noticeId(), at: new Date().toISOString(), text: `Removed ${m.label} here: no rebuy can use it. PayPal didn't confirm the delete yet; retry from Saved methods.` });
    });
    throw new HttpError(502, `${m.label} is removed here and no rebuy can use it, but PayPal didn't confirm the delete. Tap Retry removal.`, { removalPending: true });
  }
  const confirmedGone = result.confirmed;
  await updateSession(sid, (s) => {
    const x = s.methods.find((y) => y.id === id);
    if (x) {
      x.revokeConfirmed = confirmedGone;
      x.revokePending = !confirmedGone;
    }
    s.notices.push({ id: noticeId(), at: new Date().toISOString(), text: `Removed ${m.label}. PayPal ${confirmedGone ? "no longer has it" : "was asked to delete it; retry to confirm"}; no rebuy can use it.` });
  });
  return { removed: true, confirmedGone, deletes: result.deletes, checks: result.checks };
}
