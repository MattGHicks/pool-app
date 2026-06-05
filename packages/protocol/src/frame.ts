import { PREAMBLE, START, PROTOCOL } from "./constants.js";
import { checksum } from "./checksum.js";

/**
 * Build a complete Pentair frame:
 *   FF 00 FF  A5 00 {dst} {src} {action} {len} [data...]  {ck_hi ck_lo}
 *
 * Port of the Python `build()` in pool-controller/tools.
 */
export function build(
  dst: number,
  src: number,
  action: number,
  data: readonly number[] | Uint8Array = [],
): Uint8Array {
  const dataArr = Array.from(data);
  const body = [START, PROTOCOL, dst, src, action, dataArr.length, ...dataArr];
  const ck = checksum(body);
  return Uint8Array.from([...PREAMBLE, ...body, ...ck]);
}
