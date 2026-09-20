import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { UpstreamClient } from "../src/upstream.js";

/**
 * The guardian owns the ESP32 link, so it owns noticing when that link has gone
 * quiet without closing — and it must not swallow bus writes silently when the
 * link is down, since those writes are the pump's keep-alive.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

describe("UpstreamClient", () => {
  it("reports dropped writes instead of discarding them silently", () => {
    // Never started, so never connected — every write is a discard.
    const up = new UpstreamClient("127.0.0.1", 1);
    expect(up.connected).toBe(false);
    expect(up.write(new Uint8Array([0xff, 0x00]))).toBe(false);
    expect(up.write(new Uint8Array([0xff, 0x00]))).toBe(false);
    expect(up.dropped).toBe(2);
  });

  it("rebuilds a connection that stops carrying bytes", async () => {
    const sockets: net.Socket[] = [];
    let connections = 0;
    const server = net.createServer((sock) => {
      connections += 1;
      sockets.push(sock); // accept, then stay silent
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
    );

    const up = new UpstreamClient("127.0.0.1", port, {
      idleTimeoutMs: 300,
      connectTimeoutMs: 1000,
    });
    cleanup.push(() => up.close());
    let drops = 0;
    up.onDisconnected = () => (drops += 1);
    up.start();

    await sleep(2000);

    expect(drops).toBeGreaterThanOrEqual(1);
    expect(connections).toBeGreaterThanOrEqual(2);
  });

  it("backs off a bridge that accepts TCP but never relays a byte", async () => {
    // The 2026-09-14 failure: the ESP32 answered ping and accepted every TCP dial,
    // but its RS-485 side was dead, so nothing ever came back. Redialling on each
    // idle timeout burned the device's 10 lwIP sockets until it refused every
    // connection. The client must recognise a silent link and stop hammering it.
    const sockets: net.Socket[] = [];
    let connections = 0;
    const server = net.createServer((sock) => {
      connections += 1;
      sockets.push(sock); // accept, then never write a single byte
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
    );

    const up = new UpstreamClient("127.0.0.1", port, {
      idleTimeoutMs: 200,
      connectTimeoutMs: 1000,
    });
    cleanup.push(() => up.close());
    up.start();

    await sleep(6000);

    // The idle check ticks once a second, so an unfixed client redials ~6 times in
    // this window and keeps going. With the backoff it dials 3 times, notices the
    // link has never carried a byte, and then sits out a 30 s pause — so the count
    // plateaus well below the window length. The gap is what proves the plateau.
    expect(connections).toBeGreaterThanOrEqual(3);
    expect(connections).toBeLessThanOrEqual(4);
  }, 20_000); // the 6 s observation window exceeds vitest's 5 s default

  it("keeps a talkative connection up", async () => {
    const sockets: net.Socket[] = [];
    let connections = 0;
    const server = net.createServer((sock) => {
      connections += 1;
      sockets.push(sock);
      const t = setInterval(() => sock.write(Buffer.from([0x00])), 50);
      sock.on("close", () => clearInterval(t));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
    );

    const up = new UpstreamClient("127.0.0.1", port, { idleTimeoutMs: 300 });
    cleanup.push(() => up.close());
    up.start();

    await sleep(1500);

    expect(connections).toBe(1);
    expect(up.connected).toBe(true);
    expect(up.write(new Uint8Array([0xff]))).toBe(true);
    expect(up.dropped).toBe(0);
  });
});
