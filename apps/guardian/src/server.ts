import net from "node:net";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { Guardian } from "./guardian.js";
import { UpstreamClient } from "./upstream.js";

/** How long the ESP32 link must stay down before we disturb pool-api. */
const UPSTREAM_LOST_GRACE_MS = 1500;

function main(): void {
  const upstream = new UpstreamClient(config.UPSTREAM_HOST, config.UPSTREAM_PORT, {
    idleTimeoutMs: config.UPSTREAM_IDLE_MS,
    connectTimeoutMs: config.UPSTREAM_CONNECT_TIMEOUT_MS,
  });
  const guardian = new Guardian(
    upstream,
    {
      pumpAddr: config.PUMP_ADDRESS,
      keepAliveMs: config.KEEP_ALIVE_MS,
      failoverMaxMs: config.FAILOVER_MAX_MS,
    },
    (msg, extra) => logger.info(extra ?? {}, msg),
  );

  // The single downstream client (pool-api). Latest connection wins so a redeploy's
  // fresh process cleanly supersedes a stale half-open socket.
  let client: net.Socket | null = null;

  upstream.onData = (chunk) => {
    // Pump → app: only meaningful while an app is connected; otherwise discard.
    if (client) client.write(chunk);
  };
  // When the ESP32 link stays down, tear down the app connection so pool-api gets
  // an immediate signal. Without this, pool-api sits on a stale guardian connection
  // running its own idle timer — a cascading timeout that can exceed the pump's
  // ~15 s revert window (12 s guardian + 12 s api = 24 s silence).
  //
  // But only when it STAYS down. This link drops and re-dials constantly (measured
  // reconnects land in 70-500 ms), and cutting pool-api on every one of those blips
  // tripled the system's connection churn the day it shipped — drops went from ~800
  // to ~2,445/day with stalls flat — for no benefit: the upstream is back long
  // before pool-api could have noticed anything. Waiting out a short grace period
  // keeps the cascading-timeout fix for real outages and drops the churn for blips.
  // The grace must stay well inside the revert window: 12 s detect + 1.5 s grace
  // still has pool-api reconnected and re-asserting around 14 s.
  let upstreamLostTimer: ReturnType<typeof setTimeout> | null = null;
  const clearUpstreamLostTimer = (): void => {
    if (upstreamLostTimer) {
      clearTimeout(upstreamLostTimer);
      upstreamLostTimer = null;
    }
  };
  upstream.onConnected = () => clearUpstreamLostTimer();
  upstream.onDisconnected = () => {
    if (upstreamLostTimer) return; // already counting down
    upstreamLostTimer = setTimeout(() => {
      upstreamLostTimer = null;
      if (upstream.connected || !client) return; // came back, or nobody to tell
      logger.warn(
        { graceMs: UPSTREAM_LOST_GRACE_MS },
        "upstream still down after grace — closing app connection so pool-api re-syncs",
      );
      client.destroy();
    }, UPSTREAM_LOST_GRACE_MS);
    upstreamLostTimer.unref?.();
  };
  upstream.start();

  const server = net.createServer((sock) => {
    if (client) {
      logger.warn({}, "second app connection — replacing the previous one");
      client.destroy();
    }
    client = sock;
    sock.setNoDelay(true);
    guardian.setClientConnected(true);

    sock.on("data", (chunk: Buffer) => {
      // App owns the bus while connected: forward its bytes verbatim, and observe
      // them to learn the last setpoint in case it vanishes.
      upstream.write(chunk);
      guardian.observe(chunk);
    });
    sock.on("error", (err: Error) => logger.warn({ err: err.message }, "app socket error"));
    sock.on("close", () => {
      if (client === sock) {
        client = null;
        guardian.setClientConnected(false);
      }
    });
  });

  server.on("error", (err: Error) => logger.error({ err: err.message }, "guardian server error"));
  server.listen(config.PORT, "0.0.0.0", () => {
    logger.info(
      { port: config.PORT, upstream: `${config.UPSTREAM_HOST}:${config.UPSTREAM_PORT}` },
      "pump-guardian listening",
    );
  });

  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, "guardian shutting down");
    // Don't force a release: if we're mid-hold, dropping the keep-alive lets the
    // pump revert on its own timeout — and the app reconnecting elsewhere is rare.
    guardian.dispose();
    clearUpstreamLostTimer();
    if (client) client.destroy();
    server.close();
    upstream.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
