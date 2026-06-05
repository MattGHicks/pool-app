import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

let pool: pg.Pool | null = null;
let connected = false;

export function getPool(): pg.Pool | null {
  if (pool) return pool;
  // Prefer discrete params (passwords with '/' etc. work without URL-encoding).
  if (config.DB_HOST) {
    pool = new pg.Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      max: 8,
    });
  } else if (config.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 8 });
  } else {
    return null;
  }
  pool.on("error", (err: Error) => {
    connected = false;
    logger.warn({ err: err.message }, "pg pool error");
  });
  return pool;
}

export function isDbConnected(): boolean {
  return connected;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error("no database configured");
  const res = await p.query<T>(text, params as unknown[] | undefined);
  connected = true;
  return res.rows;
}

export async function pingDb(): Promise<boolean> {
  if (!getPool()) return false;
  try {
    await query("select 1");
    connected = true;
    return true;
  } catch {
    connected = false;
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
