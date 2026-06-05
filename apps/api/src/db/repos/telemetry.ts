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
