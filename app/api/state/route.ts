import { connection } from "next/server";
import { appToday } from "@/lib/app/dates";
import { handle, sessionIdOrThrow } from "@/lib/app/http";
import { dueStaples } from "@/lib/app/payments";
import { remainingBudgets } from "@/lib/app/budgets";
import { loadSession } from "@/lib/app/store";

/** This shopper's records as JSON (shelf, budgets, checks, watch list, saved methods, receipts). */
export async function GET() {
  await connection();
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const s = loadSession(sid);
    const today = appToday(s.dayOffset);
    return Response.json({ today, dayOffset: s.dayOffset, shelf: s.shelf, budgets: { ...s.budgets, remaining: remainingBudgets(s.budgets, today) }, due: dueStaples(s, today).map((d) => ({ id: d.item.id, daysLeft: d.daysLeft, cycle: d.cycle })), checks: s.checks, watch: s.watch, methods: s.methods, receipts: s.receipts, declines: s.declines, notices: s.notices, demo: s.demo });
  });
}
