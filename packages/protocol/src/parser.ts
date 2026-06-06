import { START } from "./constants.js";
import { checksum } from "./checksum.js";
import type { RawFrame } from "./types.js";

export interface ScanOptions {
  /**
   * Drop frames whose trailing 2-byte checksum doesn't match the body. Filters
   * out corrupted / byte-misaligned reads (common right after a bridge reconnect)
   * that would otherwise decode into garbage telemetry. Off by default to preserve
   * the lenient behavior; read paths that decode status should turn it on.
   */
  verifyChecksum?: boolean;
}

/**
 * Scan a byte buffer for complete Pentair frames, reporting how many bytes were
 * consumed so a streaming reader can keep the trailing partial frame.
 *
 * A frame is: START (0xA5) PROTOCOL {dst} {src} {action} {len} [data×len] {ck×2}.
 * Non-START bytes (e.g. the FF 00 FF preamble, line noise) are skipped. A START
 * whose declared length runs past the end of the buffer is treated as a partial
 * read: scanning stops and `consumed` points at that START so the caller retains it.
 *
 * With `verifyChecksum`, a complete frame whose checksum is wrong is treated as
 * noise: we resync from the next byte rather than emit garbage.
 */
export function scanFrames(
  buf: Uint8Array,
  opts: ScanOptions = {},
): { frames: RawFrame[]; consumed: number } {
  const frames: RawFrame[] = [];
  let i = 0;
  while (i + 6 <= buf.length) {
    if (buf[i] === START) {
      const len = buf[i + 5] ?? 0;
      const end = i + 6 + len + 2;
      if (end <= buf.length) {
        if (opts.verifyChecksum) {
          const [hi, lo] = checksum(buf.subarray(i, i + 6 + len));
          if (buf[i + 6 + len] !== hi || buf[i + 6 + len + 1] !== lo) {
            i += 1; // bad checksum — treat as noise and resync from the next byte
            continue;
          }
        }
        frames.push({
          dst: buf[i + 2] ?? 0,
          src: buf[i + 3] ?? 0,
          action: buf[i + 4] ?? 0,
          data: buf.slice(i + 6, i + 6 + len),
        });
        i = end;
        continue;
      }
      break; // incomplete frame starting at i — keep it for the next read
    }
    i += 1;
  }
  return { frames, consumed: i };
}

/** Convenience: parse all complete frames in a buffer (ignores leftover bytes). */
export function findFrames(buf: Uint8Array): RawFrame[] {
  return scanFrames(buf).frames;
}
