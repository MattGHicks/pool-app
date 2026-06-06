import {
  scanFrames,
  remoteControl,
  runStop,
  setRpm,
  clampRpm,
  Action,
  REG_RPM,
  RUN,
  REMOTE_ENABLE,
} from "@pool/protocol";
import type { RawFrame } from "@pool/protocol";

/** Somewhere to send bytes onto the bus (the upstream ESP32 connection). */
export interface Upstream {
  readonly connected: boolean;
  write(bytes: Uint8Array): void;
}

export interface GuardianConfig {
  /** Pump bus address (e.g. 0x60). */
  pumpAddr: number;
  /** How often to re-send the keep-alive while holding (ms). */
  keepAliveMs: number;
  /** Hard ceiling on how long to hold the pump after the app vanishes (ms). */
  failoverMaxMs: number;
}

export type GuardianState =
  | "relaying" // the app is connected and owns the bus; we only pass bytes through
  | "holding" // the app vanished mid-run; we re-send its last setpoint as a deadman
  | "idle"; // no app, nothing to hold (released, timed out, or never ran)

type Log = (msg: string, extra?: Record<string, unknown>) => void;

const MAX_RX_BUFFER = 4096;

/**
 * Failover keep-alive with a grace period. Sits between the app and the pump:
 * while the app is connected it owns the bus and we just observe its commands to
 * learn the last intent (remote-control on/off, run/stop, RPM). The instant the
 * app's connection drops mid-run, we take over the keep-alive — re-asserting that
 * exact setpoint every keepAliveMs — so a redeploy/crash is invisible to the pump.
 *
 * Safety invariants:
 *  - We only ever write while NO app is connected (single bus writer at all times).
 *  - We only hold a *running* setpoint; if the app's last word was a release/stop,
 *    we leave the pump to its own ~timeout so it returns to its onboard schedule.
 *  - We never exceed failoverMaxMs; at the ceiling we release once and go idle, so
 *    a permanently-dead app hands scheduling back to the pump.
 */
export class Guardian {
  private _state: GuardianState = "idle";
  private rxBuf = new Uint8Array(0);

  // Last control intent observed from the app's command stream.
  private remoteEnabled = false;
  private running = false;
  private rpm = 0;

  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private failoverDeadline = 0;

  constructor(
    private readonly upstream: Upstream,
    private readonly cfg: GuardianConfig,
    private readonly log: Log = () => {},
  ) {}

  get state(): GuardianState {
    return this._state;
  }

  /** The RPM we'd hold (last observed setpoint). Exposed for status/tests. */
  get heldRpm(): number {
    return this.rpm;
  }

  /** Called by the network layer when the app connects/disconnects. */
  setClientConnected(connected: boolean): void {
    if (connected) {
      this.stopFailover();
      this.rxBuf = new Uint8Array(0);
      this._state = "relaying";
      this.log("app connected — relaying, app owns the bus");
      return;
    }
    if (this.intentIsRunning()) {
      this.startFailover();
    } else {
      this._state = "idle";
      this.log("app disconnected with no running intent — leaving pump to its own timeout");
    }
  }

  /**
   * Observe the app→bus byte stream to track the last control intent. The caller
   * is responsible for forwarding these bytes upstream; we only read them.
   */
  observe(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.rxBuf.length + chunk.length);
    merged.set(this.rxBuf, 0);
    merged.set(chunk, this.rxBuf.length);
    const { frames, consumed } = scanFrames(merged);
    this.rxBuf = merged.slice(consumed);
    if (this.rxBuf.length > MAX_RX_BUFFER) this.rxBuf = new Uint8Array(0);
    for (const f of frames) this.sniff(f);
  }

  /** Stop timers (clean shutdown). */
  dispose(): void {
    this.stopFailover();
  }

  private sniff(f: RawFrame): void {
    if (f.dst !== this.cfg.pumpAddr) return; // only commands addressed to our pump
    switch (f.action) {
      case Action.RemoteControl:
        this.remoteEnabled = f.data[0] === REMOTE_ENABLE;
        break;
      case Action.RunStop:
        this.running = f.data[0] === RUN;
        break;
      case Action.SetRegister:
        if (f.data[0] === REG_RPM[0] && f.data[1] === REG_RPM[1] && f.data.length >= 4) {
          this.rpm = ((f.data[2] ?? 0) << 8) | (f.data[3] ?? 0);
        }
        break;
      default:
        break;
    }
  }

  private intentIsRunning(): boolean {
    return this.remoteEnabled && this.running && this.rpm > 0;
  }

  private startFailover(): void {
    this._state = "holding";
    this.failoverDeadline = Date.now() + this.cfg.failoverMaxMs;
    this.log("app gone mid-run — holding pump speed", {
      rpm: this.rpm,
      maxMs: this.cfg.failoverMaxMs,
    });
    this.sendKeepAlive(); // assert immediately so the pump never notices the gap
    this.keepAliveTimer = setInterval(() => this.onTick(), this.cfg.keepAliveMs);
  }

  private onTick(): void {
    if (Date.now() >= this.failoverDeadline) {
      this.log("failover window elapsed — releasing pump to its onboard schedule");
      this.sendRelease();
      this.stopFailover();
      this._state = "idle";
      return;
    }
    this.sendKeepAlive();
  }

  private sendKeepAlive(): void {
    if (!this.upstream.connected) return;
    const rpm = clampRpm(this.rpm);
    this.upstream.write(remoteControl(true, this.cfg.pumpAddr));
    this.upstream.write(runStop(true, this.cfg.pumpAddr));
    this.upstream.write(setRpm(rpm, this.cfg.pumpAddr));
  }

  private sendRelease(): void {
    if (!this.upstream.connected) return;
    this.upstream.write(remoteControl(false, this.cfg.pumpAddr));
  }

  private stopFailover(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
