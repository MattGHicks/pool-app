"use client";
import { useRef, useState, type PointerEvent as RPE } from "react";
import { rpmColor, rpmLabel, fromMin, toMin, label12 } from "@/lib/schedule";
import { haptics } from "@/lib/haptics";
import type { ScheduleSegment } from "@pool/types";

const DAY = 1440;
const SNAP = 15;
const MIN_BLOCK = 15;
const CHIPS = [
  { rpm: 0, label: "Off" },
  { rpm: 1500, label: "Eco" },
  { rpm: 2400, label: "Clean" },
  { rpm: 3000, label: "Boost" },
];

interface Block {
  start: number;
  rpm: number;
}

/** Segments → day-tiling blocks starting at 00:00 (wrapping the last over midnight). */
function toBlocks(segs: ScheduleSegment[]): Block[] {
  const xs = segs
    .map((s) => ({ start: ((toMin(s.start) % DAY) + DAY) % DAY, rpm: s.rpm }))
    .sort((a, b) => a.start - b.start)
    .filter((b, i, a) => i === 0 || b.start !== a[i - 1]!.start);
  if (xs.length === 0) return [{ start: 0, rpm: 1500 }];
  if (xs[0]!.start > 0) xs.unshift({ start: 0, rpm: xs[xs.length - 1]!.rpm });
  return xs;
}

function toSegs(blocks: Block[]): ScheduleSegment[] {
  return blocks.map((b) => ({ start: fromMin(b.start), rpm: b.rpm }));
}

interface Props {
  segments: ScheduleSegment[];
  onChange: (segs: ScheduleSegment[]) => void;
  nowMinutes?: number;
}

