import type { ScheduleSegment } from "@pool/types";

export function toMin(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function fromMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 12-hour label for an HH:MM string, e.g. "08:00" → "8a", "14:30" → "2:30p". */
export function label12(hhmm: string): string {
  const min = toMin(hhmm);
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ap = h24 < 12 ? "a" : "p";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`;
}

/**
 * Vivid intensity ramp (teal → lime → amber) so mid speeds read clearly instead
 * of washing out; muted slate for off. Lightness/saturation held high across the
 * range so 2400 is just as legible as the endpoints.
 */
export function rpmColor(rpm: number): string {
  if (rpm <= 0) return "#33414f";
  const t = Math.min(1, Math.max(0, (rpm - 800) / (3450 - 800)));
  const hue = Math.round(172 - t * (172 - 40)); // teal(172) → amber(40)
  return `hsl(${hue} 82% 56%)`;
}

export function rpmLabel(rpm: number): string {
  return rpm > 0 ? String(rpm) : "Off";
}

export function sortSegments(segs: ScheduleSegment[]): ScheduleSegment[] {
  return [...segs].sort((a, b) => toMin(a.start) - toMin(b.start));
}

export interface Block {
  startMin: number;
  endMin: number;
  rpm: number;
  widthPct: number;
}

/**
 * Blocks covering the full 0..1440 day. The time before the first segment is
 * filled by the LAST segment (it wraps over midnight) — matching how the backend
 * scheduler resolves the active speed. This is the fix for bars that used to all
 * start at 12am regardless of their real start time.
 */
export function timelineBlocks(segs: ScheduleSegment[]): Block[] {
  const sorted = sortSegments(segs);
  if (sorted.length === 0) return [];
  const starts = sorted.map((s) => toMin(s.start));
  const raw: Array<Omit<Block, "widthPct">> = [];
  if (starts[0]! > 0) {
    raw.push({ startMin: 0, endMin: starts[0]!, rpm: sorted[sorted.length - 1]!.rpm });
  }
  for (let i = 0; i < sorted.length; i++) {
    const startMin = starts[i]!;
    const endMin = i < sorted.length - 1 ? starts[i + 1]! : 1440;
    raw.push({ startMin, endMin, rpm: sorted[i]!.rpm });
  }
  return raw.map((b) => ({ ...b, widthPct: ((b.endMin - b.startMin) / 1440) * 100 }));
}

/** The rpm active at a given minute-of-day (with wrap). */
export function rpmAt(segs: ScheduleSegment[], minutes: number): number {
  const blocks = timelineBlocks(segs);
  for (const b of blocks) if (minutes >= b.startMin && minutes < b.endMin) return b.rpm;
  return blocks[0]?.rpm ?? 0;
}

/** Hours per day the pump runs (rpm > 0). */
export function runtimeHours(segs: ScheduleSegment[]): number {
  return timelineBlocks(segs)
    .filter((b) => b.rpm > 0)
    .reduce((h, b) => h + (b.endMin - b.startMin) / 60, 0);
}
