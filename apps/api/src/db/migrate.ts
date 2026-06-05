import { query, getPool } from "./pool.js";
import { logger } from "../logger.js";

const TABLES = `
create table if not exists telemetry_raw (
  ts            timestamptz not null default now(),
  rpm           int,
  watts         int,
  running       boolean,
  drive_state   smallint,
  status_word   int,
  est_gpm       real,
  est_watts_cal real
);
create index if not exists telemetry_raw_ts_idx on telemetry_raw (ts desc);

create table if not exists schedules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  enabled     boolean not null default true,
  segments    jsonb not null,
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  priority    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists event_log (
  id        bigserial primary key,
  ts        timestamptz not null default now(),
  type      text not null,
  severity  text not null default 'info',
  detail    jsonb,
  source    text
);
create index if not exists event_log_ts_idx on event_log (ts desc);

create table if not exists settings (
  id                    int primary key default 1,
  poll_ms               int not null default 1000,
  keep_alive_ms         int not null default 5000,
  revert_timeout_ms     int,
  baseline_rpm          int not null default 1500,
  rate_per_kwh          numeric not null default 0.205,
  pool_gallons          int not null default 8500,
  wef_gal_per_kwh       int not null default 9000,
  external_control_only boolean not null default false,
  updated_at            timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists emporia_samples (
  ts          timestamptz not null,
  granularity text not null,
  pump_kwh    numeric,
  pump_kwatts numeric,
  primary key (ts, granularity)
);
`;

/**
 * Idempotent schema setup. Works on plain Postgres; if the TimescaleDB extension
 * is present, telemetry_raw is promoted to a hypertable for efficient retention.
 * All failures are non-fatal — the control loop runs without persistence.
 */
export async function migrate(): Promise<void> {
  if (!getPool()) {
    logger.warn("no DATABASE_URL set — running without persistence");
    return;
  }
  try {
    let timescale = false;
    try {
      await query("create extension if not exists timescaledb");
      timescale = true;
    } catch {
      logger.warn("timescaledb extension unavailable — using plain tables");
    }
    await query(TABLES);
    if (timescale) {
      try {
        await query(
          "select create_hypertable('telemetry_raw','ts', if_not_exists => true, migrate_data => true)",
        );
      } catch (err) {
        logger.debug({ err: (err as Error).message }, "hypertable promotion skipped");
      }
    }
    logger.info("db schema ready");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "schema init failed — continuing without persistence");
  }
}
