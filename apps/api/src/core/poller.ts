import { statusRequest } from "@pool/protocol";
import type { CommandQueue } from "./commandQueue.js";
import { logger } from "../logger.js";

/** Periodically requests pump status. Replies arrive async via BridgeConnection.onStatus. */
export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly queue: CommandQueue,
    private readonly pumpAddr: number,
    private pollMs: number,
  ) {}

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setPollMs(ms: number): void {
    this.pollMs = ms;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.poll(), ms);
    }
  }

  private poll(): void {
    this.queue
      .send(statusRequest(this.pumpAddr), "status")
      .catch((err) => logger.debug({ err: (err as Error).message }, "status poll failed"));
  }
}
