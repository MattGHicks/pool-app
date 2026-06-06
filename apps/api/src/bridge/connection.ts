import net from "node:net";
import {
  scanFrames,
  decodeStatus,
  isPumpStatus,
  type PumpStatus,
  type RawFrame,
} from "@pool/protocol";
import { logger } from "../logger.js";

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 15000];
const MAX_RX_BUFFER = 4096;

type StatusCb = (status: PumpStatus) => void;
type FrameCb = (frame: RawFrame) => void;
type VoidCb = () => void;
type ReasonCb = (reason: string) => void;

/**
 * Owns the single TCP connection to the ESP32 RS-485 bridge. The ONLY writer in
 * the system. Parses the inbound byte stream into frames (retaining partial
 * frames across TCP chunks) and emits decoded pump status. Reconnects with
 * exponential backoff. All writes go through write(); serialization is the
 * CommandQueue's job.
 */
export class BridgeConnection {
  private socket: net.Socket | null = null;
  private rxBuf = new Uint8Array(0);
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private _connected = false;

  lastRxAt = 0;
  lastTxAt = 0;

  private statusCbs: StatusCb[] = [];
  private frameCbs: FrameCb[] = [];
  private connectedCbs: VoidCb[] = [];
  private disconnectedCbs: ReasonCb[] = [];

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly pumpAddr: number,
  ) {}

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
      this.rxBuf = new Uint8Array(0);
      logger.info({ host: this.host, port: this.port }, "bridge connected");
      for (const cb of this.connectedCbs) cb();
    });
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err: Error) => logger.warn({ err: err.message }, "bridge socket error"));
    socket.on("close", () => this.onClose("close"));
  }

  private onData(chunk: Buffer): void {
    this.lastRxAt = Date.now();
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
    if (wasConnected) {
      logger.warn({ reason }, "bridge disconnected");
      for (const cb of this.disconnectedCbs) cb(reason);
    }
    if (!this.closing) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    const idx = Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1);
    const base = RECONNECT_DELAYS[idx]!;
    const delay = base + Math.floor(base * 0.2 * Math.random());
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closing) this.open();
    }, delay);
  }

  /** Write raw bytes to the bus. Rejects if not connected. */
  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !this._connected) {
        reject(new Error("bridge not connected"));
        return;
      }
      this.lastTxAt = Date.now();
      socket.write(Buffer.from(bytes), (err) => (err ? reject(err) : resolve()));
    });
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
