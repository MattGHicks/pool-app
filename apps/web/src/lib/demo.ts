"use client";
import type { Schedule, ScheduleInput, SettingsDTO } from "@pool/types";

/**
 * Demo mode (NEXT_PUBLIC_DEMO=1): the app runs fully client-side against a
 * simulated pump — no API, no bridge, no hardware. The socket layer fakes
 * live telemetry (see socket.ts); this module fakes the REST API with
 * in-memory state so schedules and settings are interactive too.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const LATENCY_MS = 120;

let schedules: Schedule[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Summer",
    enabled: true,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "08:00", rpm: 1500 },
      { start: "12:00", rpm: 2400 },
      { start: "14:00", rpm: 1500 },
      { start: "18:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Maintenance",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "08:00", rpm: 1500 },
      { start: "18:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Vacation",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "09:00", rpm: 1500 },
      { start: "17:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
];

let settings: SettingsDTO = {
  pollMs: 1000,
  keepAliveMs: 5000,
  revertTimeoutMs: null,
  baselineRpm: 1500,
  ratePerKwh: 0.205,
  poolGallons: 8500,
  wefGalPerKwh: 9000,
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function parseBody<T>(init?: RequestInit): T {
  return JSON.parse((init?.body as string) ?? "{}") as T;
}

/** Resolve a canned response for a REST path, or throw like a failed fetch. */
export async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const method = (init?.method ?? "GET").toUpperCase();
  const url = path.split("?")[0] ?? path;

  if (url === "/api/auth/me") return { authed: true } as T;
  if (url === "/api/auth/login" || url === "/api/auth/logout") return { ok: true } as T;
  if (url.startsWith("/api/control/")) return { ok: true } as T;

  if (url === "/api/schedules" && method === "GET") return clone(schedules) as T;
  if (url === "/api/schedules" && method === "POST") {
    const input = parseBody<ScheduleInput>(init);
    const created: Schedule = { id: crypto.randomUUID(), ...input };
    if (created.enabled) schedules = schedules.map((s) => ({ ...s, enabled: false }));
    schedules = [...schedules, created];
    return clone(created) as T;
  }

  const seg = url.match(/^\/api\/schedules\/([^/]+)(\/activate)?$/);
  if (seg) {
    const id = seg[1]!;
    if (seg[2] && method === "POST") {
      schedules = schedules.map((s) => ({ ...s, enabled: s.id === id }));
      return clone(schedules.find((s) => s.id === id)) as T;
    }
    if (method === "PUT") {
      const input = parseBody<ScheduleInput>(init);
      if (input.enabled) schedules = schedules.map((s) => ({ ...s, enabled: s.id === id }));
      schedules = schedules.map((s) => (s.id === id ? { ...s, ...input, id } : s));
      return clone(schedules.find((s) => s.id === id)) as T;
    }
    if (method === "DELETE") {
      schedules = schedules.filter((s) => s.id !== id);
      return { ok: true } as T;
    }
  }

  if (url === "/api/settings" && method === "GET") return clone(settings) as T;
  if (url === "/api/settings" && method === "PUT") {
    settings = { ...settings, ...parseBody<Partial<SettingsDTO>>(init) };
    return clone(settings) as T;
  }

  // Anything else (e.g. energy queries) behaves like an offline API so pages
  // can use their own richer fallbacks.
  throw new Error(`demo: no stub for ${method} ${path}`);
}
