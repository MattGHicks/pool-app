import type { BridgeConnection } from "../bridge/connection.js";
import { logger } from "../logger.js";

interface Job {
  bytes: Uint8Array;
  label: string;
  queuedAt: number;
  resolve: () => void;
  reject: (e: Error) => void;
}

const INTER_COMMAND_GAP_MS = 30;
/**
 * Frames older than this are dropped instead of sent. Everything we put on the
 * bus is either a 1 Hz status poll or an idempotent keep-alive that the engine
 * re-sends every KEEP_ALIVE_MS, so a frame that has been waiting seconds is
 * worthless — and delivering the backlog would flood a half-duplex bus.
 */
const MAX_JOB_AGE_MS = 2_000;
/** Hard ceiling so a wedged write can't grow the backlog without bound. */
const MAX_QUEUE_DEPTH = 64;

/**
 * Serializes all writes to the single RS-485 bus. Half-duplex: only one frame
 * on the wire at a time. A small gap between commands lets the bus settle.
 *
 * The queue is deliberately lossy. When the link stalls, the in-flight write
 * blocks and work piles up behind it; replaying that backlog on recovery would
 * put minutes of stale commands and status requests on the wire back-to-back.
 * Dropping them is both safe and correct — the engine re-asserts current intent
 * on its next tick.
 */
export class CommandQueue {
  private queue: Job[] = [];
  private draining = false;
  private _dropped = 0;

  constructor(private readonly bridge: BridgeConnection) {}

  get depth(): number {
    return this.queue.length;
  }

  /** Frames discarded as stale or over-capacity, for health reporting. */
  get dropped(): number {
    return this._dropped;
  }

  send(bytes: Uint8Array, label = "cmd"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.queue.length >= MAX_QUEUE_DEPTH) {
        const oldest = this.queue.shift();
        if (oldest) {
          this._dropped += 1;
          oldest.reject(new Error("command queue overflow"));
        }
      }
      this.queue.push({ bytes, label, queuedAt: Date.now(), resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        const ageMs = Date.now() - job.queuedAt;
        if (ageMs > MAX_JOB_AGE_MS) {
          this._dropped += 1;
          logger.debug({ label: job.label, ageMs }, "dropping stale command");
          job.reject(new Error(`stale command discarded after ${ageMs}ms`));
          continue; // no bus gap needed — nothing went on the wire
        }
        try {
          await this.bridge.write(job.bytes);
          job.resolve();
        } catch (err) {
          logger.debug({ label: job.label, err: (err as Error).message }, "command write failed");
          job.reject(err as Error);
        }
        await sleep(INTER_COMMAND_GAP_MS);
      }
    } finally {
      this.draining = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
