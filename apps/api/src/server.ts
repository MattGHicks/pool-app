import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Server as IOServer } from "socket.io";
import type { TelemetryDTO } from "@pool/types";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { BridgeConnection } from "./bridge/connection.js";
import { CommandQueue } from "./core/commandQueue.js";
import { ControlState } from "./core/controlState.js";
import { Engine } from "./core/engine.js";
import { Poller } from "./core/poller.js";
import { Scheduler } from "./core/scheduler.js";
import { Watchdog } from "./core/watchdog.js";
import { migrate } from "./db/migrate.js";
import { pingDb, isDbConnected, closeDb } from "./db/pool.js";
import * as schedulesRepo from "./db/repos/schedules.js";
import * as settingsRepo from "./db/repos/settings.js";
import * as telemetryRepo from "./db/repos/telemetry.js";
import * as eventsRepo from "./db/repos/events.js";
import { registerRoutes } from "./api/rest.js";
import { setupSocket } from "./api/socket.js";
import { Broadcaster } from "./api/broadcaster.js";
import { estGpm, dollarsPerHour, calibratedWatts } from "./energy.js";

async function main(): Promise<void> {
  await migrate();
  await pingDb();

  let keepAliveMs = config.KEEP_ALIVE_MS;
  let pollMs = config.POLL_MS;

  const state = new ControlState();
  // Persist control intent (mode + manual setpoint) and restore it on boot, so a
  // redeploy/restart resumes the App Schedule (or last manual speed) instead of
  // handing control back to the pump's onboard schedule.
  state.setIntentSink((intent) => void settingsRepo.saveControlIntent(intent));
  const savedIntent = await settingsRepo.getControlIntent();
  if (savedIntent) {
    state.restoreIntent(savedIntent.mode, savedIntent.manualRpm);
    logger.info(savedIntent, "restored control intent");
  }
  const bridge = new BridgeConnection(config.BRIDGE_HOST, config.BRIDGE_PORT, config.PUMP_ADDRESS);
  const queue = new CommandQueue(bridge);
  const engine = new Engine(state, queue, config.PUMP_ADDRESS, keepAliveMs);
  const poller = new Poller(queue, config.PUMP_ADDRESS, pollMs);
  const scheduler = new Scheduler(state, schedulesRepo.listSchedules);
  const watchdog = new Watchdog(state, bridge, () => keepAliveMs, isDbConnected);

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: config.CORS_ORIGIN ?? true, credentials: true });
  await app.register(cookie);
  await registerRoutes(app, {
    state,
    watchdog,
    onSettingsChange: (s) => {
      keepAliveMs = s.keepAliveMs;
      pollMs = s.pollMs;
      engine.setKeepAliveMs(s.keepAliveMs);
      poller.setPollMs(s.pollMs);
    },
    refreshSchedules: () => scheduler.refresh(),
    pokePoll: () => poller.pollNow(),
  });

  const io = new IOServer(app.server, {
    cors: { origin: config.CORS_ORIGIN ?? true, credentials: true },
  });
  const broadcaster = new Broadcaster(io);
  setupSocket(io, state);

  // Bridge → state/telemetry/broadcast wiring
  bridge.onConnected(() => {
    state.setBusConnected(true);
    void eventsRepo.logEvent("bus_connect", {});
  });
  bridge.onDisconnected((reason) => {
    state.setBusConnected(false);
    void eventsRepo.logEvent("bus_drop", { reason }, "warn");
  });
  bridge.onStatus((status) => {
    state.applyStatus(status);
    const t: TelemetryDTO = {
      ts: Date.now(),
      rpm: status.rpm,
      watts: status.watts,
      running: status.running,
      driveState: status.driveState,
      statusWord: status.statusWord,
      statusText: status.statusText,
      estGpm: estGpm(status.rpm),
      dollarsPerHour: dollarsPerHour(status.watts),
      clockMinutes: status.clockMinutes,
    };
    broadcaster.telemetry(t);
    telemetryRepo.record({
      ts: t.ts,
      rpm: status.rpm,
      watts: status.watts,
      running: status.running,
      driveState: status.driveState,
      statusWord: status.statusWord,
      estGpm: t.estGpm,
      estWattsCal: calibratedWatts(status.rpm),
    });
  });

  state.onChange(() => broadcaster.controlState(state.toDTO()));
  engine.setEventSink((type, detail) => {
    void eventsRepo.logEvent(type, detail);
    broadcaster.event({ type, detail, ts: Date.now() });
  });

  const healthTimer = setInterval(() => broadcaster.health(watchdog.health()), 5000);

  telemetryRepo.startFlusher();
  bridge.start();
  poller.start();
  engine.start();
  scheduler.start();

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  logger.info({ port: config.PORT }, "pool-api listening");

  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, "shutting down — releasing pump to onboard schedule");
    clearInterval(healthTimer);
    poller.stop();
    scheduler.stop();
    engine.stop();
    await engine.release(); // graceful handoff to the pump's onboard schedule
    await telemetryRepo.flush();
    telemetryRepo.stopFlusher();
    bridge.close();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error({ err: (err as Error).message }, "fatal startup error");
  process.exit(1);
});
