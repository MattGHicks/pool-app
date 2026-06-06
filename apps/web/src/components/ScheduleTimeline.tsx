"use client";
import { timelineBlocks, rpmColor, rpmLabel } from "@/lib/schedule";
import type { ScheduleSegment } from "@pool/types";

interface Props {
  segments: ScheduleSegment[];
  /** Minute-of-day for the live "now" marker; omit to hide it. */
  nowMinutes?: number;
  height?: number;
}

/** A 24-hour speed-by-time bar with a live now-marker and an hour axis. */
export function ScheduleTimeline({ segments, nowMinutes, height = 46 }: Props) {
  const blocks = timelineBlocks(segments);
  return (
    <div>
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border"
        style={{ height }}
      >
        <div className="flex h-full w-full">
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{ width: `${b.widthPct}%`, background: rpmColor(b.rpm) }}
              className="grid place-items-center border-r border-bg/20 last:border-r-0"
            >
              {b.widthPct > 8 ? (
                <span className="font-mono text-[0.55rem] font-semibold text-bg/85">
                  {rpmLabel(b.rpm)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {nowMinutes !== undefined ? (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/90"
            style={{ left: `${(nowMinutes / 1440) * 100}%`, boxShadow: "0 0 7px rgba(255,255,255,0.9)" }}
          >
            <div className="absolute -top-1 -left-[3.5px] h-2 w-2 rounded-full bg-white shadow-[0_0_7px_white]" />
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.54rem] text-text-faint">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
      </div>
    </div>
  );
}
