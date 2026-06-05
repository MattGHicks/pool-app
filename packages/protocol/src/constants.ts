/**
 * Pentair RS-485 protocol constants.
 * The SuperFlo VST impersonates an IntelliFlo VS on the wire, so these are the
 * IntelliFlo VS command/telemetry constants. Ground truth:
 * pool-controller/docs/superflo-vst-rs485-reference.md
 */

/** Frame preamble that precedes every message. */
export const PREAMBLE = [0xff, 0x00, 0xff] as const;
/** Start-of-message byte. */
export const START = 0xa5;
/** Protocol/version byte that follows START. */
export const PROTOCOL = 0x00;

/** Bus addresses. */
export const ADDR_PUMP = 0x60; // pump 1 (address 1)
export const ADDR_CONTROLLER = 0x21; // our virtual controller

/** Action codes. */
export const Action = {
  SetRegister: 0x01,
  RemoteControl: 0x04,
  RunStop: 0x06,
  Status: 0x07,
} as const;
export type ActionCode = (typeof Action)[keyof typeof Action];

/** Set-RPM register (0x02C4); value is RPM, 16-bit big-endian. */
export const REG_RPM = [0x02, 0xc4] as const;

export const RPM_MIN = 0;
export const RPM_MAX = 3450;

/** Run/stop payload values (action 0x06). */
export const RUN = 0x0a;
export const STOP = 0x04;

/** Remote-control payload values (action 0x04). */
export const REMOTE_ENABLE = 0xff;
export const REMOTE_RELEASE = 0x00;

/**
 * Status/alarm word codes (status reply bytes 11-12). This is a FAULT word:
 * a healthy pump reports 0 regardless of run/stop (run state lives in byte 0).
 * Confirmed empirically: our running pump (135 W / 1500 RPM) reports 0 here.
 * Non-zero fault labels are best-known from njsPC; bytes 11-12 are not fully
 * documented, so unknown non-zero values fall through to "Fault (0xNN)".
 */
export const STATUS_CODES: Record<number, string> = {
  0: "Ok",
  2: "Filter warning",
  3: "Overcurrent",
  4: "Priming",
  5: "System blocked",
  16: "Comm failure",
};
