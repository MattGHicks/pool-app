"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { ScheduleTimeline } from "@/components/ScheduleTimeline";
import { api } from "@/lib/api";
import { sortSegments, runtimeHours, fromMin, toMin, label12, rpmColor } from "@/lib/schedule";
import { haptics } from "@/lib/haptics";
import type { Schedule, ScheduleSegment } from "@pool/types";

const DEFAULT_SEGS: ScheduleSegment[] = [
  { start: "08:00", rpm: 1500 },
  { start: "12:00", rpm: 2400 },
  { start: "16:00", rpm: 1500 },
  { start: "20:00", rpm: 0 },
];

const RPM_CHIPS = [
  { rpm: 0, label: "Off" },
  { rpm: 1500, label: "Eco" },
  { rpm: 2400, label: "Clean" },
  { rpm: 3000, label: "Boost" },
];

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("My schedule");
  const [segs, setSegs] = useState<ScheduleSegment[]>(DEFAULT_SEGS);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const selected = schedules.find((s) => s.id === selectedId) ?? null;
  const sorted = useMemo(() => sortSegments(segs), [segs]);
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
    try {
      const list = await api.schedules();
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
      } else {
        setSelectedId(null);
        setName("My schedule");
        setSegs(DEFAULT_SEGS);
      }
    } catch {
      /* offline / demo */
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
  const setRpm = (i: number, rpm: number): void =>
    setSegs((p) => p.map((s, j) => (j === i ? { ...s, rpm: Math.max(0, Math.min(3450, rpm)) } : s)));
  const setTime = (i: number, start: string): void =>
    setSegs((p) => p.map((s, j) => (j === i ? { ...s, start } : s)));
  const addSeg = (): void => {
    haptics.toggle();
    const last = sortSegments(segs).at(-1);
    const next = last ? Math.min(1410, toMin(last.start) + 120) : 480;
    setSegs((p) => [...p, { start: fromMin(next), rpm: 1500 }]);
  };
  const removeSeg = (i: number): void => setSegs((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));

  const save = async (): Promise<void> => {
    setBusy(true);
    haptics.apply();
    const input = {
      name: name.trim() || "Schedule",
      enabled: selected?.enabled ?? schedules.length === 0,
      segments: sortSegments(segs),
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
  const activate = async (id: string): Promise<void> => {
    haptics.toggle();
    setBusy(true);
    try {
      await api.activateSchedule(id);
      await load(id);
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

  const isActive = selected?.enabled ?? false;

  return (
    <div className="space-y-5 pt-2">
      {/* Saved schedules */}
      <div className="flex items-center justify-between">
        <SectionTitle>Schedules</SectionTitle>
        <button
          onClick={startNew}
          className="rounded-lg border border-border bg-surface/50 px-2.5 py-1 text-[0.7rem] text-aqua active:bg-surface-2/60"
        >
          + New
        </button>
      </div>
      <div className="grid gap-2.5">
        {schedules.map((s) => {
          const sel = s.id === selectedId;
          return (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className={`rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
                sel ? "border-aqua/60 bg-aqua/5" : "border-border bg-surface/40"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 font-display text-sm">
                  {s.enabled ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-aqua shadow-[0_0_7px_var(--color-aqua)]" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-border-bright" />
                  )}
                  {s.name}
                </span>
                <span className="font-mono text-[0.58rem] text-text-faint">
                  {s.enabled ? "ACTIVE" : `${runtimeHours(s.segments).toFixed(1)}h`}
                </span>
              </div>
              <ScheduleTimeline segments={s.segments} height={26} />
            </button>
          );
        })}
        {schedules.length === 0 ? (
          <Card className="p-4 text-[0.76rem] text-text-faint">
            No saved schedules yet. Edit the plan below and tap Save to create your first.
          </Card>
        ) : null}
      </div>

      {/* Editor */}
      <SectionTitle>{selectedId ? "Edit schedule" : "New schedule"}</SectionTitle>
      <Card className="space-y-3 p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Schedule name"
          className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 font-display text-sm text-text outline-none focus:border-aqua/60"
        />
        <ScheduleTimeline segments={segs} nowMinutes={now} height={48} />
        <div className="flex items-center justify-between font-mono text-[0.62rem] text-text-faint">
          <span>{sorted.length} segments</span>
          <span>{hours.toFixed(1)} h/day runtime</span>
        </div>
      </Card>

      {/* Segments */}
      <SectionTitle>Segments</SectionTitle>
      <Card className="divide-y divide-border">
        {sorted.map((s, i) => {
          const idx = segs.indexOf(s);
          return (
            <div key={i} className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: rpmColor(s.rpm) }}
                />
                <input
                  type="time"
                  value={s.start}
                  onChange={(e) => setTime(idx, e.target.value)}
                  className="rounded-lg border border-border bg-surface/60 px-2 py-1.5 font-mono text-sm text-text outline-none focus:border-aqua/60"
                />
                <span className="font-mono text-[0.6rem] text-text-faint">{label12(s.start)}</span>
                <div className="flex-1" />
                <input
                  type="number"
                  min={0}
                  max={3450}
                  step={50}
                  value={s.rpm}
                  onChange={(e) => setRpm(idx, Number(e.target.value))}
                  className="w-[4.5rem] rounded-lg border border-border bg-surface/60 px-2 py-1.5 text-right font-mono text-sm text-text outline-none focus:border-aqua/60"
                />
                <button
                  onClick={() => removeSeg(idx)}
                  aria-label="Remove segment"
                  className="grid h-7 w-7 place-items-center rounded-lg text-text-faint active:bg-surface-2/60"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-1.5 pl-5">
                {RPM_CHIPS.map((c) => (
                  <button
                    key={c.rpm}
                    onClick={() => setRpm(idx, c.rpm)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[0.58rem] transition ${
                      s.rpm === c.rpm
                        ? "border-aqua/60 bg-aqua/10 text-aqua"
                        : "border-border bg-surface/40 text-text-faint active:bg-surface-2/60"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <button
          onClick={addSeg}
          className="w-full px-3 py-3 text-left text-[0.8rem] text-aqua active:bg-surface-2/40"
        >
          + Add segment
        </button>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2.5 pb-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-xl border border-aqua/60 bg-aqua/10 px-3 py-3 text-sm text-aqua transition active:bg-aqua/20 disabled:opacity-50"
        >
          {selectedId ? "Save changes" : "Create schedule"}
        </button>
        {selectedId && !isActive ? (
          <button
            onClick={() => void activate(selectedId)}
            disabled={busy}
            className="rounded-xl border border-border bg-surface/50 px-3 py-3 text-sm text-text transition active:bg-surface-2/60 disabled:opacity-50"
          >
            Set active
          </button>
        ) : (
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-xl border border-coral/40 bg-coral/5 px-3 py-3 text-sm text-coral transition active:bg-coral/10 disabled:opacity-50"
          >
            {selectedId ? "Delete" : "Reset"}
          </button>
        )}
      </div>
      {selectedId && !isActive ? (
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="w-full pb-3 text-center text-[0.72rem] text-coral/80 active:text-coral"
        >
          Delete this schedule
        </button>
      ) : null}

      <p className="pb-2 text-[0.7rem] leading-relaxed text-text-faint">
        The <span className="text-text">active</span> schedule drives the pump whenever you tap{" "}
        <span className="text-aqua">Schedule</span> on the home screen. If the app ever goes offline, the
        pump reverts to its onboard program on its own.
      </p>
    </div>
  );
}
