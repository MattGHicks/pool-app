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

  it("tapers to zero below the first knot instead of clamping to it", () => {
    // Regression: the old interpolate() returned the first knot's value for any
    // input below it, so a barely-turning pump reported a full 22 GPM / 90 W.
    expect(estGpm(700)).toBeLessThan(22);
    expect(estGpm(700)).toBeGreaterThan(0);
    expect(estGpm(1400)).toBe(22); // the knot itself is unchanged
    expect(calibratedWatts(500)).toBeLessThan(90);
    expect(calibratedWatts(1000)).toBe(90);

    // Monotonic all the way down — no step at the first knot.
    for (let rpm = 0; rpm < 1500; rpm += 100) {
      expect(estGpm(rpm)).toBeLessThanOrEqual(estGpm(rpm + 100));
      expect(calibratedWatts(rpm)).toBeLessThanOrEqual(calibratedWatts(rpm + 100));
    }
  });

  it("reports the real water efficiency spread across the speed range", () => {
    // The energy page used to assume a flat 9000 gal/kWh. It isn't flat: the
    // whole point of a variable-speed pump is that slow is dramatically more
    // efficient, so gallons must be measured from flow, not derived from kWh.
    const galPerKwh = (rpm: number): number =>
      (estGpm(rpm) * 60) / (calibratedWatts(rpm) / 1000);
    expect(galPerKwh(1500)).toBeGreaterThan(9000);
    expect(galPerKwh(3000)).toBeLessThan(5500);
    // Efficiency must fall monotonically as speed rises.
    expect(galPerKwh(1500)).toBeGreaterThan(galPerKwh(2400));
    expect(galPerKwh(2400)).toBeGreaterThan(galPerKwh(3000));
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
