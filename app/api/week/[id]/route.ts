import { displayJson } from "@/lib/filming/server";
import { handle, sessionIdOrThrow } from "@/lib/app/http";
import { loadSession } from "@/lib/app/store";
import { startGuards } from "@/lib/app/guard-start";
import { findRun, weekView } from "@/lib/app/week";

/** The week as it stands: its posts, the slip one yes would pay, and every line already sent. */
export async function GET(_request: Request, ctx: RouteContext<"/api/week/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    // A guard still starting (Channel3 was slow, or the server restarted) is tried again here.
    const run = findRun(loadSession(sid), id);
    const pending = run.sent.flatMap((l) => (l.approvalKey ? [l.approvalKey] : []));
    const receiptIds = loadSession(sid).receipts.filter((r) => r.guard?.status === "starting" && r.approvalKey && pending.includes(r.approvalKey)).map((r) => r.id);
    if (receiptIds.length) await startGuards(sid, receiptIds);
    const state = loadSession(sid);
    return displayJson(weekView(state, findRun(state, id)));
  });
}
