import { formatDay } from "@/lib/app/dates";
import { Eyebrow } from "./Eyebrow";

/** Shown wherever run-out math uses the simulated date. Times on receipts and notices stay real. */
export function SimDate({ today, dayOffset }: { today: string; dayOffset: number }) {
  if (dayOffset === 0) return null;
  return (
    <p className="simdate">
      <Eyebrow as="span" icon="clock">
        Simulated date: {formatDay(today)}
      </Eyebrow>
    </p>
  );
}
