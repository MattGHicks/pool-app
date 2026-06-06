"use client";
import { api } from "./api";
import { useStore } from "./store";
import { setDemoTarget, setDemoModeSchedule } from "./socket";
import type { ControlMode } from "@pool/types";

/**
 * Optimistically reflect a control intent in the store so the UI reacts the
 * instant you tap — the button selects, the target updates — without waiting
 * for the HTTP round-trip. The server's authoritative controlState broadcast
 * confirms (or corrects) it a moment later.
 */
function optimistic(mode: ControlMode, targetRpm: number): void {
  const cur = useStore.getState().control;
  useStore.getState().setControl({
    controlMode: mode,
    targetRpm,
    overrideUntil: null,
    busConnected: cur?.busConnected ?? true,
    lastError: null,
    lastUpdate: Date.now(),
  });
}

/** Command a manual RPM (0 = stop). */
export async function commandSetRpm(rpm: number, durationMinutes?: number): Promise<void> {
  optimistic("manual", rpm);
  setDemoTarget(rpm);
  try {
    await api.setRpm(rpm, durationMinutes);
  } catch {
    /* offline / demo */
  }
}

/** Switch to the app's schedule. */
export async function commandResume(): Promise<void> {
  optimistic("schedule", useStore.getState().control?.targetRpm ?? 0);
  setDemoModeSchedule();
  try {
    await api.resumeSchedule();
  } catch {
    /* offline / demo */
  }
}
