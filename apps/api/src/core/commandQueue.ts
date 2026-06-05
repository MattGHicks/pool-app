import type { BridgeConnection } from "../bridge/connection.js";
import { logger } from "../logger.js";

interface Job {
  bytes: Uint8Array;
  label: string;
  resolve: () => void;
  reject: (e: Error) => void;
}

const INTER_COMMAND_GAP_MS = 30;

/**
 * Serializes all writes to the single RS-485 bus. Half-duplex: only one frame
 * on the wire at a time. A small gap between commands lets the bus settle.
 */
export class CommandQueue {
  private queue: Job[] = [];
  private draining = false;

  constructor(private readonly bridge: BridgeConnection) {}

  get depth(): number {
    return this.queue.length;
  }

  send(bytes: Uint8Array, label = "cmd"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ bytes, label, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
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
