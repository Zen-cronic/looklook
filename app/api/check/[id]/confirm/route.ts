import { confirmCheck } from "@/lib/app/checks";
import { appToday } from "@/lib/app/dates";
import { HttpError, handle, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { liveCheckServices } from "@/lib/app/services";
import { loadSession, updateSession } from "@/lib/app/store";

/** The shopper says which catalogue product the screenshot shows. */
export async function POST(request: Request, ctx: RouteContext<"/api/check/[id]/confirm">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const { productId } = await readJsonBody<{ productId?: string }>(request);
    const state = loadSession(sid);
    const check = state.checks.find((c) => c.id === id);
    if (!check) throw new HttpError(404, "No such check.");
    const candidate = check.candidates.find((c) => c.product.id === productId);
    if (!candidate) throw new HttpError(400, "Pick one of the listed products.");
    const today = appToday(state.dayOffset);
    const next = await confirmCheck(check, candidate.product, { shelf: state.shelf, budgets: state.budgets, today }, liveCheckServices());
    await updateSession(sid, (s) => {
      const i = s.checks.findIndex((c) => c.id === id);
      if (i >= 0) s.checks[i] = next;
    });
    return Response.json({ id, verdict: next.decision.verdict });
  });
}
