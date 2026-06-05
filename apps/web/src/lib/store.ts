"use client";
import { create } from "zustand";
import type { TelemetryDTO, ControlStateDTO, HealthDTO } from "@pool/types";

export interface HistoryPoint {
  ts: number;
  rpm: number;
  watts: number;
}

interface UIState {
  connected: boolean;
  authed: boolean | null; // null = checking
  telemetry: TelemetryDTO | null;
  history: HistoryPoint[];
  control: ControlStateDTO | null;
  health: HealthDTO | null;
  setConnected: (c: boolean) => void;
  setAuthed: (a: boolean) => void;
  pushTelemetry: (t: TelemetryDTO) => void;
  setControl: (c: ControlStateDTO) => void;
  setHealth: (h: HealthDTO) => void;
}

const MAX_HISTORY = 180; // ~15 min at ~5s, or 3 min at 1s

export const useStore = create<UIState>((set) => ({
  connected: false,
  authed: null,
  telemetry: null,
  history: [],
  control: null,
  health: null,
  setConnected: (connected) => set({ connected }),
  setAuthed: (authed) => set({ authed }),
  pushTelemetry: (t) =>
    set((s) => ({
      telemetry: t,
      history: [...s.history, { ts: t.ts, rpm: t.rpm, watts: t.watts }].slice(-MAX_HISTORY),
    })),
  setControl: (control) => set({ control }),
  setHealth: (health) => set({ health }),
}));
