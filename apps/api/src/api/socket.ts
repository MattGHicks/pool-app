import type { Server, Socket } from "socket.io";
import { SetRpmRequest } from "@pool/types";
import { COOKIE_NAME, verifySessionToken } from "./auth.js";
import type { ControlState } from "../core/controlState.js";

type Ack = ((response: unknown) => void) | undefined;

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function authMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const token = cookieValue(socket.handshake.headers.cookie, COOKIE_NAME);
  if (verifySessionToken(token)) next();
  else next(new Error("unauthorized"));
}

/** Wire the /live (telemetry) and /control (commands) namespaces. */
export function setupSocket(io: Server, state: ControlState): void {
  const live = io.of("/live");
  live.use(authMiddleware);
  live.on("connection", (socket) => {
    socket.emit("controlState", state.toDTO());
    if (state.lastStatus) socket.emit("status", state.lastStatus);
  });

  const control = io.of("/control");
  control.use(authMiddleware);
  control.on("connection", (socket) => {
    socket.on("setRpm", (raw: unknown, ack: Ack) => {
      const parsed = SetRpmRequest.safeParse(raw);
      if (!parsed.success) {
        ack?.({ ok: false, error: "invalid" });
        return;
      }
      state.setManual(parsed.data.rpm, parsed.data.durationMinutes);
      ack?.({ ok: true, control: state.toDTO() });
    });
    socket.on("resumeSchedule", (_raw: unknown, ack: Ack) => {
      state.resumeSchedule();
      ack?.({ ok: true, control: state.toDTO() });
    });
    socket.on("off", (_raw: unknown, ack: Ack) => {
      state.setOff();
      ack?.({ ok: true, control: state.toDTO() });
    });
  });
}
