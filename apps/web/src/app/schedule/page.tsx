"use client";
import { useEffect, useRef, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { ScheduleTimeline } from "@/components/ScheduleTimeline";
import { api } from "@/lib/api";
import { sortSegments, runtimeHours, rpmColor } from "@/lib/schedule";
import { haptics } from "@/lib/haptics";
import type { Schedule, ScheduleSegment, ScheduleInput } from "@pool/types";

const SEED_FLAG = "poolpilot.presets.seeded.v1";

const STARTERS: ScheduleInput[] = [
  {
    name: "Maintenance",
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
    name: "Summer",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "08:00", rpm: 1500 },
      { start: "12:00", rpm: 2400 },
      { start: "14:00", rpm: 1500 },
      { start: "18:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
  {
    name: "Vacation",
    enabled: false,
    segments: [
      { start: "00:00", rpm: 0 },
      { start: "09:00", rpm: 1500 },
      { start: "17:00", rpm: 0 },
    ],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
  },
];

const DEFAULT_SEGS: ScheduleSegment[] = STARTERS[0]!.segments;
const CHIPS = [
  { rpm: 0, label: "Off" },
  { rpm: 1500, label: "Eco" },
  { rpm: 2400, label: "Clean" },
  { rpm: 3000, label: "Boost" },
];

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Maintenance");
  const [segs, setSegs] = useState<ScheduleSegment[]>(DEFAULT_SEGS);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const seeded = useRef(false);

  const selected = schedules.find((s) => s.id === selectedId) ?? null;
  const isActive = selected?.enabled ?? false;
  const sorted = sortSegments(segs);

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
    // One-time: make sure the default presets exist (even if the DB already has
    // other schedules). Guarded by a localStorage flag so deletes stick after.
    const alreadySeeded =
      typeof window !== "undefined" && window.localStorage.getItem(SEED_FLAG);
    if (!alreadySeeded && !seeded.current) {
      seeded.current = true;
      try {
        const have = new Set(list.map((s) => s.name.toLowerCase()));
        const missing = STARTERS.filter((s) => !have.has(s.name.toLowerCase()));
        for (const s of missing) {
          // Empty DB → keep the starter's own enabled flag; otherwise add it
          // disabled so we never steal "active" from an existing schedule.
          await api.createSchedule(list.length === 0 ? s : { ...s, enabled: false });
        }
        if (missing.length > 0) list = await api.schedules();
        if (typeof window !== "undefined") window.localStorage.setItem(SEED_FLAG, "1");
      } catch {
        /* offline */
      }
    }
    setSchedules(list);
    const choose =
      (preferId ? list.find((s) => s.id === preferId) : undefined) ??
      list.find((s) => s.enabled) ??
      list[0] ??
      null;
    if (choose) {
      setSelectedId(choose.id);
      setName(choose.name);
      setSegs(choose.segments);
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
    setName("New preset");
    setSegs(DEFAULT_SEGS);
  };
  const setRpm = (idx: number, rpm: number): void =>
    setSegs((p) => p.map((s, j) => (j === idx ? { ...s, rpm } : s)));
  const setTime = (idx: number, start: string): void =>
    setSegs((p) => p.map((s, j) => (j === idx ? { ...s, start } : s)));
  const addSeg = (): void => {
    haptics.toggle();
    setSegs((p) => [...p, { start: "12:00", rpm: 1500 }]);
  };
  const removeSeg = (idx: number): void =>
    setSegs((p) => (p.length > 1 ? p.filter((_, j) => j !== idx) : p));

  const save = async (): Promise<void> => {
    setBusy(true);
    haptics.apply();
    const input: ScheduleInput = {
      name: name.trim() || "Preset",
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

  return (
    <div className="space-y-4 pt-2">
      {/* Current schedule preview */}
      <SectionTitle>App schedule</SectionTitle>
      <Card className="space-y-2.5 p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm">{name || "—"}</span>
          <span className="font-mono text-[0.6rem] text-text-faint">
            {isActive ? "RUNNING · " : ""}
            {runtimeHours(segs).toFixed(1)} h/day
          </span>
        </div>
        <ScheduleTimeline segments={segs} nowMinutes={now} />
        <p className="text-[0.7rem] leading-relaxed text-text-faint">
          The preset marked <span className="text-aqua">Running</span> plays when you tap{" "}
          <span className="text-aqua">Schedule</span> on the home screen. Tap a preset to edit it, or hit{" "}
          <span className="text-aqua">Use</span> to run it.
        </p>
      </Card>

      {/* Presets */}
      <div className="flex items-center justify-between">
        <SectionTitle>Presets</SectionTitle>
        <button
          onClick={startNew}
          className="rounded-lg border border-border bg-surface/50 px-2.5 py-1 text-[0.7rem] text-aqua active:bg-surface-2/60"
        >
          + New
        </button>
      </div>
      <div className="grid gap-2.5">
        {schedules.map((p) => {
          const sel = p.id === selectedId;
          return (
            <div
              key={p.id}
              onClick={() => pick(p)}
              className={`glass cursor-pointer rounded-2xl p-3 transition active:scale-[0.99] ${
                sel ? "ring-1 ring-aqua/60" : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-display text-sm">
                  {p.name}
                  <span className="ml-2 font-mono text-[0.56rem] text-text-faint">
                    {runtimeHours(p.segments).toFixed(1)}h
                  </span>
                </span>
                {p.enabled ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-aqua/15 px-2 py-1 font-mono text-[0.52rem] tracking-wide text-aqua">
                    <span className="h-1.5 w-1.5 rounded-full bg-aqua shadow-[0_0_6px_var(--color-aqua)]" />
                    RUNNING
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void activate(p.id);
                    }}
                    disabled={busy}
                    className="shrink-0 rounded-lg border border-aqua/50 bg-aqua/10 px-3.5 py-1 font-mono text-[0.62rem] text-aqua active:bg-aqua/20 disabled:opacity-50"
                  >
                    Use
                  </button>
                )}
              </div>
              <ScheduleTimeline segments={p.segments} height={28} />
            </div>
          );
        })}
      </div>

      {/* Segments editor */}
      <div className="flex items-center justify-between">
        <SectionTitle>Segments</SectionTitle>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          className="rounded-lg border border-border bg-surface/50 px-2.5 py-1 text-right font-display text-[0.8rem] text-text outline-none focus:border-aqua/50"
        />
      </div>
      <Card className="divide-y divide-border">
        {sorted.map((s, i) => {
          const idx = segs.indexOf(s);
          return (
            <div key={i} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={s.start}
                  onChange={(e) => setTime(idx, e.target.value)}
                  className="rounded-lg border border-border bg-surface/60 px-2 py-1.5 font-mono text-sm text-text outline-none focus:border-aqua/50"
                />
                <div className="flex-1" />
                <span
                  className="font-display text-sm"
                  style={{ color: s.rpm > 0 ? rpmColor(s.rpm) : "var(--color-text-faint)" }}
                >
                  {s.rpm > 0 ? `${s.rpm}` : "Off"}
                </span>
                <button
                  onClick={() => removeSeg(idx)}
                  aria-label="Remove"
                  className="grid h-7 w-7 place-items-center rounded-lg text-text-faint active:bg-surface-2/60"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-1.5">
                {CHIPS.map((c) => (
                  <button
                    key={c.rpm}
                    onClick={() => setRpm(idx, c.rpm)}
                    className={`flex-1 rounded-md border py-1 font-mono text-[0.6rem] transition ${
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
          className="w-full px-4 py-3 text-left text-[0.8rem] text-aqua active:bg-surface-2/40"
        >
          + Add segment
        </button>
      </Card>

      {/* Actions */}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="w-full rounded-xl border border-aqua/60 bg-aqua/10 py-3 text-sm text-aqua transition active:bg-aqua/20 disabled:opacity-50"
      >
        {selectedId ? "Save changes" : "Create preset"}
      </button>
      {selectedId ? (
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="w-full pb-2 text-center text-[0.74rem] text-coral/80 active:text-coral"
        >
          Delete this preset
        </button>
      ) : null}
    </div>
  );
}
