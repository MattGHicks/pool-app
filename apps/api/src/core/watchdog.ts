import type { HealthDTO } from "@pool/types";
import type { ControlState } from "./controlState.js";
import type { BridgeConnection } from "../bridge/connection.js";

/** Health + the dead-man's-switch bookkeeping. */
export class Watchdog {
  private readonly startedAt = Date.now();

  constructor(
    private readonly state: ControlState,
    private readonly bridge: BridgeConnection,
    private readonly getKeepAliveMs: () => number,
    private readonly dbConnected: () => boolean,
  ) {}

  health(): HealthDTO {
    const lastPollAgeMs = this.state.lastStatusAt ? Date.now() - this.state.lastStatusAt : null;
    return {
      busConnected: this.bridge.connected,
      lastPollAgeMs,
      controlMode: this.state.controlMode,
      uptimeS: Math.floor((Date.now() - this.startedAt) / 1000),
      dbConnected: this.dbConnected(),
      keepAliveMs: this.getKeepAliveMs(),
    };
  }
}
