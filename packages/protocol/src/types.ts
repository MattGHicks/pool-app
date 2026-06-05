/** Decoded pump status (from an action-0x07 reply). */
export interface PumpStatus {
  /** Raw run/command byte (0x0A = running, 0x04 = stopped). */
  command: number;
  /** Convenience: command === 0x0A. */
  running: boolean;
  /** Operating mode byte. */
  mode: number;
  /** Motor-drive state (0 = idle, 2 = energized/regulating). */
  driveState: number;
  /** Power draw, watts (drive estimate). */
  watts: number;
  /** Shaft speed, RPM. */
  rpm: number;
  /** Flow, GPM — always 0 on the SuperFlo VST (no flow sensor). */
  flow: number;
  /** Percent-of-program (VF only); 0 on the VST. */
  ppc: number;
  /** 16-bit status/alarm word. */
  statusWord: number;
  /** Human-readable status (from STATUS_CODES). */
  statusText: string;
  /** Pump clock hour (0-23). */
  clockHH: number;
  /** Pump clock minute (0-59). */
  clockMM: number;
  /** Pump clock as minutes since midnight. */
  clockMinutes: number;
}

/** A parsed (but not checksum-verified) frame off the bus. */
export interface RawFrame {
  dst: number;
  src: number;
  action: number;
  data: Uint8Array;
}
