import net from "node:net";
import {
  scanFrames,
  decodeStatus,
  isPumpStatus,
  type PumpStatus,
  type RawFrame,
} from "@pool/protocol";
import { logger } from "../logger.js";

// Bounded on purpose: the bridge is a LAN device that should come back fast. A
// high ceiling here silently turns a short ESP32 absence into a command gap
// longer than the pump's ~3·KEEP_ALIVE_MS revert window.
const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000];
const MAX_RX_BUFFER = 4096;
const IDLE_CHECK_MS = 1000;
/**
 * A bridge that accepts TCP but never delivers a frame is not a blip: the RS-485
 * side is down. Redialling every idleTimeoutMs cannot fix that and makes recovery
 * harder — each dial consumes one of the ESP32's 10 lwIP sockets, and an exhausted
 * table makes it refuse connections outright while still answering ping. Back off
 * after this many consecutive connections that carried nothing.
 */
const SILENT_CYCLES_BEFORE_BACKOFF = 3;
const SILENT_RECONNECT_MS = 30_000;

type StatusCb = (status: PumpStatus) => void;
type FrameCb = (frame: RawFrame) => void;
type VoidCb = () => void;
type ReasonCb = (reason: string) => void;
type StallCb = (idleMs: number) => void;

export interface BridgeOptions {
  /**
   * Force a reconnect when no valid frame has arrived for this long while the
   * socket still claims to be connected. This is the liveness check: a stalled
   * WiFi link leaves the TCP connection open indefinitely, so without it the
   * pump can sit without keep-alive for minutes and revert to its onboard
   * schedule while the app happily reports "connected".
   */
  idleTimeoutMs?: number;
  /** Abandon a connect attempt that hasn't completed in this long. */
  connectTimeoutMs?: number;
  /** Fail a write whose flush hasn't been acknowledged in this long. */
  writeTimeoutMs?: number;
}

/**
 * Owns the single TCP connection to the ESP32 RS-485 bridge. The ONLY writer in
 * the system. Parses the inbound byte stream into frames (retaining partial
 * frames across TCP chunks) and emits decoded pump status. Reconnects with
 * exponential backoff. All writes go through write(); serialization is the
 * CommandQueue's job.
 *
 * A TCP socket that stays open but stops carrying bytes is indistinguishable
 * from a healthy idle one at the socket level, so this class does not trust
 * `connected` alone: it tracks `lastRxAt` and forces a reconnect once the link
 * goes quiet for longer than `idleTimeoutMs`.
 */
export class BridgeConnection {
  private socket: net.Socket | null = null;
  private rxBuf = new Uint8Array(0);
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  private _connected = false;
  /** Set by checkIdle so scheduleReconnect skips the backoff delay. */
  private stallTriggered = false;
  /** Has the CURRENT connection carried at least one byte? */
  private rxSinceConnect = false;
  /** Consecutive connections that stalled without ever carrying a byte. */
  private silentCycles = 0;

  private readonly idleTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  lastRxAt = 0;
  lastTxAt = 0;

