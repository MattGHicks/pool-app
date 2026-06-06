import type { Schedule } from "@pool/types";
import type { ControlState } from "./controlState.js";

function toMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Compute the active RPM for `now` from the schedule set. The highest-priority
 * enabled schedule whose day matches wins; within it, the latest segment whose
 * start <= now applies (wrapping: before the first start, the last segment of
 * the day carries over). Returns 0 if nothing applies.
 */
export function activeRpm(schedules: Schedule[], now: Date): number {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const candidates = schedules
    .filter((s) => s.enabled && s.daysOfWeek.includes(day))
    .sort((a, b) => b.priority - a.priority);
  const top = candidates[0];
  if (!top || top.segments.length === 0) return 0;

  const segs = [...top.segments].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  let active = segs[segs.length - 1]!; // wrap from previous day before the first start
  for (const seg of segs) {
    if (toMinutes(seg.start) <= minutes) active = seg;
  }
  return active.rpm;
}

/** Periodically recomputes the scheduled setpoint and pushes it into ControlState. */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private schedules: Schedule[] = [];

  constructor(
    private readonly state: ControlState,
    private readonly load: () => Promise<Schedule[]>,
  ) {}

  setSchedules(schedules: Schedule[]): void {
    this.schedules = schedules;
    this.tick();
  }

  async refresh(): Promise<void> {
    try {
      this.schedules = await this.load();
    } catch {
      /* keep cached schedules if the DB is unavailable */
    }
    this.tick();
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(): void {
    this.state.setScheduleActive(this.schedules.some((s) => s.enabled));
    this.state.setScheduledRpm(activeRpm(this.schedules, new Date()));
  }
}
