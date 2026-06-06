import type {
  Schedule,
  ScheduleInput,
  SettingsDTO,
  SettingsInput,
  EnergySummaryDTO,
  EnergySeriesDTO,
  SpeedDistDTO,
} from "@pool/types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content-type when there's actually a body — Fastify rejects
  // an empty body with content-type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which silently broke every no-body POST (activate, resume-schedule, off, logout).
  const hasBody = init?.body != null;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ authed: boolean }>("/api/auth/me"),
  login: (password: string, remember: boolean) =>
    req<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password, remember }),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  setRpm: (rpm: number, durationMinutes?: number) =>
    req("/api/control/rpm", { method: "POST", body: JSON.stringify({ rpm, durationMinutes }) }),
  resumeSchedule: () => req("/api/control/resume-schedule", { method: "POST" }),
  off: () => req("/api/control/off", { method: "POST" }),
  schedules: () => req<Schedule[]>("/api/schedules"),
  createSchedule: (s: ScheduleInput) =>
    req<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(s) }),
  updateSchedule: (id: string, s: ScheduleInput) =>
    req<Schedule>(`/api/schedules/${id}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteSchedule: (id: string) => req(`/api/schedules/${id}`, { method: "DELETE" }),
  activateSchedule: (id: string) =>
    req<Schedule>(`/api/schedules/${id}/activate`, { method: "POST" }),
  settings: () => req<SettingsDTO>("/api/settings"),
  updateSettings: (s: SettingsInput) =>
    req<SettingsDTO>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  energySummary: (from: number, to: number) =>
    req<EnergySummaryDTO>(`/api/energy/summary?from=${from}&to=${to}`),
  energySeries: (from: number, to: number, res: "hour" | "day") =>
    req<EnergySeriesDTO>(`/api/energy/series?from=${from}&to=${to}&res=${res}`),
  energySpeed: (from: number, to: number) =>
    req<SpeedDistDTO>(`/api/energy/speed?from=${from}&to=${to}`),
  resetEnergy: () => req<{ ok: boolean; removed: number }>("/api/energy/reset", { method: "POST" }),
};
