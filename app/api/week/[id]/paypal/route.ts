import { displayJson } from "@/lib/filming/server";
import { handle, HttpError, sessionIdOrThrow } from "@/lib/app/http";
import { loadSession } from "@/lib/app/store";
import { describeRecord, lookUpPayment, lookupsEnabled, LookupError, paidOrderFor, readOnlyTools } from "@/lib/paypal/toolkit";
import { envInt, GlobalBudget } from "@/lib/studio/guard";
import { CallBudget } from "@/lib/studio/llm";

const perSession = new CallBudget(envInt("PAYPAL_LOOKUPS_PER_10_MIN", 20), 10 * 60 * 1000);
const allSessions = new GlobalBudget(envInt("PAYPAL_LOOKUPS_PER_HOUR", 300), 60 * 60 * 1000);

/**
 * What PayPal recorded for one paid item of this week, read through PayPal's
 * Agent Toolkit (get_order, then get_refund for each refund). Read only. The
 * order is the one this session paid for the item named by `?key=`; nothing
 * else can be looked up.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/week/[id]/paypal">) {
  return handle(async () => {
    if (!lookupsEnabled()) throw new HttpError(503, "PayPal lookups are off.");
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const key = new URL(request.url).searchParams.get("key") ?? "";
    const item = paidOrderFor(loadSession(sid), id, key);
    if (!perSession.take(sid) || !allSessions.take()) throw new HttpError(429, "Too many PayPal lookups just now. Try again in a few minutes.");
    try {
      const record = await lookUpPayment(item.orderId, await readOnlyTools());
      return displayJson({ key, title: item.title, ...record, text: describeRecord(item.title, record) });
    } catch (e) {
      if (e instanceof LookupError) throw new HttpError(502, e.message);
      throw e;
    }
  });
}
