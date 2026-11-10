import { displayJson } from "@/lib/filming/server";
import { handle, sessionIdOrThrow } from "@/lib/app/http";
import { loadSession } from "@/lib/app/store";
import { findRun, weekView } from "@/lib/app/week";

/** The week as it stands: its posts, the slip one yes would pay, and every line already sent. */
export async function GET(_request: Request, ctx: RouteContext<"/api/week/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const state = loadSession(sid);
    return displayJson(weekView(state, findRun(state, id)));
  });
}
