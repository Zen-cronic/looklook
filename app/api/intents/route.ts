import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { openDecline, PaymentFlowError, sameSource, sourceDetails } from "@/lib/app/payments";
import { updateSession } from "@/lib/app/store";
import { parseSource } from "@/lib/app/sources";
import type { PurchaseIntent } from "@/lib/app/types";


/** Start a purchase: fixes the item and the amount before PayPal is involved. */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ source?: unknown }>(request);
    const source = parseSource(body.source);
    const intent = await updateSession(sid, (s) => {
      let details;
      try {
        details = sourceDetails(s, source);
      } catch (e) {
        if (e instanceof PaymentFlowError) throw new HttpError(400, e.message);
        throw e;
      }
      const open = s.intents.find((i) => !i.receiptId && sameSource(i.source, source) && i.amountCents === details.amountCents);
      if (open) return open;
      const decline = openDecline(s, source);
      const created: PurchaseIntent = {
        id: `pi_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        createdAt: new Date().toISOString(),
        source,
        title: details.title,
        brand: details.brand,
        category: details.category,
        imageUrl: details.imageUrl,
        amountCents: details.amountCents,
        currency: "USD",
        ...(decline ? { replacesMethodId: decline.methodId } : {}),
      };
      s.intents.push(created);
      if (s.intents.length > 40) s.intents = s.intents.slice(-40);
      return created;
    });
    return Response.json({ id: intent.id });
  });
}
