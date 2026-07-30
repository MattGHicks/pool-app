import { z } from "zod";

/** How the app is currently driving the pump. */
export const ControlMode = z.enum(["schedule", "manual", "off"]);
export type ControlMode = z.infer<typeof ControlMode>;

/** Decoded pump status pushed to clients. */
export const PumpStatusDTO = z.object({
  command: z.number(),
  running: z.boolean(),
  mode: z.number(),
  driveState: z.number(),
  watts: z.number(),
  rpm: z.number(),
  flow: z.number(),
  ppc: z.number(),
  statusWord: z.number(),
  statusText: z.string(),
  clockHH: z.number(),
  clockMM: z.number(),
  clockMinutes: z.number(),
});
export type PumpStatusDTO = z.infer<typeof PumpStatusDTO>;

/** One live telemetry frame (status + derived energy fields). */
export const TelemetryDTO = z.object({
  ts: z.number(), // epoch ms
  rpm: z.number(),
  watts: z.number(),
  running: z.boolean(),
  driveState: z.number(),
  statusWord: z.number(),
  statusText: z.string(),
  estGpm: z.number(),
  dollarsPerHour: z.number(),
  clockMinutes: z.number(),
});
export type TelemetryDTO = z.infer<typeof TelemetryDTO>;

/** The app's control intent. */
export const ControlStateDTO = z.object({
  controlMode: ControlMode,
  targetRpm: z.number(),
  overrideUntil: z.number().nullable(),
  busConnected: z.boolean(),
  lastError: z.string().nullable(),
  lastUpdate: z.number(),
});
export type ControlStateDTO = z.infer<typeof ControlStateDTO>;

/** Health snapshot for /healthz and the failsafe banner. */
export const HealthDTO = z.object({
  busConnected: z.boolean(),
  lastPollAgeMs: z.number().nullable(),
  controlMode: ControlMode,
  uptimeS: z.number(),
  dbConnected: z.boolean(),
  keepAliveMs: z.number(),
});
export type HealthDTO = z.infer<typeof HealthDTO>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A single RPM-by-time-of-day segment within a schedule. */
export const ScheduleSegment = z.object({
  start: z.string().regex(TIME_RE, "must be HH:MM"),
  rpm: z.number().int().min(0).max(3450),
});
export type ScheduleSegment = z.infer<typeof ScheduleSegment>;

export const Schedule = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  segments: z.array(ScheduleSegment).min(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  priority: z.number().int().default(0),
});
export type Schedule = z.infer<typeof Schedule>;

export const ScheduleInput = Schedule.omit({ id: true });
export type ScheduleInput = z.infer<typeof ScheduleInput>;

/** Manual RPM override request. */
export const SetRpmRequest = z.object({
  rpm: z.number().int().min(0).max(3450),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});
export type SetRpmRequest = z.infer<typeof SetRpmRequest>;

export const SettingsDTO = z.object({
  pollMs: z.number().int().min(250).max(60000),
  keepAliveMs: z.number().int().min(1000).max(60000),
  revertTimeoutMs: z.number().int().nullable(),
  baselineRpm: z.number().int().min(0).max(3450),
  ratePerKwh: z.number().nonnegative(),
  poolGallons: z.number().int().positive(),
  wefGalPerKwh: z.number().int().positive(),
});
export type SettingsDTO = z.infer<typeof SettingsDTO>;

export const SettingsInput = SettingsDTO.partial();
export type SettingsInput = z.infer<typeof SettingsInput>;

export const EnergySummaryDTO = z.object({
  from: z.number(),
  to: z.number(),
  kwh: z.number(),
  cost: z.number(),
  runtimeHours: z.number(),
  turnovers: z.number(),
  efficiencyPct: z.number(),
  /** Mean draw while the pump is actually running (not a 24 h average). */
  avgWatts: z.number().default(0),
  /** True maximum instantaneous draw in the range. */
  peakWatts: z.number().default(0),
  /** Measured from integrated flow, not derived from kWh via a fixed WEF. */
  gallons: z.number().default(0),
  /** Actual water efficiency over the range (gal/kWh) — varies ~2.5x with speed. */
  galPerKwh: z.number().default(0),
  /**
   * Projected monthly cost, always from the trailing complete days — never from a
   * partial day, which would swing wildly as the day progresses.
   */
  projectedMonthlyCost: z.number().default(0),
  /** Average turnovers per complete day — same stable basis as the cost projection. */
  turnoversPerDay: z.number().default(0),
  /** How many complete days the projection is based on (0 = not enough history). */
  projectionDays: z.number().default(0),
});
export type EnergySummaryDTO = z.infer<typeof EnergySummaryDTO>;

/** One time-bucket of telemetry (hour or day) for charts. */
export const EnergyBucketDTO = z.object({
  ts: z.number(),
  avgWatts: z.number(),
  maxWatts: z.number(),
  avgRpm: z.number(),
  runFrac: z.number(),
});
export type EnergyBucketDTO = z.infer<typeof EnergyBucketDTO>;

export const EnergySeriesDTO = z.object({
  from: z.number(),
  to: z.number(),
  res: z.enum(["hour", "day"]),
  buckets: z.array(EnergyBucketDTO),
});
export type EnergySeriesDTO = z.infer<typeof EnergySeriesDTO>;

/**
 * Time spent in each speed band, in seconds. Measured by summing the interval
 * between consecutive samples — NOT by counting rows, which double-counts the
 * duplicate frames the bridge delivers and loses every gap in the stream.
 */
export const SpeedDistDTO = z.object({
  bands: z.array(z.object({ band: z.string(), seconds: z.number() })),
});
export type SpeedDistDTO = z.infer<typeof SpeedDistDTO>;

export const LoginRequest = z.object({
  password: z.string().min(1),
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;
