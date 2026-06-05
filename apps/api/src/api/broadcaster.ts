import type { Server } from "socket.io";
import type { TelemetryDTO, ControlStateDTO, HealthDTO } from "@pool/types";

export interface EventPayload {
  type: string;
  detail: Record<string, unknown>;
  ts: number;
}

/** Pushes live updates to all clients on the /live namespace. */
export class Broadcaster {
  constructor(private readonly io: Server) {}

  telemetry(t: TelemetryDTO): void {
    this.io.of("/live").emit("telemetry", t);
  }
  controlState(s: ControlStateDTO): void {
    this.io.of("/live").emit("controlState", s);
  }
  health(h: HealthDTO): void {
    this.io.of("/live").emit("health", h);
  }
  event(e: EventPayload): void {
    this.io.of("/live").emit("event", e);
  }
}
