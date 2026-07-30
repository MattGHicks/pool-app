import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { BridgeConnection } from "../src/bridge/connection.js";
import { CommandQueue } from "../src/core/commandQueue.js";

/**
 * Regression tests for the failure mode behind the observed pump ramp down/up:
 * the bridge link stalling while the TCP socket stayed open, so the pump lost its
 * keep-alive for minutes with nothing detecting it — and then the whole queued
 * backlog landing on the bus at once when the link recovered.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A stand-in for the ESP32 that accepts connections and then says nothing. */
function silentServer(): Promise<{
  port: number;
  connections: number;
  sockets: net.Socket[];
  close: () => Promise<void>;
}> {
  const sockets: net.Socket[] = [];
  const state = { port: 0, connections: 0, sockets, close: async () => {} };
  const server = net.createServer((sock) => {
    state.connections += 1;
    sockets.push(sock);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      state.port = (server.address() as net.AddressInfo).port;
      state.close = () =>
        new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        });
      resolve(state);
    });
  });
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

describe("BridgeConnection liveness", () => {
  it("forces a reconnect when an open socket goes quiet", async () => {
    const srv = await silentServer();
    cleanup.push(() => srv.close());

    const bridge = new BridgeConnection("127.0.0.1", srv.port, 0x60, {
      idleTimeoutMs: 300,
      connectTimeoutMs: 1000,
      writeTimeoutMs: 500,
    });
    cleanup.push(() => bridge.close());

    const stalls: number[] = [];
    bridge.onStall((ms) => stalls.push(ms));
    bridge.start();

    // Long enough for: connect, idle out, tear down, reconnect (500 ms backoff).
    await sleep(2000);

    expect(stalls.length).toBeGreaterThanOrEqual(1);
    expect(stalls[0]).toBeGreaterThanOrEqual(300);
    // A silent peer must be dropped and redialed, not held open forever.
    expect(srv.connections).toBeGreaterThanOrEqual(2);
  });

  it("does not reconnect while the peer keeps talking", async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((sock) => {
      sockets.push(sock);
      // Junk bytes are enough: liveness is about the link carrying traffic, and
      // scanFrames just discards anything that isn't a valid frame.
      const t = setInterval(() => sock.write(Buffer.from([0x00])), 50);
      sock.on("close", () => clearInterval(t));
    });
    let connections = 0;
    server.on("connection", () => (connections += 1));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
    );

    const bridge = new BridgeConnection("127.0.0.1", port, 0x60, {
      idleTimeoutMs: 300,
      connectTimeoutMs: 1000,
    });
    cleanup.push(() => bridge.close());
    const stalls: number[] = [];
    bridge.onStall((ms) => stalls.push(ms));
    bridge.start();

    await sleep(1500);

    expect(stalls).toEqual([]);
    expect(connections).toBe(1);
    expect(bridge.connected).toBe(true);
  });
});

describe("CommandQueue backlog handling", () => {
  /**
   * A bridge whose write hangs and then fails, like a socket on a stalled link
   * hitting BridgeConnection's write timeout. The hang has to outlast
   * MAX_JOB_AGE_MS so the frames waiting behind it genuinely go stale.
   */
  class WedgedBridge {
    writes = 0;
    constructor(private readonly hangMs = 2500) {}
    write(): Promise<void> {
      this.writes += 1;
      return new Promise<void>((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error("bridge write timed out")), this.hangMs);
        t.unref?.();
      });
    }
  }

  const asBridge = (b: WedgedBridge): BridgeConnection => b as unknown as BridgeConnection;

  it("discards stale frames instead of flooding the bus on recovery", async () => {
    const bridge = new WedgedBridge(2500);
    const queue = new CommandQueue(asBridge(bridge));

    // The first send wedges the drain loop; the rest pile up behind it.
    const results = [
      queue.send(new Uint8Array([1]), "keep-alive"),
      queue.send(new Uint8Array([2]), "status"),
      queue.send(new Uint8Array([3]), "status"),
    ];
    results.forEach((p) => void p.catch(() => {}));
    expect(queue.depth).toBe(2);

    const settled = await Promise.allSettled(results);

    // The in-flight frame fails on the write timeout; the backlog aged past
    // MAX_JOB_AGE_MS while waiting, so it is dropped rather than sent.
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    for (const s of settled.slice(1)) {
      if (s.status === "rejected") expect(String(s.reason)).toMatch(/stale/);
    }
    expect(bridge.writes).toBe(1);
    expect(queue.dropped).toBe(2);
  }, 10_000);

  it("caps depth so a wedged write cannot grow the backlog without bound", async () => {
    const bridge = new WedgedBridge(60_000);
    const queue = new CommandQueue(asBridge(bridge));
    for (let i = 0; i < 200; i += 1) {
      void queue.send(new Uint8Array([i & 0xff]), "flood").catch(() => {});
    }
    expect(queue.depth).toBeLessThanOrEqual(64);
    expect(queue.dropped).toBeGreaterThan(0);
    expect(bridge.writes).toBe(1);
  });
});
