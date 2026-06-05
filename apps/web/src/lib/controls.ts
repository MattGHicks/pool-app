"use client";
import { api } from "./api";
import { setDemoTarget, setDemoModeSchedule } from "./socket";

/** Command a manual RPM (also drives the demo fallback so the UI reacts offline). */
export async function commandSetRpm(rpm: number, durationMinutes?: number): Promise<void> {
  setDemoTarget(rpm);
  try {
    await api.setRpm(rpm, durationMinutes);
  } catch {
    /* offline / demo */
  }
}

export async function commandResume(): Promise<void> {
  setDemoModeSchedule();
  try {
    await api.resumeSchedule();
  } catch {
    /* offline / demo */
  }
}

export async function commandOff(): Promise<void> {
  setDemoTarget(0);
  try {
    await api.off();
  } catch {
    /* offline / demo */
  }
}
