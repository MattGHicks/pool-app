import net from "node:net";
import type { Upstream } from "./guardian.js";
import { logger } from "./logger.js";

// Bounded on purpose — see the matching note in pool-api's BridgeConnection.
const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000];
const IDLE_CHECK_MS = 1000;
/** Don't log every dropped byte-chunk during an outage; one line per this window. */
const DROP_LOG_INTERVAL_MS = 10_000;
/**
 * A bridge that accepts TCP but never relays a serial byte is not a blip: its
 * RS-485 side is down (dead MAX485, disconnected bus, pump unpowered). Redialling
 * every idleTimeoutMs then achieves nothing and actively harms recovery — each
 * dial burns one of the ESP32's CONFIG_LWIP_MAX_SOCKETS (10) sockets, and once
 * they're exhausted the device refuses connections on every listener while still
 * answering ping. After this many consecutive connections that carried no bytes,
 * back off hard and say plainly what is wrong.
 */
const SILENT_CYCLES_BEFORE_BACKOFF = 3;
const SILENT_RECONNECT_MS = 30_000;

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
  /** Set by checkIdle so scheduleReconnect skips the backoff delay. */
  private stallTriggered = false;
  /** Has the CURRENT connection carried at least one byte? */
  private rxSinceConnect = false;
  /** Consecutive connections that stalled without ever carrying a byte. */
  private silentCycles = 0;

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
      this.rxSinceConnect = false;
      this.clearConnectTimer();
      logger.info({ host: this.host, port: this.port }, "upstream (ESP32) connected");
      this.onConnected?.();
    });
    socket.on("data", (chunk: Buffer) => {
      this.lastRxAt = Date.now();
      // Bytes are flowing, so whatever was wrong with the serial side has cleared.
      this.rxSinceConnect = true;
      this.silentCycles = 0;
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
    if (this.rxSinceConnect) {
      this.silentCycles = 0;
    } else {
      this.silentCycles += 1;
      if (this.silentCycles === SILENT_CYCLES_BEFORE_BACKOFF) {
        logger.error(
          { silentCycles: this.silentCycles, backoffMs: SILENT_RECONNECT_MS },
          "ESP32 accepts TCP but has relayed no RS-485 bytes across repeated connections — " +
            "its serial side is down. Check the MAX485 wiring, the bus at the pad, and pump " +
            "power. Backing off so we stop exhausting the bridge's socket table.",
        );
      }
    }
    logger.warn({ idleMs, idleTimeoutMs: this.idleTimeoutMs }, "upstream stalled — forcing reconnect");
    this.stallTriggered = true; // tell scheduleReconnect to skip the backoff delay
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
    // A link that connects but never carries bytes needs the opposite of urgency:
    // dialling it faster only exhausts the bridge's sockets and floods the log.
    if (this.silentCycles >= SILENT_CYCLES_BEFORE_BACKOFF) {
      this.stallTriggered = false;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.closing) this.open();
      }, SILENT_RECONNECT_MS);
      this.reconnectTimer.unref?.();
      return;
    }
    // After a stall, every second counts inside the pump's revert window — skip
    // the backoff entirely and dial again immediately. (reconnectAttempt is
    // already 0 here: onClose resets it whenever we were connected.)
    if (this.stallTriggered) {
      this.stallTriggered = false;
      if (!this.closing) this.open();
      return;
    }
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
