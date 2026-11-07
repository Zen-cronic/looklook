import { redecideCheck } from "@/lib/app/checks";
import { appToday } from "@/lib/app/dates";
import { HttpError, handle, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { liveCheckServices } from "@/lib/app/services";
import { loadSession, updateSession } from "@/lib/app/store";

/** The shopper adds the price (or asks for a fresh verdict with today's shelf and budgets). */
export async function POST(request: Request, ctx: RouteContext<"/api/check/[id]/price">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const { price } = await readJsonBody<{ price?: number | null }>(request);
    if (price !== undefined && price !== null && !(typeof price === "number" && price > 0 && price < 100000)) throw new HttpError(400, "Enter a price in dollars.");
    const state = loadSession(sid);
    const check = state.checks.find((c) => c.id === id);
    if (!check) throw new HttpError(404, "No such check.");
    const today = appToday(state.dayOffset);
    const next = await redecideCheck(check, { shelf: state.shelf, budgets: state.budgets, today }, liveCheckServices(), price ?? undefined);
    await updateSession(sid, (s) => {
      const i = s.checks.findIndex((c) => c.id === id);
      if (i >= 0) s.checks[i] = next;
    });
    return Response.json({ id, verdict: next.decision.verdict });
  });
}
