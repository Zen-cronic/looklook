import { HttpError, handle, sessionIdOrThrow } from "@/lib/app/http";
import { waitAction } from "@/lib/app/reminders";
import { appToday } from "@/lib/app/dates";
import { updateSession } from "@/lib/app/store";

/** "Remind me": for a budget wait, when next month's budget starts; for an item you own, on the look-again date. */
export async function POST(_request: Request, ctx: RouteContext<"/api/check/[id]/remind">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const reminder = await updateSession(sid, (s) => {
      const c = s.checks.find((x) => x.id === id);
      if (!c) throw new HttpError(404, "No such check.");
      const action = waitAction(c, appToday(s.dayOffset));
      if (!action || (action.kind !== "budget" && action.kind !== "run-out")) throw new HttpError(409, "This verdict has nothing to remind you about.");
      c.reminder = { kind: action.kind, on: action.on, setAt: new Date().toISOString() };
      return c.reminder;
    });
    return Response.json({ reminder });
  });
}

/** Clear a reminder (looked at it, or no longer wanted). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/check/[id]/remind">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    await updateSession(sid, (s) => {
      const c = s.checks.find((x) => x.id === id);
      if (c?.reminder) c.reminder.doneAt = new Date().toISOString();
    });
    return Response.json({ ok: true });
  });
}
