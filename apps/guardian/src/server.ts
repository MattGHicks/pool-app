import net from "node:net";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { Guardian } from "./guardian.js";
import { UpstreamClient } from "./upstream.js";

function main(): void {
  const upstream = new UpstreamClient(config.UPSTREAM_HOST, config.UPSTREAM_PORT);
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
    if (client) client.destroy();
    server.close();
    upstream.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
