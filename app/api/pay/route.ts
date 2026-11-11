import { handle, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { startGuards } from "@/lib/app/guard-start";
import { parseApproved, payWithSavedMethod } from "@/lib/app/pay";
import { parseSource } from "@/lib/app/sources";
import { displayJson } from "@/lib/filming/server";
import { getPayPalClient } from "@/lib/paypal";

/**
 * The shopper said yes on an approval card: a customer-initiated charge on
 * the saved method, at the amount shown on that card.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ source?: unknown; methodId?: string; approved?: unknown }>(request);
    const source = parseSource(body.source);
    const paid = await payWithSavedMethod(sid, { source, methodId: body.methodId, approved: parseApproved(body.approved) }, { client: getPayPalClient });
    if (!paid.repeat) await startGuards(sid, [paid.receiptId]);
    return displayJson(paid);
  });
}
