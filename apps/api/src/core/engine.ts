import { remoteControl, setRpm, runStop } from "@pool/protocol";
import type { CommandQueue } from "./commandQueue.js";
import type { ControlState } from "./controlState.js";
import { logger } from "../logger.js";

/**
 * Realizes the control intent on the pump and runs the FAILSAFE keep-alive.
 *
 * Failsafe principle: the pump's onboard keypad schedule is the safe baseline.
 * While we want a specific speed (schedule/manual), we re-assert remote control
 * + the setpoint every keepAliveMs. The instant we stop (crash, bus drop, mode
 * 'off'), the pump times out and reverts to its onboard schedule. We never enter
 * External-Control-Only mode (which would disable that schedule).
 */
export class Engine {
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAppliedMode: string | null = null;
  private onEvent?: (type: string, detail: Record<string, unknown>) => void;

  constructor(
    private readonly state: ControlState,
    private readonly queue: CommandQueue,
    private readonly pumpAddr: number,
    private keepAliveMs: number,
  ) {}

  setEventSink(fn: (type: string, detail: Record<string, unknown>) => void): void {
    this.onEvent = fn;
  }

  start(): void {
    this.state.onChange(() => void this.apply());
    this.keepAliveTimer = setInterval(() => void this.apply(), this.keepAliveMs);
    void this.apply();
  }

  stop(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  setKeepAliveMs(ms: number): void {
    this.keepAliveMs = ms;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => void this.apply(), ms);
    }
  }

  /** Send the commands that realize the current control intent. Idempotent. */
  async apply(): Promise<void> {
    if (!this.state.busConnected) return;
    this.state.tickOverride();
    const mode = this.state.controlMode;

    // Hand control back to the pump's onboard schedule when explicitly off, OR
    // when in schedule mode but no schedule is defined (so "Schedule" never
    // accidentally stops the pump on a fresh install).
    const releaseToOnboard = mode === "off" || (mode === "schedule" && !this.state.scheduleActive);
    if (releaseToOnboard) {
      if (this.lastAppliedMode !== "released") {
        try {
          await this.queue.send(remoteControl(false, this.pumpAddr), "release");
        } catch {
          /* non-fatal: a missed release just means the pump times out instead */
        }
        this.lastAppliedMode = "released";
        this.onEvent?.("control_release", { reason: mode === "off" ? "hand-to-pump" : "no-schedule" });
        logger.info("control released — pump runs its onboard schedule");
      }
      return;
    }

    const target = this.state.targetRpm;
    try {
      // Re-assert remote control every cycle — this is the keep-alive that holds
      // the pump in override and away from its onboard-schedule timeout.
      await this.queue.send(remoteControl(true, this.pumpAddr), "remote-enable");
      if (target > 0) {
        await this.queue.send(setRpm(target, this.pumpAddr), `set-rpm-${target}`);
      } else {
        await this.queue.send(runStop(false, this.pumpAddr), "stop");
      }
      if (this.lastAppliedMode !== mode) {
        this.onEvent?.("setpoint", { mode, rpm: target });
      }
      this.lastAppliedMode = mode;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "engine apply failed");
    }
  }

  /** Graceful release on shutdown — clean handoff to the onboard schedule. */
  async release(): Promise<void> {
    try {
      await this.queue.send(remoteControl(false, this.pumpAddr), "shutdown-release");
      this.onEvent?.("shutdown_release", {});
    } catch {
      /* best effort */
    }
  }
}
