import { handle, sessionIdOrThrow } from "@/lib/app/http";
import { startWatch } from "@/lib/app/watch-start";

/** Start watching a wait item: a Channel3 product subscription sends price changes to our webhook. */
export async function POST(_request: Request, ctx: RouteContext<"/api/check/[id]/watch">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    return Response.json(await startWatch(sid, id));
  });
}
