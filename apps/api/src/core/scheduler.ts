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
/** Day-of-week (0-6) + minute-of-day for `now`, evaluated in the given IANA
 *  timezone — so schedules run on the user's wall clock even though the
 *  container's own clock is UTC. */
function tzDayMinutes(now: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get("hour")) % 24; // some locales emit "24" at midnight
  return { day: DAYS[get("weekday")] ?? 0, minutes: hour * 60 + Number(get("minute")) };
}

export function activeRpm(schedules: Schedule[], now: Date, tz?: string): number {
  const { day, minutes } = tz
    ? tzDayMinutes(now, tz)
    : { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
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
    private readonly tz: string,
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

  /** Begin periodic re-evaluation. Call `refresh()` once first to prime the setpoint. */
  start(): void {
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
    this.state.setScheduledRpm(activeRpm(this.schedules, new Date(), this.tz));
  }
}
