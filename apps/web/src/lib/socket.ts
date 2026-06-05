"use client";
import { io, type Socket } from "socket.io-client";
import type { TelemetryDTO, ControlStateDTO, HealthDTO, ControlMode } from "@pool/types";
import { useStore } from "./store";
import { API_BASE } from "./api";
import { calibratedWatts, estGpm } from "./curves";

let liveSocket: Socket | null = null;
let demoTimer: ReturnType<typeof setInterval> | null = null;
let demoTarget = 1500;
let demoMode: ControlMode = "schedule";
let failures = 0;

export function connectSockets(): void {
  if (liveSocket) return;
  liveSocket = io(`${API_BASE}/live`, {
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnectionDelay: 1500,
    timeout: 4000,
  });
  liveSocket.on("connect", () => {
    failures = 0;
    stopDemo();
    useStore.getState().setConnected(true);
  });
  liveSocket.on("disconnect", () => useStore.getState().setConnected(false));
  liveSocket.on("connect_error", () => {
    failures += 1;
    if (failures >= 2) startDemo();
  });
  liveSocket.on("telemetry", (t: TelemetryDTO) => useStore.getState().pushTelemetry(t));
  liveSocket.on("controlState", (c: ControlStateDTO) => useStore.getState().setControl(c));
  liveSocket.on("health", (h: HealthDTO) => useStore.getState().setHealth(h));
}

/** Demo control hooks so the UI is visibly alive without a backend. */
export function setDemoTarget(rpm: number): void {
  demoTarget = rpm;
  demoMode = rpm > 0 ? "manual" : "off";
}
export function setDemoModeSchedule(): void {
  demoMode = "schedule";
  demoTarget = 1500;
}
export function isDemo(): boolean {
  return demoTimer !== null;
}

function startDemo(): void {
  if (demoTimer) return;
  useStore.getState().setConnected(false);
  demoTimer = setInterval(() => {
    const t = demoMode === "off" ? 0 : demoTarget;
    const wob = Math.sin(Date.now() / 2400) * 0.008 + (Math.random() - 0.5) * 0.01;
    const rpm = Math.max(0, Math.round(t * (1 + wob)));
    const watts = Math.round(calibratedWatts(t) * (1 + wob * 1.4));
    const now = new Date();
    const tel: TelemetryDTO = {
      ts: Date.now(),
      rpm,
      watts,
      running: t > 0,
      driveState: t > 0 ? 2 : 0,
      statusWord: 0,
      statusText: "Ok",
      estGpm: estGpm(t),
      dollarsPerHour: (watts / 1000) * 0.205,
      clockMinutes: now.getHours() * 60 + now.getMinutes(),
    };
    useStore.getState().pushTelemetry(tel);
    useStore.getState().setControl({
      controlMode: demoMode,
      targetRpm: t,
      overrideUntil: null,
      busConnected: false,
      lastError: null,
      lastUpdate: Date.now(),
    });
  }, 1000);
}

function stopDemo(): void {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
}
