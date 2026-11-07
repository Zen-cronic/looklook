import { connection } from "next/server";
import { appToday } from "@/lib/app/dates";
import { runSkipEval } from "@/lib/app/eval";
import { heldOutResult } from "@/lib/app/holdout";
import { handle, sessionIdOrThrow } from "@/lib/app/http";
import { dueStaples } from "@/lib/app/payments";
import { remainingBudgets } from "@/lib/app/budgets";
import { loadSession } from "@/lib/app/store";
import { skipFigure, studioPayload, type SkipFigure } from "@/lib/studio/tables";

// The held-out result is a committed record and the development set and engine are fixed in a build, so once per process is enough.
let skip: SkipFigure | undefined;

/**
 * This shopper's records as JSON (shelf, budgets, checks, watch list, saved
 * methods, receipts), plus `studio`: the same records as flat tables for the
 * Decisions workspace (verdicts, rebuys, shelf, watch list, budgets).
 */
export async function GET() {
  await connection();
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const s = loadSession(sid);
    const today = appToday(s.dayOffset);
    skip ??= skipFigure(heldOutResult(), runSkipEval());
    return Response.json({
      today,
      dayOffset: s.dayOffset,
      shelf: s.shelf,
      budgets: { ...s.budgets, remaining: remainingBudgets(s.budgets, today) },
      due: dueStaples(s, today).map((d) => ({ id: d.item.id, daysLeft: d.daysLeft, cycle: d.cycle })),
      checks: s.checks,
      watch: s.watch,
      methods: s.methods,
      receipts: s.receipts,
      declines: s.declines,
      notices: s.notices,
      demo: s.demo,
      studio: { ...studioPayload(s, today), skip },
    });
  });
}
