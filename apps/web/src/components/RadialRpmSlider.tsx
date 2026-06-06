"use client";
import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { haptics } from "@/lib/haptics";
import { fmtRpm } from "@/lib/format";

const MIN = 0;
const MAX = 3450;
const START_DEG = 135;
const SWEEP = 270;
const PRESETS = [1500, 2400, 3000];

const clamp = (rpm: number): number => Math.max(MIN, Math.min(MAX, rpm));
const rad = (d: number): number => (d * Math.PI) / 180;
const rpmToAngle = (rpm: number): number => START_DEG + ((clamp(rpm) - MIN) / (MAX - MIN)) * SWEEP;

function angleToRpm(deg: number): number {
  const t = (deg - START_DEG) / SWEEP;
  return clamp(Math.round((MIN + t * (MAX - MIN)) / 10) * 10);
}

function pointerAngle(cx: number, cy: number, x: number, y: number): number {
  let p = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  if (p < 0) p += 360; // 0..360, 0=right, 90=down
  if (p >= START_DEG) return Math.min(p, START_DEG + SWEEP);
  if (p <= 45) return Math.min(p + 360, START_DEG + SWEEP);
  return p < 90 ? START_DEG + SWEEP : START_DEG; // bottom gap → nearest end
}

interface Props {
  target: number;
  actual: number;
  size?: number;
  onApply: (rpm: number) => void;
}

export function RadialRpmSlider({ target, actual, size = 280, onApply }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const downRef = useRef(false);
  const valueRef = useRef(target);
  const lastStepRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const shown = drag ?? pending ?? target;
  const aqua = "var(--color-aqua)";
  const stroke = 16;
  const r = (size - stroke) / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const frac = (clamp(shown) - MIN) / (MAX - MIN);
  const track = `${0.75 * circ} ${circ}`;
  const val = `${0.75 * frac * circ} ${circ}`;
  const rot = `rotate(135 ${cx} ${cy})`;
  const ha = rpmToAngle(shown);
  const hx = cx + r * Math.cos(rad(ha));
  const hy = cy + r * Math.sin(rad(ha));
  const state: "idle" | "drag" | "applying" = drag !== null ? "drag" : pending !== null ? "applying" : "idle";

  const update = (clientX: number, clientY: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const deg = pointerAngle(rect.left + rect.width / 2, rect.top + rect.height / 2, clientX, clientY);
    let rpm = angleToRpm(deg);
    for (const p of PRESETS) if (Math.abs(rpm - p) <= 30) rpm = p;
    valueRef.current = rpm;
    setDrag(rpm);
    if (Math.abs(rpm - lastStepRef.current) >= 50) {
      haptics.step();
      lastStepRef.current = rpm;
    }
  };

  const commit = (rpm: number): void => {
    setDrag(null);
    setPending(rpm);
    haptics.apply();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onApply(rpm), 700);
  };

  useEffect(() => {
    if (pending !== null && Math.abs(actual - pending) < 90) {
      const t = setTimeout(() => setPending(null), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [actual, pending]);

  const onDown = (e: RPE<SVGSVGElement>): void => {
    downRef.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };
  const onMove = (e: RPE<SVGSVGElement>): void => {
    if (downRef.current) update(e.clientX, e.clientY);
  };
  const onUp = (): void => {
    if (!downRef.current) return;
    downRef.current = false;
    commit(valueRef.current);
  };

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        className="touch-none select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {Array.from({ length: 28 }).map((_, i) => {
          const a = START_DEG + (i / 27) * SWEEP;
          const major = i % 9 === 0;
          const ri = r - 19;
          const ro = r - 11;
          return (
            <line
              key={i}
              x1={cx + ri * Math.cos(rad(a))}
              y1={cy + ri * Math.sin(rad(a))}
              x2={cx + ro * Math.cos(rad(a))}
              y2={cy + ro * Math.sin(rad(a))}
              stroke={major ? "var(--color-border-bright)" : "var(--color-border)"}
              strokeWidth={major ? 2 : 1}
            />
          );
        })}
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
          opacity={0.5}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={aqua}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={val}
          transform={rot}
          style={{
            filter: `drop-shadow(0 0 9px ${aqua})`,
            transition: drag === null ? "stroke-dasharray 0.45s cubic-bezier(0.22,1,0.36,1)" : "none",
            opacity: state === "applying" ? 0.8 : 1,
          }}
        />
        <circle
          cx={hx}
          cy={hy}
          r={state === "drag" ? 15 : 12}
          fill="var(--color-bg)"
          stroke={aqua}
          strokeWidth={3}
          style={{
            filter: `drop-shadow(0 0 10px ${aqua})`,
            transition: drag === null ? "all 0.45s cubic-bezier(0.22,1,0.36,1)" : "none",
          }}
        />
        <circle cx={hx} cy={hy} r={3.5} fill={aqua} style={{ transition: drag === null ? "all 0.45s" : "none" }} />
      </svg>

      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <div className="text-[0.6rem] uppercase tracking-[0.3em] text-text-faint">
          {state === "applying" ? "Applying" : state === "drag" ? "Set speed" : "Target RPM"}
        </div>
        <div
          className="font-display text-[3.4rem] leading-none text-aqua"
          style={{ textShadow: "0 0 26px rgba(52,227,212,0.4)" }}
        >
          {fmtRpm(shown)}
        </div>
        <div className="mt-1 font-mono text-[0.7rem] text-text-dim">
          {state === "applying" ? (
            <span className="text-amber">sending…</span>
          ) : (
            <>actual {fmtRpm(actual)}</>
          )}
        </div>
      </div>
    </div>
  );
}
