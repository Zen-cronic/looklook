import { formatDollars } from "@/lib/app/money";

/**
 * The 90-day trend (weekly medians), labelled on the chart itself: the low point,
 * the price now at the line's end, and the buy-at price on its dashed line.
 */
export function PriceHistory({ weekly, target, now }: { weekly: number[]; target: number; now: number }) {
  if (weekly.length < 2) return null;
  const w = 336;
  const h = 144;
  const left = 8;
  const right = w - 124; // the labels at the line's end sit in this gutter
  const top = 22;
  const bottom = 92;
  // The low label sits under its point and above the baseline, 8px clear of both.
  const axisY = bottom + 32;
  const lo = Math.min(...weekly, target, now);
  const hi = Math.max(...weekly, target, now);
  const span = hi - lo || 1;
  const x = (i: number) => left + (i * (right - left)) / (weekly.length - 1);
  const y = (v: number) => top + ((hi - v) * (bottom - top)) / span;
  const points = weekly.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const low = Math.min(...weekly);
  const lowAt = weekly.indexOf(low);
  const endY = y(now);
  const targetY = y(target);
  // Keep the two end labels apart when the price now sits near the target.
  const apart = Math.abs(endY - targetY) < 20;
  const nowLabelY = apart && endY <= targetY ? targetY - 20 : endY;
  const targetLabelY = apart && endY > targetY ? endY - 20 : targetY;
  // Label baseline: the point's radius, 8px clearance, then the cap height.
  const lowLabelY = y(low) + 3.5 + 8 + 9;
  const lowLabelX = Math.min(Math.max(x(lowAt), left + 34), right - 34);
  return (
    <figure className="pricehist">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Price over the last 90 days: lowest ${formatDollars(low)}, now ${formatDollars(now)}; buy at ${formatDollars(target)} or less`}>
        <line x1={left} x2={right} y1={axisY} y2={axisY} className="axis" />
        <line x1={left} x2={right + 6} y1={targetY} y2={targetY} className="target" />
        <polyline points={points} className="series" />
        <circle cx={x(lowAt)} cy={y(low)} r="3.5" className="low-dot" />
        <circle cx={x(weekly.length - 1)} cy={endY} r="4" className="series-end" />
        <text x={lowLabelX} y={lowLabelY} textAnchor="middle" className="label">
          Low {formatDollars(low)}
        </text>
        <text x={right + 12} y={nowLabelY + 4} className="label strong">
          Now {formatDollars(now)}
        </text>
        <text x={right + 12} y={targetLabelY + 4} className="label target-label">
          Buy at {formatDollars(target)}
        </text>
        <text x={left} y={axisY + 16} className="label axis-label">
          90 days ago
        </text>
        <text x={right} y={axisY + 16} textAnchor="end" className="label axis-label">
          This week
        </text>
      </svg>
    </figure>
  );
}
