import { query, getPool } from "../pool.js";
import { logger } from "../../logger.js";

export interface TelemetrySample {
  ts: number; // epoch ms
  rpm: number;
  watts: number;
  running: boolean;
  driveState: number;
  statusWord: number;
  estGpm: number;
  estWattsCal: number;
}

const buffer: TelemetrySample[] = [];
const MAX_BUFFER = 2000;
const FLUSH_MS = 5000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Queue a sample for the next batched flush (drops oldest if backed up). */
export function record(s: TelemetrySample): void {
  buffer.push(s);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

export async function flush(): Promise<void> {
  if (!getPool() || buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const tuples: string[] = [];
    const params: unknown[] = [];
    for (const s of batch) {
      const o = params.length;
      tuples.push(
        `(to_timestamp($${o + 1} / 1000.0), $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`,
      );
      params.push(s.ts, s.rpm, s.watts, s.running, s.driveState, s.statusWord, s.estGpm, s.estWattsCal);
    }
    await query(
      `insert into telemetry_raw (ts, rpm, watts, running, drive_state, status_word, est_gpm, est_watts_cal) values ${tuples.join(", ")}`,
      params,
    );
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "telemetry flush failed");
  }
}

export function startFlusher(): void {
  if (!flushTimer) flushTimer = setInterval(() => void flush(), FLUSH_MS);
}

export function stopFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Wipe all recorded telemetry, resetting the energy stats to empty. Also drops
 * any samples still buffered in memory so they don't repopulate on the next flush.
 * Returns the number of rows removed.
 */
export async function purgeAll(): Promise<number> {
  buffer.splice(0, buffer.length);
  if (!getPool()) return 0;
  try {
    const rows = await query<{ count: string }>(
      "with deleted as (delete from telemetry_raw returning 1) select count(*)::text as count from deleted",
    );
    return Number(rows[0]?.count ?? 0);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "telemetry purge failed");
    return 0;
  }
}

export interface HourBucket {
  bucket: number;
  avgWatts: number;
  runFrac: number;
}

export async function hourlyBuckets(fromMs: number, toMs: number): Promise<HourBucket[]> {
  if (!getPool()) return [];
  try {
    const rows = await query<{ bucket: string; avg_watts: number | null; run_frac: number | null }>(
      `select date_trunc('hour', ts) as bucket,
              avg(watts)::float as avg_watts,
              avg(case when running then 1 else 0 end)::float as run_frac
       from telemetry_raw
       where ts >= to_timestamp($1 / 1000.0) and ts < to_timestamp($2 / 1000.0)
       group by 1 order by 1`,
      [fromMs, toMs],
    );
    return rows.map((r) => ({
      bucket: new Date(r.bucket).getTime(),
      avgWatts: r.avg_watts ?? 0,
      runFrac: r.run_frac ?? 0,
    }));
  } catch {
    return [];
  }
}

export interface SeriesBucket {
  ts: number;
  avgWatts: number;
  maxWatts: number;
  avgRpm: number;
  runFrac: number;
}

/** Bucketed telemetry series for charting, truncated to local (tz) hour/day boundaries. */
export async function series(
  fromMs: number,
  toMs: number,
  res: "hour" | "day",
  tz: string,
): Promise<SeriesBucket[]> {
  if (!getPool()) return [];
  try {
    const rows = await query<{
      bucket: string;
      avg_watts: number | null;
      max_watts: number | null;
      avg_rpm: number | null;
      run_frac: number | null;
    }>(
      `select (date_trunc($3, ts at time zone $4) at time zone $4) as bucket,
              avg(watts)::float as avg_watts,
              max(watts)::float as max_watts,
              avg(rpm)::float as avg_rpm,
              avg(case when running then 1 else 0 end)::float as run_frac
       from telemetry_raw
       where ts >= to_timestamp($1 / 1000.0) and ts < to_timestamp($2 / 1000.0)
       group by 1 order by 1`,
      [fromMs, toMs, res, tz],
    );
    return rows.map((r) => ({
      ts: new Date(r.bucket).getTime(),
      avgWatts: r.avg_watts ?? 0,
      maxWatts: r.max_watts ?? 0,
      avgRpm: r.avg_rpm ?? 0,
      runFrac: r.run_frac ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Sample counts per speed band (≈ seconds at ~1 Hz polling). */
export async function speedBands(
  fromMs: number,
  toMs: number,
): Promise<Array<{ band: string; samples: number }>> {
  if (!getPool()) return [];
  try {
    const rows = await query<{ band: string; samples: string }>(
      `select case
                when rpm <= 0 then 'off'
                when rpm < 1800 then 'low'
                when rpm < 2700 then 'mid'
                else 'high'
              end as band,
              count(*) as samples
       from telemetry_raw
       where ts >= to_timestamp($1 / 1000.0) and ts < to_timestamp($2 / 1000.0)
       group by 1`,
      [fromMs, toMs],
    );
    return rows.map((r) => ({ band: r.band, samples: Number(r.samples) }));
  } catch {
    return [];
  }
}
