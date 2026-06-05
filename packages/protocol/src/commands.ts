import { build } from "./frame.js";
import {
  ADDR_PUMP,
  ADDR_CONTROLLER,
  Action,
  REG_RPM,
  RPM_MIN,
  RPM_MAX,
  RUN,
  STOP,
  REMOTE_ENABLE,
  REMOTE_RELEASE,
} from "./constants.js";

/** Clamp to the pump's accepted RPM range and round to an integer. */
export function clampRpm(rpm: number): number {
  return Math.max(RPM_MIN, Math.min(RPM_MAX, Math.round(rpm)));
}

/** Status request (action 0x07, no data). Pump replies with a 15-byte status. */
export function statusRequest(pump: number = ADDR_PUMP): Uint8Array {
  return build(pump, ADDR_CONTROLLER, Action.Status);
}

/** Set RPM directly (action 0x01, register 0x02C4, value 16-bit big-endian). */
export function setRpm(rpm: number, pump: number = ADDR_PUMP): Uint8Array {
  const v = clampRpm(rpm);
  return build(pump, ADDR_CONTROLLER, Action.SetRegister, [
    REG_RPM[0],
    REG_RPM[1],
    (v >> 8) & 0xff,
    v & 0xff,
  ]);
}

/** Run or stop the drive (action 0x06). Speed is still set via setRpm. */
export function runStop(run: boolean, pump: number = ADDR_PUMP): Uint8Array {
  return build(pump, ADDR_CONTROLLER, Action.RunStop, [run ? RUN : STOP]);
}

/** Take (true) or release (false) remote control (action 0x04). */
export function remoteControl(enable: boolean, pump: number = ADDR_PUMP): Uint8Array {
  return build(pump, ADDR_CONTROLLER, Action.RemoteControl, [
    enable ? REMOTE_ENABLE : REMOTE_RELEASE,
  ]);
}
