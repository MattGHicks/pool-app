"use client";
import { useId } from "react";

const VB_W = 100;
const VB_H = 40;

/** Filled area + line chart. Responsive (preserveAspectRatio none); strokes stay
 *  crisp via non-scaling-stroke. No SVG filters → clean on mobile. */
export function AreaChart({
  points,
  color = "var(--color-amber)",
  height = 130,
  max,
  labels,
  nowFrac,
}: {
  points: number[];
  color?: string;
  height?: number;
  max?: number;
  labels?: string[];
  nowFrac?: number;
}) {
  const id = useId().replace(/:/g, "");
  const n = points.length;
  const peak = max ?? Math.max(1, ...points);
  const x = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * VB_W);
  const y = (v: number): number => VB_H - (Math.max(0, v) / peak) * (VB_H - 3) - 1.5;
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const area = n > 0 ? `${line} L ${VB_W.toFixed(2)} ${VB_H} L 0 ${VB_H} Z` : "";

  return (
    <div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            y1={VB_H * f}
            x2={VB_W}
            y2={VB_H * f}
            stroke="var(--color-border)"
            strokeWidth="1"
            opacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {area ? <path d={area} fill={`url(#${id})`} /> : null}
        {n > 1 ? (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {nowFrac !== undefined ? (
          <line
            x1={nowFrac * VB_W}
            y1="0"
            x2={nowFrac * VB_W}
            y2={VB_H}
            stroke="#fff"
            strokeWidth="1"
            strokeOpacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {labels ? (
        <div className="mt-1 flex justify-between font-mono text-[0.5rem] text-text-faint">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Vertical bars (e.g. kWh per hour/day). */
export function BarSeries({
  values,
  color = "var(--color-aqua)",
  height = 108,
  labels,
}: {
  values: number[];
  color?: string;
  height?: number;
  labels?: string[];
}) {
  const peak = Math.max(...values, 0.0001);
  return (
    <div>
      <div className="flex items-end gap-px" style={{ height }}>
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${Math.max(1.5, (v / peak) * 100)}%`,
              background: `linear-gradient(to top, color-mix(in oklab, ${color} 45%, transparent), ${color})`,
              opacity: v > 0 ? 0.92 : 0.22,
            }}
          />
        ))}
      </div>
      {labels ? (
        <div className="mt-1 flex justify-between font-mono text-[0.5rem] text-text-faint">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal stacked proportion bar (e.g. speed-band distribution). */
export function StackedBar({
  segments,
  height = 16,
}: {
  segments: Array<{ value: number; color: string }>;
  height?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ) : null,
      )}
    </div>
  );
}
