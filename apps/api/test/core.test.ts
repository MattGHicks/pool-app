import { describe, it, expect } from "vitest";
import type { Schedule } from "@pool/types";
import { activeRpm } from "../src/core/scheduler.js";
import { estGpm, calibratedWatts, dollarsPerHour, efficiencyPct } from "../src/energy.js";

const sched = (over: Partial<Schedule>): Schedule => ({
  id: "00000000-0000-0000-0000-000000000000",
  name: "test",
  enabled: true,
  segments: [{ start: "08:00", rpm: 1500 }],
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  priority: 0,
  ...over,
});

describe("scheduler.activeRpm", () => {
  it("returns 0 when no schedules apply", () => {
    expect(activeRpm([], new Date(2026, 5, 5, 10, 0))).toBe(0);
  });

  it("picks the segment active at the given time", () => {
    const s = sched({
      segments: [
        { start: "08:00", rpm: 1500 },
        { start: "14:00", rpm: 2400 },
        { start: "18:00", rpm: 1500 },
      ],
    });
    expect(activeRpm([s], new Date(2026, 5, 5, 9, 0))).toBe(1500);
    expect(activeRpm([s], new Date(2026, 5, 5, 15, 0))).toBe(2400);
    expect(activeRpm([s], new Date(2026, 5, 5, 20, 0))).toBe(1500);
  });

  it("wraps the last segment of the day to early morning", () => {
    const s = sched({
      segments: [
        { start: "08:00", rpm: 1500 },
        { start: "22:00", rpm: 0 },
      ],
    });
    expect(activeRpm([s], new Date(2026, 5, 5, 3, 0))).toBe(0);
  });

  it("honors priority and the enabled flag", () => {
    const low = sched({ priority: 0, segments: [{ start: "00:00", rpm: 1500 }] });
    const high = sched({ priority: 5, segments: [{ start: "00:00", rpm: 2500 }] });
    expect(activeRpm([low, high], new Date(2026, 5, 5, 10, 0))).toBe(2500);

    const disabled = sched({ enabled: false, priority: 9, segments: [{ start: "00:00", rpm: 3000 }] });
    expect(activeRpm([disabled, low], new Date(2026, 5, 5, 10, 0))).toBe(1500);
  });
});

describe("energy", () => {
  it("estGpm interpolates and clamps to the curve", () => {
    expect(estGpm(0)).toBe(0);
    expect(estGpm(1500)).toBe(25);
    expect(estGpm(9999)).toBe(98);
    const mid = estGpm(1650);
    expect(mid).toBeGreaterThan(25);
    expect(mid).toBeLessThan(34);
  });

  it("calibratedWatts matches the measured 160 W at 1500 RPM", () => {
    expect(calibratedWatts(1500)).toBe(160);
  });

  it("dollarsPerHour at the current rate", () => {
    expect(dollarsPerHour(1000, 0.205)).toBeCloseTo(0.205, 6);
    expect(dollarsPerHour(0)).toBe(0);
  });

  it("efficiencyPct follows the turnover model", () => {
    expect(efficiencyPct(0)).toBe(0);
    expect(efficiencyPct(1)).toBeCloseTo((1 - Math.exp(-1)) * 100, 6);
  });
});
