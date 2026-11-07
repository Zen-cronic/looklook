import { formatDay } from "@/lib/app/dates";

/** Shown wherever run-out math uses the simulated date. Times on receipts and notices stay real. */
export function SimDate({ today, dayOffset }: { today: string; dayOffset: number }) {
  if (dayOffset === 0) return null;
  return (
    <p className="simdate">
      <span className="chip sim">Simulated date: {formatDay(today)}</span> <span className="small muted">Run-out dates and this month&apos;s budgets count from it. Receipt and notice times are real.</span>
    </p>
  );
}
