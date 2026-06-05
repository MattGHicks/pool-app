import { query, getPool } from "../pool.js";
import { Schedule, type ScheduleInput } from "@pool/types";

interface ScheduleRow {
  id: string;
  name: string;
  enabled: boolean;
  segments: unknown;
  days_of_week: number[];
  priority: number;
}

function toSchedule(r: ScheduleRow): Schedule {
  return Schedule.parse({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    segments: r.segments,
    daysOfWeek: r.days_of_week,
    priority: r.priority,
  });
}

export async function listSchedules(): Promise<Schedule[]> {
  if (!getPool()) return [];
  try {
    const rows = await query<ScheduleRow>(
      "select id, name, enabled, segments, days_of_week, priority from schedules order by priority desc, created_at asc",
    );
    return rows.map(toSchedule);
  } catch {
    return [];
  }
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const rows = await query<ScheduleRow>(
    `insert into schedules (name, enabled, segments, days_of_week, priority)
     values ($1, $2, $3, $4, $5)
     returning id, name, enabled, segments, days_of_week, priority`,
    [input.name, input.enabled, JSON.stringify(input.segments), input.daysOfWeek, input.priority],
  );
  return toSchedule(rows[0]!);
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<Schedule | null> {
  const rows = await query<ScheduleRow>(
    `update schedules
     set name = $2, enabled = $3, segments = $4, days_of_week = $5, priority = $6, updated_at = now()
     where id = $1
     returning id, name, enabled, segments, days_of_week, priority`,
    [id, input.name, input.enabled, JSON.stringify(input.segments), input.daysOfWeek, input.priority],
  );
  return rows[0] ? toSchedule(rows[0]) : null;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("delete from schedules where id = $1 returning id", [id]);
  return rows.length > 0;
}
