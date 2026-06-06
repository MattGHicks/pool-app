import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LoginRequest, SetRpmRequest, ScheduleInput, SettingsInput } from "@pool/types";
import { config } from "../config.js";
import {
  COOKIE_NAME,
  REMEMBER_TTL_MS,
  SESSION_TTL_MS,
  checkPassword,
  createSessionToken,
  verifySessionToken,
  rateLimitOk,
  resetRateLimit,
} from "./auth.js";
import type { ControlState } from "../core/controlState.js";
import type { Watchdog } from "../core/watchdog.js";
import * as schedules from "../db/repos/schedules.js";
import * as settingsRepo from "../db/repos/settings.js";
import * as events from "../db/repos/events.js";
import * as telemetry from "../db/repos/telemetry.js";
import { efficiencyPct } from "../energy.js";
import type { SettingsDTO } from "@pool/types";

export interface RouteDeps {
  state: ControlState;
  watchdog: Watchdog;
  onSettingsChange: (s: SettingsDTO) => void;
  refreshSchedules: () => Promise<void>;
  /** Fire an immediate status poll so the client confirms a control change fast. */
  pokePoll?: () => void;
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!verifySessionToken(req.cookies[COOKIE_NAME])) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
  const guarded = { preHandler: requireAuth };

  app.get("/healthz", async () => deps.watchdog.health());

  // --- auth ---
  app.post("/api/auth/login", async (req, reply) => {
    if (!rateLimitOk(req.ip)) return reply.code(429).send({ error: "too many attempts" });
    const body = LoginRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    if (!checkPassword(body.data.password)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    resetRateLimit(req.ip);
    const ttl = body.data.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    reply.setCookie(COOKIE_NAME, createSessionToken(ttl), {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      domain: config.COOKIE_DOMAIN,
      maxAge: Math.floor(ttl / 1000),
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/", domain: config.COOKIE_DOMAIN });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({
    authed: verifySessionToken(req.cookies[COOKIE_NAME]),
  }));

  // --- status ---
  app.get("/api/status", guarded, async () => ({
    status: deps.state.lastStatus,
    control: deps.state.toDTO(),
    health: deps.watchdog.health(),
  }));

  // --- control ---
  app.post("/api/control/rpm", guarded, async (req, reply) => {
    const body = SetRpmRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    deps.state.setManual(body.data.rpm, body.data.durationMinutes);
    void events.logEvent("override", { rpm: body.data.rpm }, "info", "rest");
    return { ok: true, control: deps.state.toDTO() };
  });

  app.post("/api/control/resume-schedule", guarded, async () => {
    deps.state.resumeSchedule();
    return { ok: true, control: deps.state.toDTO() };
  });

  app.post("/api/control/off", guarded, async () => {
    deps.state.setOff();
    return { ok: true, control: deps.state.toDTO() };
  });

  // --- schedules ---
  app.get("/api/schedules", guarded, async () => schedules.listSchedules());

  app.post("/api/schedules", guarded, async (req, reply) => {
    const body = ScheduleInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid" });
    const created = await schedules.createSchedule(body.data);
    await deps.refreshSchedules();
    return created;
  });

  app.put("/api/schedules/:id", guarded, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ScheduleInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid" });
    const updated = await schedules.updateSchedule(id, body.data);
    if (!updated) return reply.code(404).send({ error: "not found" });
    await deps.refreshSchedules();
    return updated;
  });

  app.delete("/api/schedules/:id", guarded, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await schedules.deleteSchedule(id);
    await deps.refreshSchedules();
    if (!ok) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // --- settings ---
  app.get("/api/settings", guarded, async () => settingsRepo.getSettings());

  app.put("/api/settings", guarded, async (req, reply) => {
    const body = SettingsInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    const updated = await settingsRepo.updateSettings(body.data);
    deps.onSettingsChange(updated);
    return updated;
  });

  // --- events ---
  app.get("/api/events", guarded, async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Math.max(Number(limit ?? 200), 1), 1000);
    return events.listEvents(n);
  });

  // --- energy summary ---
  app.get("/api/energy/summary", guarded, async (req) => {
    const q = req.query as { from?: string; to?: string };
    const to = q.to ? Number(q.to) : Date.now();
    const from = q.from ? Number(q.from) : to - 24 * 60 * 60 * 1000;
    const settings = await settingsRepo.getSettings();
    const buckets = await telemetry.hourlyBuckets(from, to);
    let kwh = 0;
    let runtimeHours = 0;
    for (const b of buckets) {
      kwh += b.avgWatts / 1000; // each bucket ≈ 1 hour
      runtimeHours += b.runFrac;
    }
    const cost = kwh * settings.ratePerKwh;
    const gallons = kwh * settings.wefGalPerKwh;
    const turnovers = settings.poolGallons > 0 ? gallons / settings.poolGallons : 0;
    return {
      from,
      to,
      kwh,
      cost,
      runtimeHours,
      turnovers,
      efficiencyPct: efficiencyPct(turnovers),
    };
  });
}
