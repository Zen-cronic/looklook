import { formatDay } from "@/lib/app/dates";
import { Eyebrow } from "./Eyebrow";

/** Shown wherever run-out math uses the simulated date. Times on receipts and notices stay real. */
export function SimDate({ today, dayOffset, film = false }: { today: string; dayOffset: number; film?: boolean }) {
  if (dayOffset === 0) return null;
  return (
    <p className="simdate">
      <Eyebrow as="span" icon="clock">
        {film ? `${formatDay(today)} (simulated)` : `Simulated date: ${formatDay(today)}`}
      </Eyebrow>
    </p>
  );
}
