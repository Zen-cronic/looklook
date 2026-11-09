import { formatDollars } from "@/lib/app/money";

/** The 90-day trend (weekly medians) with the target price as a dashed line. */
export function PriceHistory({ weekly, target, now }: { weekly: number[]; target: number; now: number }) {
  if (weekly.length < 2) return null;
  const w = 280;
  const h = 72;
  const pad = 6;
  const lo = Math.min(...weekly, target, now);
  const hi = Math.max(...weekly, target, now);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (weekly.length - 1);
  const y = (v: number) => pad + ((hi - v) * (h - 2 * pad)) / span;
  const points = weekly.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="pricehist">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Price over the last 90 days, from ${formatDollars(weekly[0])} to ${formatDollars(weekly.at(-1)!)}; target ${formatDollars(target)}`}>
        <line x1={pad} x2={w - pad} y1={y(target)} y2={y(target)} className="target" />
        <polyline points={points} className="series" />
        <circle cx={x(weekly.length - 1)} cy={y(weekly.at(-1)!)} r="3.5" className="series-end" />
      </svg>
      <figcaption className="small">
        <span className="key series-key" /> Price, last 90 days <span className="key target-key" /> Buy at {formatDollars(target)}
      </figcaption>
    </figure>
  );
}
