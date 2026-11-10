import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { loadSampleWeek, updateSession } from "@/lib/app/store";
import { newWeekRun, SAMPLE_WEEK_POSTS, saveRun, WEEK_MAX_POSTS } from "@/lib/app/week";

/**
 * Hand over a week: the sample week's posts (loaded fresh), or posts this
 * browser already checked. Each is grouped as the engine decided it; the
 * slip and the yes come next (GET /api/week/[id], POST .../approve).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ from?: string; checkIds?: unknown }>(request);
    if (body.from === "sample-week") {
      await loadSampleWeek(sid);
      const id = await updateSession(sid, (s) => {
        const run = newWeekRun(s, SAMPLE_WEEK_POSTS.filter((p) => s.checks.some((c) => c.id === p)), "sample-week");
        saveRun(s, run);
        return run.id;
      });
      return Response.json({ id });
    }
    const ids = Array.isArray(body.checkIds) ? body.checkIds.filter((x): x is string => typeof x === "string") : [];
    if (ids.length === 0) throw new HttpError(400, "Send the sample week or the checks to hand over.");
    if (ids.length > WEEK_MAX_POSTS) throw new HttpError(400, `At most ${WEEK_MAX_POSTS} posts in one week.`);
    const id = await updateSession(sid, (s) => {
      const run = newWeekRun(s, [...new Set(ids)], "posts");
      saveRun(s, run);
      return run.id;
    });
    return Response.json({ id });
  });
}