  private statusCbs: StatusCb[] = [];
  private frameCbs: FrameCb[] = [];
  private connectedCbs: VoidCb[] = [];
  private disconnectedCbs: ReasonCb[] = [];
  private stallCbs: StallCb[] = [];

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly pumpAddr: number,
    opts: BridgeOptions = {},
  ) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 12_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 8_000;
    this.writeTimeoutMs = opts.writeTimeoutMs ?? 3_000;
  }

  get connected(): boolean {
    return this._connected;
  }

  onStatus(cb: StatusCb): void {
    this.statusCbs.push(cb);
  }
  onFrame(cb: FrameCb): void {
    this.frameCbs.push(cb);
  }
  onConnected(cb: VoidCb): void {
    this.connectedCbs.push(cb);
  }
  onDisconnected(cb: ReasonCb): void {
    this.disconnectedCbs.push(cb);
  }
  /** Fired when the link went quiet long enough that we tore it down ourselves. */
  onStall(cb: StallCb): void {
    this.stallCbs.push(cb);
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
    // Let the OS notice a peer that vanished without a FIN. This is a backstop on
    // a much longer timescale than our own idle check, not a replacement for it.
    socket.setKeepAlive(true, 5_000);
    // A connect() to a blackholed host would otherwise hang for the OS SYN
    // timeout (~2 min on Linux) with no retry in flight.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this._connected) {
        logger.warn(
          { host: this.host, port: this.port, timeoutMs: this.connectTimeoutMs },
          "bridge connect timed out — retrying",
        );
        socket.destroy();
      }
    }, this.connectTimeoutMs);
    this.connectTimer.unref?.();
    socket.on("connect", () => {
      this._connected = true;
      this.reconnectAttempt = 0;
      this.rxBuf = new Uint8Array(0);
      // Start the idle clock now: without this the check would compare against a
      // stale (or zero) timestamp and fire immediately after connecting.
      this.lastRxAt = Date.now();
      this.rxSinceConnect = false;
      this.clearConnectTimer();
      logger.info({ host: this.host, port: this.port }, "bridge connected");
      for (const cb of this.connectedCbs) cb();
    });
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err: Error) => logger.warn({ err: err.message }, "bridge socket error"));
    socket.on("close", () => this.onClose("close"));
  }

  /**
   * The liveness check. The pump reverts to its onboard schedule after roughly
   * 3·KEEP_ALIVE_MS without a command, so a quiet link has to be caught and
   * rebuilt well inside that window — an open-but-dead socket is the one failure
   * mode that would otherwise go completely unnoticed.
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
          "bridge accepts TCP but has delivered no pump frames across repeated connections — " +
            "the RS-485 side is down. Check the MAX485 wiring, the bus at the pad, and pump " +
            "power. Backing off so we stop exhausting the bridge's socket table.",
        );
      }
    }
    logger.warn({ idleMs, idleTimeoutMs: this.idleTimeoutMs }, "bridge stalled — forcing reconnect");
    for (const cb of this.stallCbs) cb(idleMs);
    this.stallTriggered = true; // tell scheduleReconnect to skip the backoff delay
    this.socket?.destroy(); // 'close' schedules the reconnect
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private onData(chunk: Buffer): void {
    this.lastRxAt = Date.now();
    // Bytes are flowing, so whatever was wrong with the serial side has cleared.
    this.rxSinceConnect = true;
    this.silentCycles = 0;
    const merged = new Uint8Array(this.rxBuf.length + chunk.length);
    merged.set(this.rxBuf, 0);
    merged.set(chunk, this.rxBuf.length);
    const { frames, consumed } = scanFrames(merged, { verifyChecksum: true });
    this.rxBuf = merged.slice(consumed);
    if (this.rxBuf.length > MAX_RX_BUFFER) this.rxBuf = new Uint8Array(0);
    for (const f of frames) {
      for (const cb of this.frameCbs) cb(f);
      if (isPumpStatus(f, this.pumpAddr) && f.data.length >= 15) {
        const status = decodeStatus(f.data);
        for (const cb of this.statusCbs) cb(status);
      }
    }
  }

  private onClose(reason: string): void {
    const wasConnected = this._connected;
    this._connected = false;
    this.socket = null;
    this.clearConnectTimer();
    if (wasConnected) {
      logger.warn({ reason }, "bridge disconnected");
      // We had a working link a moment ago, so the peer is probably still there.
      // Retry from the shortest delay instead of inheriting an escalated one.
      this.reconnectAttempt = 0;
      for (const cb of this.disconnectedCbs) cb(reason);
    }
    if (!this.closing) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    // A link that connects but never carries frames needs the opposite of urgency:
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
    const base = RECONNECT_DELAYS[idx]!;
    const delay = base + Math.floor(base * 0.2 * Math.random());
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closing) this.open();
    }, delay);
  }

  /**
   * Write raw bytes to the bus. Rejects if not connected, or if the flush isn't
   * acknowledged within writeTimeoutMs — on a stalled socket the callback never
   * fires, which would otherwise wedge the CommandQueue's drain loop for as long
   * as the stall lasts and then dump the whole backlog onto the bus at once.
   */
  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !this._connected) {
        reject(new Error("bridge not connected"));
        return;
      }
      this.lastTxAt = Date.now();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`bridge write timed out after ${this.writeTimeoutMs}ms`));
      }, this.writeTimeoutMs);
      timer.unref?.();
      socket.write(Buffer.from(bytes), (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
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
