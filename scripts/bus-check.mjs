#!/usr/bin/env node
/**
 * Is the RS-485 path actually carrying data?
 *
 * The bridge answers ping and accepts TCP with its serial side stone dead — that
 * is the whole shape of the 2026-09-14 outage. So this does NOT just listen: the
 * pump only speaks when polled, and with the guardian's silent-link backoff there
 * are 30 s windows where nothing polls. A passive listener reports a false "dead"
 * in those windows. This sends real status requests and counts what comes back.
 *
 *   node scripts/bus-check.mjs            # poll the pump, report
 *   node scripts/bus-check.mjs --watch    # repeat until the bus comes back
 *
 * Works for the loopback bisect too (GPIO25 jumpered to GPIO26, MAX485 bypassed):
 * it tells you whether what came back was our own frame echoed or a real reply.
 */
import net from "node:net";

const HOST = process.env.BRIDGE_HOST ?? "192.168.4.60";
const PORT = Number(process.env.BRIDGE_PORT ?? 8899);
const WATCH = process.argv.includes("--watch");

// FF 00 FF | A5 00 {dst=pump} {src=us} {action=status} {len=0} | ck_hi ck_lo
const body = [0xa5, 0x00, 0x60, 0x21, 0x07, 0x00];
const sum = body.reduce((a, b) => a + b, 0);
const POLL = Buffer.from([0xff, 0x00, 0xff, ...body, (sum >> 8) & 0xff, sum & 0xff]);

const ts = () => new Date().toTimeString().slice(0, 8);

function probe() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: HOST, port: PORT });
    const chunks = [];
    let polls = 0;
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(result);
    };

    sock.setTimeout(15000, () => finish({ ok: false, why: "timed out opening the bridge" }));
    sock.on("error", (e) =>
      finish({
        ok: false,
        why:
          e.code === "ECONNREFUSED"
            ? "bridge refused the connection — its sockets are full; stop pool-guardian and wait ~90 s"
            : e.message,
      }),
    );
    sock.on("connect", () => {
      const send = () => {
        if (!sock.destroyed) {
          sock.write(POLL);
          polls += 1;
        }
      };
      send();
      const t = setInterval(() => (polls >= 8 ? clearInterval(t) : send()), 1000);
    });
    sock.on("data", (c) => chunks.push(c));

    setTimeout(() => {
      const rx = Buffer.concat(chunks);
      if (rx.length === 0) return finish({ ok: false, polls, why: "0 bytes back - the pump is not answering" });
      // In the loopback bisect we get our OWN frame back; from a pump we get a status reply.
      const echoed = rx.includes(POLL);
      return finish({
        ok: true,
        polls,
        bytes: rx.length,
        echoed,
        hex: rx.subarray(0, 48).toString("hex").match(/../g).join(" "),
      });
    }, 10_000);
  });
}

const report = (r) => {
  if (r.ok) {
    console.log(`${ts()}  OK   ${r.bytes} bytes back from ${r.polls} polls`);
    console.log(
      r.echoed
        ? "     ECHO - this is our own frame returning. Loopback confirmed: the ESP32,\n     its firmware and the UART all work. The fault is the MAX485 or past it."
        : "     REAL REPLY - the pump is talking. The bus is alive; the app picks it up\n     within 30 s on its own.",
    );
    console.log(`     ${r.hex}`);
  } else {
    console.log(`${ts()}  DEAD ${r.why}${r.polls ? ` (${r.polls} polls sent)` : ""}`);
  }
};

if (WATCH) {
  for (;;) {
    const r = await probe();
    report(r);
    if (r.ok) break;
  }
} else {
  const r = await probe();
  report(r);
  process.exit(r.ok ? 0 : 1);
}
