import { appToday } from "@/lib/app/dates";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { formatCents } from "@/lib/app/money";
import { parseApproved, resolveApproval } from "@/lib/app/pay";
import { openDecline, sameSource } from "@/lib/app/payments";
import { updateSession } from "@/lib/app/store";
import { parseSource } from "@/lib/app/sources";
import type { PurchaseIntent } from "@/lib/app/types";
import { startWatch } from "@/lib/app/watch-start";
import { armWeekWatches, buildSlip, findRun, noteCheckoutLine, parseReturnTo } from "@/lib/app/week";

/**
 * Start a purchase: fixes the item and the amount before PayPal is involved.
 * The same checks as a saved-method yes apply: an approval already bought is
 * refused, and a card whose price changed asks again.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ source?: unknown; approved?: unknown; returnTo?: unknown }>(request);
    const source = parseSource(body.source);
    const approved = parseApproved(body.approved);
    const back = parseReturnTo(body.returnTo);
    const intent = await updateSession(sid, (s) => {
      const { key, bought, details } = resolveApproval(s, source, approved, appToday(s.dayOffset), { requireAmount: false });
      if (bought) throw new HttpError(409, `Already bought: ${bought.title}, ${formatCents(bought.amountCents, bought.currency)} with ${bought.methodLabel}. Nothing more was charged.`, { alreadyBought: true, receiptId: bought.id });
      if (back) {
        // The first payment of a week: note it on the week, so the week shows it once it's paid.
        const run = findRun(s, back.runId);
        const line = buildSlip(s, run, appToday(s.dayOffset)).lines.find((l) => l.approvalKey === key);
        if (line) noteCheckoutLine(s, back.runId, line);
      }
      const open = s.intents.find((i) => !i.receiptId && sameSource(i.source, source) && i.amountCents === details.amountCents && i.approvalKey === key);
      if (open) {
        if (back) open.returnTo = back.returnTo;
        return open;
      }
      const decline = openDecline(s, source);
      const created: PurchaseIntent = {
        id: `pi_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        createdAt: new Date().toISOString(),
        source,
        title: details.title,
        brand: details.brand,
        category: details.category,
        imageUrl: details.imageUrl,
        productId: details.productId,
        approvalKey: key,
        amountCents: details.amountCents,
        currency: "USD",
        ...(decline ? { replacesMethodId: decline.methodId } : {}),
        ...(back ? { returnTo: back.returnTo } : {}),
      };
      s.intents.push(created);
      if (s.intents.length > 40) s.intents = s.intents.slice(-40);
      return created;
    });
    // The week's yes starts its price watches before the first payment, as the slip says.
    if (back) await armWeekWatches(sid, back.runId, startWatch);
    return Response.json({ id: intent.id });
  });
}
