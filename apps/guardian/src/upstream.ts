import net from "node:net";
import type { Upstream } from "./guardian.js";
import { logger } from "./logger.js";

// Bounded on purpose — see the matching note in pool-api's BridgeConnection.
const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000];
const IDLE_CHECK_MS = 1000;
/** Don't log every dropped byte-chunk during an outage; one line per this window. */
const DROP_LOG_INTERVAL_MS = 10_000;

export interface UpstreamOptions {
  /** Force a reconnect when the link goes quiet this long while still "connected". */
  idleTimeoutMs?: number;
  /** Abandon a connect attempt that hasn't completed in this long. */
  connectTimeoutMs?: number;
}

/**
 * Persistent TCP connection to the ESP32 RS-485 bridge. The guardian holds this
 * open for its whole lifetime, so the ESP32 never sees the app's redeploy churn.
 * Auto-reconnects with backoff. Inbound bytes are handed to `onData` (forwarded
 * to the app when one is connected).
 *
 * Because this side owns the physical link, it also owns detecting when that link
 * has gone quiet without closing: a stalled WiFi connection keeps the socket
 * open, so `connected` alone is not evidence that commands are reaching the pump.
 */
export class UpstreamClient implements Upstream {
  private socket: net.Socket | null = null;
  private _connected = false;
  private closing = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  private readonly idleTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  private lastRxAt = 0;
  private droppedWrites = 0;
  private lastDropLogAt = 0;

  onData: ((chunk: Buffer) => void) | null = null;
  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    opts: UpstreamOptions = {},
  ) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 12_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 8_000;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Byte-chunks discarded because the ESP32 link was down. */
  get dropped(): number {
    return this.droppedWrites;
  }

  start(): void {
    this.closing = false;
    this.open();
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => this.checkIdle(), IDLE_CHECK_MS);
      this.idleTimer.unref?.();
    }
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
    socket.setKeepAlive(true, 5_000);
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this._connected) {
        logger.warn(
          { host: this.host, port: this.port, timeoutMs: this.connectTimeoutMs },
          "upstream connect timed out — retrying",
        );
        socket.destroy();
      }
    }, this.connectTimeoutMs);
    this.connectTimer.unref?.();
    socket.on("connect", () => {
      this._connected = true;
      this.reconnectAttempt = 0;
      this.lastRxAt = Date.now();
      this.clearConnectTimer();
      logger.info({ host: this.host, port: this.port }, "upstream (ESP32) connected");
      this.onConnected?.();
    });
    socket.on("data", (chunk: Buffer) => {
      this.lastRxAt = Date.now();
      this.onData?.(chunk);
    });
    socket.on("error", (err: Error) => logger.warn({ err: err.message }, "upstream socket error"));
    socket.on("close", () => this.onClose());
  }

  /**
   * Tear down a link that has gone quiet. The app polls the pump at 1 Hz, so an
   * upstream that produces nothing for many seconds is not idle — it's dead, and
   * the pump is meanwhile receiving no keep-alive.
   */
  private checkIdle(): void {
    if (!this._connected || this.closing || this.lastRxAt === 0) return;
    const idleMs = Date.now() - this.lastRxAt;
    if (idleMs < this.idleTimeoutMs) return;
    logger.warn({ idleMs, idleTimeoutMs: this.idleTimeoutMs }, "upstream stalled — forcing reconnect");
    this.socket?.destroy(); // 'close' schedules the reconnect
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private onClose(): void {
    const wasConnected = this._connected;
    this._connected = false;
    this.socket = null;
    this.clearConnectTimer();
    if (wasConnected) {
      logger.warn({}, "upstream (ESP32) disconnected");
      // The peer was alive moments ago — retry from the shortest delay rather
      // than inheriting an escalated one from an earlier outage.
      this.reconnectAttempt = 0;
      this.onDisconnected?.();
    }
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

  /**
   * Send bytes to the ESP32. Returns false when the link is down and the bytes
   * were discarded — these are usually the app's keep-alive, and dropping them
   * without a trace is how the pump ends up reverting with nothing in any log to
   * explain it.
   */
  write(bytes: Uint8Array): boolean {
    if (!this.socket || !this._connected) {
      this.droppedWrites += 1;
      const now = Date.now();
      if (now - this.lastDropLogAt > DROP_LOG_INTERVAL_MS) {
        this.lastDropLogAt = now;
        logger.warn(
          { droppedWrites: this.droppedWrites },
          "discarding bus writes — upstream (ESP32) is down, pump is receiving no keep-alive",
        );
      }
      return false;
    }
    this.socket.write(Buffer.from(bytes));
    return true;
  }

  close(): void {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.clearConnectTimer();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this._connected = false;
  }
}
