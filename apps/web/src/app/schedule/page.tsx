"use client";
import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import type { Schedule, ScheduleSegment } from "@pool/types";

const SAMPLE: ScheduleSegment[] = [
  { start: "00:00", rpm: 1500 },
  { start: "12:00", rpm: 2400 },
  { start: "16:00", rpm: 1500 },
  { start: "20:00", rpm: 0 },
];

const PRESETS: { name: string; segs: ScheduleSegment[] }[] = [
  { name: "Vacation", segs: [{ start: "09:00", rpm: 1500 }, { start: "17:00", rpm: 0 }] },
  { name: "Maintenance", segs: [{ start: "08:00", rpm: 1500 }, { start: "18:00", rpm: 0 }] },
  {
    name: "Active",
    segs: [
      { start: "08:00", rpm: 1500 },
      { start: "12:00", rpm: 2400 },
      { start: "14:00", rpm: 1500 },
      { start: "18:00", rpm: 0 },
    ],
  },
];

function toMin(s: string): number {
  const [h = "0", m = "0"] = s.split(":");
  return Number(h) * 60 + Number(m);
}

function rpmColor(rpm: number): string {
  if (rpm <= 0) return "var(--color-border-bright)";
  const t = Math.min(1, (rpm - 1000) / 2450);
  return `color-mix(in oklab, var(--color-aqua) ${Math.round(85 - t * 55)}%, var(--color-amber) ${Math.round(t * 60)}%)`;
}

function Timeline({ segs }: { segs: ScheduleSegment[] }) {
  const sorted = [...segs].sort((a, b) => toMin(a.start) - toMin(b.start));
  const blocks = sorted.map((seg, i) => {
    const start = toMin(seg.start);
    const end = i < sorted.length - 1 ? toMin(sorted[i + 1]!.start) : 1440;
    return { rpm: seg.rpm, width: ((end - start) / 1440) * 100 };
  });
  return (
    <div>
      <div className="flex h-11 w-full overflow-hidden rounded-xl border border-border">
        {blocks.map((b, i) => (
          <div
            key={i}
            style={{ width: `${b.width}%`, background: rpmColor(b.rpm) }}
            className="grid place-items-center"
          >
            {b.width > 13 ? (
              <span className="font-mono text-[0.54rem] text-bg/80">{b.rpm > 0 ? b.rpm : "off"}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.54rem] text-text-faint">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [segs, setSegs] = useState<ScheduleSegment[]>(SAMPLE);

  useEffect(() => {
    api
      .schedules()
      .then((list) => {
        const s = list.find((x) => x.enabled) ?? list[0];
        if (s) {
          setSchedule(s);
          setSegs(s.segments);
        }
      })
      .catch(() => {});
  }, []);

  const applyPreset = async (next: ScheduleSegment[], name: string): Promise<void> => {
    setSegs(next);
    try {
      if (schedule) {
        await api.updateSchedule(schedule.id, { ...schedule, name, segments: next });
      } else {
        const created = await api.createSchedule({
          name,
          enabled: true,
          segments: next,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          priority: 0,
        });
        setSchedule(created);
      }
    } catch {
      /* offline / demo */
    }
  };

  const sortedSegs = [...segs].sort((a, b) => toMin(a.start) - toMin(b.start));

  return (
    <div className="space-y-4 pt-2">
      <SectionTitle>Daily schedule</SectionTitle>
      <Card className="rise space-y-3 p-4">
        <Timeline segs={segs} />
        <p className="text-[0.72rem] leading-relaxed text-text-faint">
          The pump follows this speed-by-time plan. Your pump&apos;s onboard schedule stays the failsafe if
          the app goes offline.
        </p>
      </Card>

      <SectionTitle>Presets</SectionTitle>
      <div className="grid gap-2.5">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => void applyPreset(p.segs, p.name)}
            className="glass rounded-2xl p-3 text-left transition active:scale-[0.99]"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-sm">{p.name}</span>
              <span className="font-mono text-[0.6rem] text-text-faint">{p.segs.length} segments</span>
            </div>
            <Timeline segs={p.segs} />
          </button>
        ))}
      </div>

      <SectionTitle>Segments</SectionTitle>
      <Card className="divide-y divide-border">
        {sortedSegs.map((s, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-mono text-text-dim">{s.start}</span>
            <span
              className="font-display"
              style={{ color: s.rpm > 0 ? "var(--color-aqua)" : "var(--color-text-faint)" }}
            >
              {s.rpm > 0 ? `${s.rpm} rpm` : "Off"}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
