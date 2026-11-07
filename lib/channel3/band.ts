import { cleanHistory, median } from "./clean";
import type { RawPricePoint } from "./types";

/** Derived price statistics for one product: what the app keeps instead of the raw series. */
export interface PriceBand {
  /** Median daily price over the window. */
  typical: number;
  /** Lowest daily price after cleaning. */
  low: number;
  high: number;
  /** Most recent daily price. */
  latest: number;
  /** Days of cleaned history. */
  days: number;
  /** False when the series mixes sizes or sellers with no dominant level, or is too short. */
  usable: boolean;
  /** Last day covered (YYYY-MM-DD). */
  asOf: string;
  /** Median price of each 7-day stretch, oldest first: enough to draw the trend, not the raw series. */
  weekly?: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Summarise a raw history into a band; at least `minDays` cleaned days are needed for it to be usable. */
export function priceBand(raw: RawPricePoint[], minDays = 30): PriceBand | undefined {
  const c = cleanHistory(raw);
  if (c.daily.length === 0) return undefined;
  const asOf = new Date(Date.parse(`${c.startDate}T00:00:00Z`) + (c.daily.length - 1) * 86_400_000).toISOString().slice(0, 10);
  return {
    typical: round2(median(c.daily)),
    low: round2(Math.min(...c.daily)),
    high: round2(Math.max(...c.daily)),
    latest: round2(c.daily.at(-1)!),
    days: c.daily.length,
    usable: c.usable && c.daily.length >= minDays,
    asOf,
    weekly: weeklyMedians(c.daily),
  };
}

/** Medians of consecutive 7-day stretches, counted back from the latest day. */
export function weeklyMedians(daily: number[]): number[] {
  const out: number[] = [];
  for (let end = daily.length; end > 0; end -= 7) out.unshift(round2(median(daily.slice(Math.max(0, end - 7), end))));
  return out;
}
