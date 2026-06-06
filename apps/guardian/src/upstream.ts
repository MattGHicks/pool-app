import net from "node:net";
import type { Upstream } from "./guardian.js";
import { logger } from "./logger.js";

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 15000];

/**
 * Persistent TCP connection to the ESP32 RS-485 bridge. The guardian holds this
 * open for its whole lifetime, so the ESP32 never sees the app's redeploy churn.
 * Auto-reconnects with backoff. Inbound bytes are handed to `onData` (forwarded
 * to the app when one is connected).
 */
export class UpstreamClient implements Upstream {
  private socket: net.Socket | null = null;
  private _connected = false;
  private closing = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onData: ((chunk: Buffer) => void) | null = null;
  onConnected: (() => void) | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    this.closing = false;
    this.open();
  }

  private open(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("connect", () => {
      this._connected = true;
      this.reconnectAttempt = 0;
      logger.info({ host: this.host, port: this.port }, "upstream (ESP32) connected");
      this.onConnected?.();
    });
    socket.on("data", (chunk: Buffer) => this.onData?.(chunk));
    socket.on("error", (err: Error) => logger.warn({ err: err.message }, "upstream socket error"));
    socket.on("close", () => this.onClose());
  }

  private onClose(): void {
    const wasConnected = this._connected;
    this._connected = false;
    this.socket = null;
    if (wasConnected) logger.warn({}, "upstream (ESP32) disconnected");
    if (!this.closing) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    const idx = Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1);
    const base = RECONNECT_DELAYS[idx] ?? 5000;
    const delay = base + Math.floor(base * 0.2 * Math.random());
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closing) this.open();
    }, delay);
  }

  write(bytes: Uint8Array): void {
    if (!this.socket || !this._connected) return;
    this.socket.write(Buffer.from(bytes));
  }

  close(): void {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this._connected = false;
  }
}
