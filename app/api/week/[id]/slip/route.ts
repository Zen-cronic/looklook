import { displayJson } from "@/lib/filming/server";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { setLeftForLater } from "@/lib/app/week";

/**
 * Take a line off the week's slip for later, or put it back (the Studio week's
 * assistant uses this). Nothing is paid here; the slip's hash changes.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/week/[id]/slip">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ approvalKey?: unknown; action?: unknown }>(request);
    if (typeof body.approvalKey !== "string" || (body.action !== "leave" && body.action !== "back")) throw new HttpError(400, "Name an item in this week's order, and leave or back.");
    return displayJson(await setLeftForLater(sid, id, body.approvalKey, body.action));
  });
}
