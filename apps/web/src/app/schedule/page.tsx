"use client";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { ScheduleTimeline } from "@/components/ScheduleTimeline";
import { TimelineEditor } from "@/components/TimelineEditor";
import { api } from "@/lib/api";
import { runtimeHours } from "@/lib/schedule";
import { haptics } from "@/lib/haptics";
import type { Schedule, ScheduleSegment, ScheduleInput } from "@pool/types";

const STARTERS: ScheduleInput[] = [
  {
    name: "Daily",
    enabled: true,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "08:00", rpm: 1500 },
      { start: "18:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
  {
    name: "Deep clean",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "08:00", rpm: 1500 },
      { start: "11:00", rpm: 2400 },
      { start: "14:00", rpm: 1500 },
      { start: "19:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
  {
    name: "Vacation",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "10:00", rpm: 1500 },
      { start: "16:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
];

const DEFAULT_SEGS: ScheduleSegment[] = STARTERS[0]!.segments;

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Daily");
  const [segs, setSegs] = useState<ScheduleSegment[]>(DEFAULT_SEGS);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const seeded = useRef(false);

  const selected = schedules.find((s) => s.id === selectedId) ?? null;
  const isActive = selected?.enabled ?? false;
  const hours = runtimeHours(segs);

  useEffect(() => {
    const tick = (): void => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const load = async (preferId?: string): Promise<void> => {
    let list: Schedule[];
    try {
      list = await api.schedules();
    } catch {
      return;
    }
    if (list.length === 0 && !seeded.current) {
      seeded.current = true;
      try {
        for (const s of STARTERS) await api.createSchedule(s);
        list = await api.schedules();
      } catch {
        /* offline */
      }
    }
    setSchedules(list);
    const pick =
      (preferId ? list.find((s) => s.id === preferId) : undefined) ??
      list.find((s) => s.enabled) ??
      list[0] ??
      null;
    if (pick) {
      setSelectedId(pick.id);
      setName(pick.name);
      setSegs(pick.segments);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const pick = (s: Schedule): void => {
    haptics.toggle();
    setSelectedId(s.id);
    setName(s.name);
    setSegs(s.segments);
  };
  const startNew = (): void => {
    haptics.toggle();
    setSelectedId(null);
    setName("New schedule");
    setSegs(DEFAULT_SEGS);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    haptics.apply();
    const input: ScheduleInput = {
      name: name.trim() || "Schedule",
      enabled: selected?.enabled ?? schedules.length === 0,
      segments: segs,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      priority: selected?.priority ?? 0,
    };
    try {
      if (selectedId) await api.updateSchedule(selectedId, input);
      else await api.createSchedule(input);
      await load(selectedId ?? undefined);
    } catch {
      /* offline */
    }
    setBusy(false);
  };
  const activate = async (): Promise<void> => {
    if (!selectedId) return;
    haptics.toggle();
    setBusy(true);
    try {
      await api.activateSchedule(selectedId);
      await load(selectedId);
    } catch {
      /* offline */
    }
    setBusy(false);
  };
  const remove = async (): Promise<void> => {
    if (!selectedId) {
      startNew();
      return;
    }
    setBusy(true);
    haptics.toggle();
    try {
      await api.deleteSchedule(selectedId);
    } catch {
      /* offline */
    }
    await load();
    setBusy(false);
  };

  return (
    <div className="space-y-5 pt-1">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-xl tracking-tight text-text">Schedules</h1>
          <p className="font-mono text-[0.6rem] text-text-faint">
            drag the handles · tap a block to set speed
          </p>
        </div>
        <button
          onClick={startNew}
          className="rounded-lg border border-aqua/50 bg-aqua/10 px-3 py-1.5 text-[0.72rem] font-medium text-aqua active:bg-aqua/20"
        >
          + New
        </button>
      </div>

      {/* Saved schedules */}
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {schedules.map((s) => {
          const sel = s.id === selectedId;
          return (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className={`w-[200px] shrink-0 rounded-2xl border p-3 text-left transition ${
                sel
                  ? "border-aqua/70 bg-aqua/[0.07] shadow-[0_0_22px_-6px_var(--color-aqua)]"
                  : "border-border bg-surface/40"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="truncate font-display text-sm">{s.name}</span>
                {s.enabled ? (
                  <span className="rounded-full bg-aqua/15 px-1.5 py-0.5 font-mono text-[0.5rem] tracking-wide text-aqua">
                    ACTIVE
                  </span>
                ) : (
                  <span className="font-mono text-[0.56rem] text-text-faint">
                    {runtimeHours(s.segments).toFixed(1)}h
                  </span>
                )}
              </div>
              <ScheduleTimeline segments={s.segments} height={30} />
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <Card className="space-y-4 border-border-bright/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schedule name"
            className="min-w-0 flex-1 border-b border-transparent bg-transparent pb-1 font-display text-lg text-text outline-none focus:border-aqua/50"
          />
          <span className="shrink-0 font-mono text-[0.62rem] text-text-faint">{hours.toFixed(1)} h/day</span>
        </div>

        <TimelineEditor segments={segs} onChange={setSegs} nowMinutes={now} />
      </Card>

      {/* Actions */}
      <div className="space-y-2.5 pb-2">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-xl border border-aqua/60 bg-aqua/10 py-3 text-sm font-medium text-aqua transition active:bg-aqua/20 disabled:opacity-50"
          >
            {selectedId ? "Save changes" : "Create schedule"}
          </button>
          <button
            onClick={() => void activate()}
            disabled={busy || !selectedId || isActive}
            className="rounded-xl border border-border bg-surface/50 py-3 text-sm text-text transition active:bg-surface-2/60 disabled:opacity-40"
          >
            {isActive ? "✓ Active" : "Set active"}
          </button>
        </div>
        {selectedId ? (
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="w-full py-2 text-center text-[0.74rem] text-coral/80 active:text-coral"
          >
            Delete this schedule
          </button>
        ) : null}
      </div>

      <p className="pb-2 text-[0.72rem] leading-relaxed text-text-faint">
        The <span className="text-aqua">active</span> schedule runs whenever you tap{" "}
        <span className="text-aqua">Schedule</span> on the home screen. If the app ever goes offline, the
        pump reverts to its onboard program on its own.
      </p>
    </div>
  );
}
