import type { ControlMode, ControlStateDTO } from "@pool/types";
import type { PumpStatus } from "@pool/protocol";

/**
 * In-memory single source of truth for what the app wants the pump to do.
 * Lives independent of the DB so the control loop keeps working if Postgres dies.
 */
export class ControlState {
  controlMode: ControlMode = "off";
  /** RPM requested by a manual override. */
  manualRpm = 0;
  /** RPM computed by the scheduler for the current time. */
  scheduledRpm = 0;
  /** Whether any enabled schedule exists (so empty-schedule mode hands back, not stops). */
  scheduleActive = false;
  /** epoch ms when a manual override expires (null = until cleared). */
  overrideUntil: number | null = null;

  lastStatus: PumpStatus | null = null;
  lastStatusAt: number | null = null;
  busConnected = false;
  lastError: string | null = null;
  lastUpdate = Date.now();

  private changeCbs: Array<() => void> = [];

  onChange(cb: () => void): void {
    this.changeCbs.push(cb);
  }

  private notify(): void {
    this.lastUpdate = Date.now();
    for (const cb of this.changeCbs) cb();
  }

  /** The RPM the engine should drive right now (0 = stop). */
  get targetRpm(): number {
    if (this.controlMode === "manual") return this.manualRpm;
    if (this.controlMode === "schedule") return this.scheduledRpm;
    return 0;
  }

  setManual(rpm: number, durationMinutes?: number): void {
    this.controlMode = "manual";
    this.manualRpm = rpm;
    this.overrideUntil = durationMinutes ? Date.now() + durationMinutes * 60_000 : null;
    this.notify();
  }

  resumeSchedule(): void {
    this.controlMode = "schedule";
    this.overrideUntil = null;
    this.notify();
  }

  setOff(): void {
    this.controlMode = "off";
    this.overrideUntil = null;
    this.notify();
  }

  setScheduledRpm(rpm: number): void {
    if (rpm === this.scheduledRpm) return;
    this.scheduledRpm = rpm;
    if (this.controlMode === "schedule") this.notify();
  }

  setScheduleActive(active: boolean): void {
    if (this.scheduleActive === active) return;
    this.scheduleActive = active;
    if (this.controlMode === "schedule") this.notify();
  }

  applyStatus(status: PumpStatus): void {
    this.lastStatus = status;
    this.lastStatusAt = Date.now();
  }

  setBusConnected(connected: boolean): void {
    if (this.busConnected === connected) return;
    this.busConnected = connected;
    this.notify();
  }

  /** Expire a finished manual override (returns true if it changed mode). */
  tickOverride(): boolean {
    if (
      this.controlMode === "manual" &&
      this.overrideUntil !== null &&
      Date.now() > this.overrideUntil
    ) {
      this.controlMode = "schedule";
      this.overrideUntil = null;
      this.notify();
      return true;
    }
    return false;
  }

  toDTO(): ControlStateDTO {
    return {
      controlMode: this.controlMode,
      targetRpm: this.targetRpm,
      overrideUntil: this.overrideUntil,
      busConnected: this.busConnected,
      lastError: this.lastError,
      lastUpdate: this.lastUpdate,
    };
  }
}
