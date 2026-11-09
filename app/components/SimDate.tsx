import { formatDay } from "@/lib/app/dates";

/** Shown wherever run-out math uses the simulated date. Times on receipts and notices stay real. */
export function SimDate({ today, dayOffset }: { today: string; dayOffset: number }) {
  if (dayOffset === 0) return null;
  return (
    <p className="simdate">
      <span className="chip sim">Simulated date: {formatDay(today)}</span>
    </p>
  );
}
