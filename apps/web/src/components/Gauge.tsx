"use client";
import { useId } from "react";

interface GaugeProps {
  value: number;
  max: number;
  label: string;
  display: string;
  unit: string;
  color?: string;
  size?: number;
  sub?: string;
}

/** A 270° glowing radial gauge (gap at the bottom). */
export function Gauge({
  value,
  max,
  label,
  display,
  unit,
  color = "var(--color-aqua)",
  size = 168,
  sub,
}: GaugeProps) {
  const id = useId().replace(/:/g, "");
  const stroke = 11;
  const r = (size - stroke) / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const track = `${0.75 * circ} ${circ}`;
  const val = `${0.75 * frac * circ} ${circ}`;
  const rot = `rotate(135 ${cx} ${cy})`;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={track}
          transform={rot}
          opacity={0.55}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#grad-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={val}
          transform={rot}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="font-display text-[2rem] leading-none" style={{ color }}>
          {display}
        </div>
        <div className="mt-1 text-[0.6rem] uppercase tracking-[0.22em] text-text-dim">{unit}</div>
        {sub ? <div className="mt-1.5 text-[0.7rem] text-text-faint">{sub}</div> : null}
      </div>
      <div className="absolute bottom-1 text-[0.6rem] uppercase tracking-[0.28em] text-text-faint">
        {label}
      </div>
    </div>
  );
}
