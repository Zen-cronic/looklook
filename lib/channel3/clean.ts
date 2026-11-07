import type { RawPricePoint } from "./types";

export type DropReason = "invalid" | "outlier" | "one-day-blip" | "other-series";

export interface CleanedSeries {
  /** First calendar day of `daily` (YYYY-MM-DD). */
  startDate: string;
  /** One price per calendar day, gaps and dropped points filled from the previous kept day. */
  daily: number[];
  dropped: Array<{ date: string; price: number; reason: DropReason }>;
  /** Two or more price levels alternating (sizes or sellers mixed into one series). */
  mixed: boolean;
  /** False when the series can't be trusted for timing (mixed with no dominant level). */
  usable: boolean;
  levels: number[];
  changes: number;
}

export interface CleanOptions {
  /** Points outside [low, high] x the median are dropped. */
  outlierLow?: number;
  outlierHigh?: number;
  /** A one-day move smaller than this share is not treated as a blip. */
  blipMinMove?: number;
  /** Prices within this ratio belong to the same level. */
  levelGap?: number;
  /** A series with at least this many changes and returns is mixed. */
  mixedMinChanges?: number;
  mixedMinReturns?: number;
  /** Share of days the main level must hold for a mixed series to be kept. */
  dominantShare?: number;
}

const DEFAULTS: Required<CleanOptions> = {
  outlierLow: 0.5,
  outlierHigh: 1.5,
  blipMinMove: 0.02,
  levelGap: 0.08,
  mixedMinChanges: 8,
  mixedMinReturns: 3,
  dominantShare: 0.8,
};

const DAY_MS = 86_400_000;

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dayOf(ts: string): string | undefined {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Group prices into levels: sorted prices split wherever the next is more than `gap` above. */
export function priceLevels(prices: number[], gap = DEFAULTS.levelGap): number[][] {
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  const levels: number[][] = [];
  for (const p of sorted) {
    const last = levels.at(-1);
    if (last && p <= last.at(-1)! * (1 + gap)) last.push(p);
    else levels.push([p]);
  }
  return levels;
}

/** Number of price changes, and of A -> B -> A returns between levels. */
export function changeStats(series: number[], levelOf: (p: number) => number): { changes: number; returns: number } {
  let changes = 0;
  const runs: number[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i > 0 && series[i] !== series[i - 1]) changes += 1;
    const lvl = levelOf(series[i]);
    if (runs.at(-1) !== lvl) runs.push(lvl);
  }
  let returns = 0;
  for (let i = 2; i < runs.length; i++) if (runs[i] === runs[i - 2]) returns += 1;
  return { changes, returns };
}

/**
 * Clean a daily price series for timing decisions:
 * 1. drop invalid points and keep one point per day;
 * 2. drop junk points far from the median (accessories, wrong variants, parse errors);
 * 3. drop one-day blips where the days either side agree with each other;
 * 4. detect sizes or sellers mixed into one series (frequent back-and-forth between
 *    price levels) and keep the dominant level when it holds most days, else mark unusable.
 * Dropped days are filled from the previous kept day.
 */
export function cleanHistory(raw: RawPricePoint[], options: CleanOptions = {}): CleanedSeries {
  const o = { ...DEFAULTS, ...options };
  const dropped: CleanedSeries["dropped"] = [];

  const byDay = new Map<string, number>();
  for (const p of raw) {
    const date = dayOf(p.timestamp);
    if (!date || typeof p.price !== "number" || !Number.isFinite(p.price) || p.price <= 0) {
      dropped.push({ date: date ?? String(p.timestamp), price: Number(p.price), reason: "invalid" });
      continue;
    }
    byDay.set(date, p.price);
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) {
    return { startDate: "", daily: [], dropped, mixed: false, usable: false, levels: [], changes: 0 };
  }

  const m = median([...byDay.values()]);
  const kept = new Map<string, number>();
  for (const d of days) {
    const p = byDay.get(d)!;
    if (p < m * o.outlierLow || p > m * o.outlierHigh) dropped.push({ date: d, price: p, reason: "outlier" });
    else kept.set(d, p);
  }

  // Fill to one value per calendar day.
  const startDate = days[0];
  const span = daysBetween(startDate, days.at(-1)!) + 1;
  const firstKept = [...kept.values()][0] ?? m;
  let daily: number[] = [];
  let last = firstKept;
  for (let i = 0; i < span; i++) {
    const v = kept.get(addDays(startDate, i));
    if (v !== undefined) last = v;
    daily.push(last);
  }

  // One-day blips.
  for (let i = 1; i < daily.length - 1; i++) {
    const prev = daily[i - 1];
    const next = daily[i + 1];
    const cur = daily[i];
    if (prev === next && cur !== prev && Math.abs(cur - prev) / prev >= o.blipMinMove) {
      dropped.push({ date: addDays(startDate, i), price: cur, reason: "one-day-blip" });
      daily[i] = prev;
    }
  }

  // Mixed series.
  const groups = priceLevels(daily, o.levelGap);
  const levelOf = (p: number) => groups.findIndex((g) => g.includes(p));
  const { changes, returns } = changeStats(daily, levelOf);
  const levels = groups.map((g) => median(g));
  let mixed = false;
  let usable = true;
  if (groups.length >= 2 && changes >= o.mixedMinChanges && returns >= o.mixedMinReturns) {
    mixed = true;
    const counts = groups.map((_, gi) => daily.filter((p) => levelOf(p) === gi).length);
    const main = counts.indexOf(Math.max(...counts));
    if (counts[main] / daily.length >= o.dominantShare) {
      const filled: number[] = [];
      let lastMain = daily.find((p) => levelOf(p) === main)!;
      daily.forEach((p, i) => {
        if (levelOf(p) === main) lastMain = p;
        else dropped.push({ date: addDays(startDate, i), price: p, reason: "other-series" });
        filled.push(lastMain);
      });
      daily = filled;
    } else {
      usable = false;
    }
  }

  return { startDate, daily, dropped, mixed, usable, levels, changes };
}
