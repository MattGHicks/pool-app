"use client";
import { useId } from "react";

interface Props {
  points: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ points, color = "var(--color-aqua)", height = 64 }: Props) {
  // Unique gradient id per instance (strip ":" so it's a valid url(#…) reference).
  const gradId = `spark-${useId().replace(/:/g, "")}`;
  if (points.length < 2) return <div style={{ height }} />;
  const w = 100;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xOf = (i: number): number => (i / (points.length - 1)) * w;
  const yOf = (p: number): number => height - ((p - min) / span) * (height - pad * 2) - pad;
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* faint baseline so a flat/empty trace still reads as a chart */}
      <line x1="0" y1={height - 0.5} x2={w} y2={height - 0.5} stroke="var(--color-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
    </svg>
  );
}