export function TimelineEditor({ segments, onChange, nowMinutes }: Props) {
  const blocks = toBlocks(segments);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const [sel, setSel] = useState(0);
  const [dragTime, setDragTime] = useState<{ x: number; min: number } | null>(null);

  const end = (i: number): number => blocks[i + 1]?.start ?? DAY;
  const selIdx = Math.min(sel, blocks.length - 1);
  const selBlock = blocks[selIdx]!;

  const xToMin = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return 0;
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round((frac * DAY) / SNAP) * SNAP;
  };

  const onHandleDown = (i: number) => (e: RPE<HTMLDivElement>) => {
    e.stopPropagation();
    dragRef.current = i;
    barRef.current?.setPointerCapture(e.pointerId);
    haptics.toggle();
    setDragTime({ x: (blocks[i]!.start / DAY) * 100, min: blocks[i]!.start });
  };
  const onMove = (e: RPE<HTMLDivElement>): void => {
    const i = dragRef.current;
    if (i === null) return;
    const lo = blocks[i - 1]!.start + MIN_BLOCK;
    const hi = end(i) - MIN_BLOCK;
    const m = Math.min(hi, Math.max(lo, xToMin(e.clientX)));
    setDragTime({ x: (m / DAY) * 100, min: m });
    if (m !== blocks[i]!.start) {
      onChange(toSegs(blocks.map((b, j) => (j === i ? { ...b, start: m } : b))));
      haptics.step();
    }
  };
  const onUp = (): void => {
    dragRef.current = null;
    setDragTime(null);
  };

  const setRpm = (rpm: number): void =>
    onChange(toSegs(blocks.map((b, j) => (j === selIdx ? { ...b, rpm } : b))));
  const split = (): void => {
    haptics.apply();
    const mid = Math.round((selBlock.start + end(selIdx)) / 2 / SNAP) * SNAP;
    if (mid <= selBlock.start || mid >= end(selIdx)) return;
    const next = [...blocks];
    next.splice(selIdx + 1, 0, { start: mid, rpm: selBlock.rpm });
    onChange(toSegs(next));
  };
  const del = (): void => {
    if (blocks.length <= 1) return;
    haptics.toggle();
    const next = blocks.filter((_, j) => j !== selIdx);
    if (next[0]!.start !== 0) next[0] = { ...next[0]!, start: 0 };
    onChange(toSegs(next));
    setSel(Math.max(0, selIdx - 1));
  };
  const nudge = (d: number): void => {
    if (selIdx === 0) return;
    const lo = blocks[selIdx - 1]!.start + MIN_BLOCK;
    const hi = end(selIdx) - MIN_BLOCK;
    const m = Math.min(hi, Math.max(lo, selBlock.start + d));
    onChange(toSegs(blocks.map((b, j) => (j === selIdx ? { ...b, start: m } : b))));
  };

  return (
    <div className="space-y-3">
      {/* Editable timeline */}
      <div
        ref={barRef}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative h-[124px] w-full touch-none select-none overflow-hidden rounded-2xl border border-border-bright/60"
        style={{ background: "var(--color-surface)" }}
      >
        {/* hour grid */}
        {Array.from({ length: 23 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-bg/30"
            style={{ left: `${((i + 1) / 24) * 100}%` }}
          />
        ))}
        {/* blocks */}
        {blocks.map((b, i) => {
          const left = (b.start / DAY) * 100;
          const w = ((end(i) - b.start) / DAY) * 100;
          const active = i === selIdx;
          return (
            <button
              key={i}
              onClick={() => {
                setSel(i);
                haptics.toggle();
              }}
              className="absolute top-0 bottom-0 grid place-items-center transition-[box-shadow,filter]"
              style={{
                left: `${left}%`,
                width: `${w}%`,
                background: `linear-gradient(180deg, ${rpmColor(b.rpm)}, color-mix(in oklab, ${rpmColor(b.rpm)} 78%, black))`,
                boxShadow: active ? "inset 0 0 0 2px var(--color-text), inset 0 0 22px rgba(255,255,255,0.25)" : "none",
                filter: active ? "brightness(1.08)" : "brightness(0.92)",
                zIndex: active ? 2 : 1,
              }}
            >
              {w > 11 ? (
                <span className="pointer-events-none text-center leading-tight">
                  <span className="block font-display text-[0.82rem] text-bg">{rpmLabel(b.rpm)}</span>
                  <span className="block font-mono text-[0.5rem] text-bg/70">{label12(fromMin(b.start))}</span>
                </span>
              ) : null}
            </button>
          );
        })}
        {/* drag handles between blocks */}
        {blocks.slice(1).map((b, k) => {
          const i = k + 1;
          return (
            <div
              key={i}
              onPointerDown={onHandleDown(i)}
              className="absolute top-0 bottom-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
              style={{ left: `${(b.start / DAY) * 100}%` }}
            >
              <div className="h-full w-[2px] bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.7)]" />
              <div className="absolute h-7 w-3 rounded-full border border-white/80 bg-bg/70 shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
            </div>
          );
        })}
        {/* now marker */}
        {nowMinutes !== undefined ? (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-[5] w-px bg-amber"
            style={{ left: `${(nowMinutes / DAY) * 100}%`, boxShadow: "0 0 7px var(--color-amber)" }}
          />
        ) : null}
        {/* drag time tooltip */}
        {dragTime ? (
          <div
            className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 rounded-md bg-bg/90 px-1.5 py-0.5 font-mono text-[0.6rem] text-text"
            style={{ left: `${dragTime.x}%` }}
          >
            {label12(fromMin(dragTime.min))}
          </div>
        ) : null}
      </div>
      <div className="flex justify-between font-mono text-[0.54rem] text-text-faint">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
      </div>

      {/* Selected-block editor */}
      <div className="rounded-2xl border border-border bg-surface/40 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-mono text-[0.66rem] text-text-dim">
            {label12(fromMin(selBlock.start))} – {label12(fromMin(end(selIdx)))}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => nudge(-SNAP)}
              disabled={selIdx === 0}
              className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface/60 text-text-dim disabled:opacity-30"
            >
              −
            </button>
            <span className="w-9 text-center font-mono text-[0.6rem] text-text-faint">start</span>
            <button
              onClick={() => nudge(SNAP)}
              disabled={selIdx === 0}
              className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface/60 text-text-dim disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.rpm}
              onClick={() => setRpm(c.rpm)}
              className={`rounded-lg border py-2 text-center transition ${
                selBlock.rpm === c.rpm
                  ? "border-transparent text-bg"
                  : "border-border bg-surface/50 text-text-dim active:bg-surface-2/60"
              }`}
              style={selBlock.rpm === c.rpm ? { background: rpmColor(c.rpm) } : undefined}
            >
              <span className="block font-display text-[0.8rem] leading-none">{c.label}</span>
              <span className="block font-mono text-[0.5rem] opacity-70">{c.rpm || "—"}</span>
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={3450}
          step={50}
          value={selBlock.rpm}
          onChange={(e) => setRpm(Number(e.target.value))}
          className="mt-3 w-full accent-aqua"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[0.68rem] text-text-dim">
            {selBlock.rpm > 0 ? `${selBlock.rpm} rpm` : "Off"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={split}
              className="rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-[0.72rem] text-aqua active:bg-surface-2/60"
            >
              Split
            </button>
            <button
              onClick={del}
              disabled={blocks.length <= 1}
              className="rounded-lg border border-coral/40 bg-coral/5 px-3 py-1.5 text-[0.72rem] text-coral active:bg-coral/10 disabled:opacity-30"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
