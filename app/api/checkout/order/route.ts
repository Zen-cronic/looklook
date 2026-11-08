import { baseUrl, handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { boughtFor, checkoutOrderBody } from "@/lib/app/payments";
import { indexAdd, loadSession, updateSession } from "@/lib/app/store";
import type { MethodType } from "@/lib/app/types";
import { freshRequestId, getPayPalClient, type PayPalOrder } from "@/lib/paypal";

/** Create the PayPal order the JS SDK buttons (wallet or card fields) approve. */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ intentId?: string; funding?: MethodType; save?: boolean; capCents?: number }>(request);
    const funding: MethodType = body.funding === "card" ? "card" : "paypal";
    const save = body.save === true;
    const capCents = Number(body.capCents);
    if (save && !(Number.isInteger(capCents) && capCents >= 100 && capCents <= 100000)) throw new HttpError(400, "Set a per-rebuy cap between $1 and $1,000.");
    const state = loadSession(sid);
    const intent = state.intents.find((i) => i.id === body.intentId);
    if (!intent) throw new HttpError(404, "No such purchase.");
    if (intent.receiptId) throw new HttpError(409, "This purchase is already paid.", { receiptId: intent.receiptId });
    const bought = intent.approvalKey ? boughtFor(state, intent.approvalKey) : undefined;
    if (bought) throw new HttpError(409, "Already bought. Nothing more was charged.", { alreadyBought: true, receiptId: bought.id });
    const base = await baseUrl();
    const orderBody = checkoutOrderBody(intent, { funding, save, customerId: state.customerId, returnUrl: `${base}/checkout/${intent.id}`, cancelUrl: `${base}/checkout/${intent.id}` }, intent.productId);
    const res = await getPayPalClient().request<PayPalOrder>({ method: "POST", path: "/v2/checkout/orders", requestId: freshRequestId("checkout"), body: orderBody });
    await updateSession(sid, (s) => {
      const i = s.intents.find((x) => x.id === intent.id);
      if (i) i.order = { id: res.body.id, funding, save, capCents: save ? capCents : 0 };
    });
    await indexAdd("order", res.body.id, sid);
    return Response.json({ orderId: res.body.id });
  });
}
