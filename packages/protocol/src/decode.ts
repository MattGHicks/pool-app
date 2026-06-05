import { STATUS_CODES, RUN, Action } from "./constants.js";
import type { PumpStatus, RawFrame } from "./types.js";

/**
 * Decode a status reply payload (action 0x07, 15 bytes) into a PumpStatus.
 * Byte map (validated against a real capture: 135 W / 1500 RPM / 17:31):
 *   [0] command/run  [1] mode  [2] driveState  [3-4] watts  [5-6] rpm
 *   [7] flow  [8] ppc  [11-12] statusWord  [13-14] clock HH:MM
 */
export function decodeStatus(data: Uint8Array): PumpStatus {
  const b = (n: number): number => data[n] ?? 0;
  const command = b(0);
  const statusWord = (b(11) << 8) | b(12);
  const clockHH = b(13);
  const clockMM = b(14);
  return {
    command,
    running: command === RUN,
    mode: b(1),
    driveState: b(2),
    watts: (b(3) << 8) | b(4),
    rpm: (b(5) << 8) | b(6),
    flow: b(7),
    ppc: b(8),
    statusWord,
    statusText: STATUS_CODES[statusWord] ?? `Fault (0x${statusWord.toString(16)})`,
    clockHH,
    clockMM,
    clockMinutes: clockHH * 60 + clockMM,
  };
}

/** True if a frame is a status reply from the given pump address. */
export function isPumpStatus(frame: RawFrame, pumpAddr: number): boolean {
  return frame.src === pumpAddr && frame.action === Action.Status;
}
