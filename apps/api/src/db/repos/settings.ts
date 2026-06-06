import { query, getPool } from "../pool.js";
import { config } from "../../config.js";
import { ControlMode } from "@pool/types";
import type { SettingsDTO, SettingsInput } from "@pool/types";

const DEFAULTS: SettingsDTO = {
  pollMs: config.POLL_MS,
  keepAliveMs: config.KEEP_ALIVE_MS,
  revertTimeoutMs: null,
  baselineRpm: 1500,
  ratePerKwh: 0.205,
  poolGallons: 8500,
  wefGalPerKwh: 9000,
};

interface SettingsRow {
  poll_ms: number;
  keep_alive_ms: number;
  revert_timeout_ms: number | null;
  baseline_rpm: number;
  rate_per_kwh: string;
  pool_gallons: number;
  wef_gal_per_kwh: number;
}

const COLUMN: Record<keyof SettingsInput, string> = {
  pollMs: "poll_ms",
  keepAliveMs: "keep_alive_ms",
  revertTimeoutMs: "revert_timeout_ms",
  baselineRpm: "baseline_rpm",
  ratePerKwh: "rate_per_kwh",
  poolGallons: "pool_gallons",
  wefGalPerKwh: "wef_gal_per_kwh",
};

export async function getSettings(): Promise<SettingsDTO> {
  if (!getPool()) return { ...DEFAULTS };
  try {
    const rows = await query<SettingsRow>("select * from settings where id = 1");
    const r = rows[0];
    if (!r) return { ...DEFAULTS };
    return {
      pollMs: r.poll_ms,
      keepAliveMs: r.keep_alive_ms,
      revertTimeoutMs: r.revert_timeout_ms,
      baselineRpm: r.baseline_rpm,
      ratePerKwh: Number(r.rate_per_kwh),
      poolGallons: r.pool_gallons,
      wefGalPerKwh: r.wef_gal_per_kwh,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateSettings(input: SettingsInput): Promise<SettingsDTO> {
  if (!getPool()) return { ...DEFAULTS, ...input } as SettingsDTO;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(input) as Array<keyof SettingsInput>) {
    const value = input[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${COLUMN[key]} = $${params.length}`);
  }
  if (sets.length > 0) {
    sets.push("updated_at = now()");
    await query(`update settings set ${sets.join(", ")} where id = 1`, params);
  }
  return getSettings();
}

export interface ControlIntent {
  mode: ControlMode;
  manualRpm: number;
}

/** Load the persisted control intent (mode + manual setpoint). Null if no DB/row. */
export async function getControlIntent(): Promise<ControlIntent | null> {
  if (!getPool()) return null;
  try {
    const rows = await query<{ control_mode: string; manual_rpm: number }>(
      "select control_mode, manual_rpm from settings where id = 1",
    );
    const r = rows[0];
    if (!r) return null;
    const parsed = ControlMode.safeParse(r.control_mode);
    return { mode: parsed.success ? parsed.data : "schedule", manualRpm: r.manual_rpm ?? 0 };
  } catch {
    return null;
  }
}

/** Persist the control intent so a restart/redeploy resumes it. Non-fatal on failure. */
export async function saveControlIntent(intent: ControlIntent): Promise<void> {
  if (!getPool()) return;
  try {
    await query("update settings set control_mode = $1, manual_rpm = $2, updated_at = now() where id = 1", [
      intent.mode,
      intent.manualRpm,
    ]);
  } catch {
    /* non-fatal: losing the persisted intent just means a restart falls back to App Schedule */
  }
}
