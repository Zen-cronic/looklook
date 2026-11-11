import { displayJson } from "@/lib/filming/server";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { startGuards } from "@/lib/app/guard-start";
import { startWatch } from "@/lib/app/watch-start";
import { approveWeek } from "@/lib/app/week";
import { getPayPalClient } from "@/lib/paypal";

/** The week's one yes, for the slip with this hash: watches start, then each line is paid on the saved method. */
export async function POST(request: Request, ctx: RouteContext<"/api/week/[id]/approve">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ hash?: unknown }>(request);
    if (typeof body.hash !== "string") throw new HttpError(400, "Send the slip you said yes to.");
    return displayJson(await approveWeek(sid, id, body.hash, { client: getPayPalClient, startWatch, startGuards }));
  });
}
