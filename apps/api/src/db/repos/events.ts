import { query, getPool } from "../pool.js";
import { logger } from "../../logger.js";

export interface EventRow {
  id: string;
  ts: string;
  type: string;
  severity: string;
  detail: unknown;
  source: string;
}

export async function logEvent(
  type: string,
  detail: Record<string, unknown> = {},
  severity = "info",
  source = "api",
): Promise<void> {
  if (!getPool()) return;
  try {
    await query("insert into event_log (type, severity, detail, source) values ($1, $2, $3, $4)", [
      type,
      severity,
      JSON.stringify(detail),
      source,
    ]);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "event log failed");
  }
}

export async function listEvents(limit = 200): Promise<EventRow[]> {
  if (!getPool()) return [];
  try {
    return await query<EventRow>(
      "select id, ts, type, severity, detail, source from event_log order by ts desc limit $1",
      [limit],
    );
  } catch {
    return [];
  }
}
