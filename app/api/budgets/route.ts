import { BUDGET_GROUPS, setLimit } from "@/lib/app/budgets";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { updateSession } from "@/lib/app/store";
import type { BudgetGroup } from "@/lib/shelf/categories";

/** Set (or clear, with null) a monthly budget for one group. */
export async function PUT(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { group, limit } = await readJsonBody<{ group?: string; limit?: number | null }>(request);
    if (!BUDGET_GROUPS.includes(group as BudgetGroup)) throw new HttpError(400, "Unknown budget group.");
    const budgets = await updateSession(sid, (s) => {
      try {
        setLimit(s.budgets, group as BudgetGroup, limit ?? null);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return s.budgets;
    });
    return Response.json({ budgets });
  });
}
