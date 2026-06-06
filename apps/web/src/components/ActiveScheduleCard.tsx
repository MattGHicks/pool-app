"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ScheduleTimeline } from "@/components/ScheduleTimeline";
import { api } from "@/lib/api";
import { rpmAt, runtimeHours } from "@/lib/schedule";
import type { Schedule } from "@pool/types";

/** Shown on the Live screen while in Schedule mode: what schedule is running,
 *  its 24h plan, and what it's doing right now. */
export function ActiveScheduleCard() {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    api
      .schedules()
      .then((list) => setSched(list.find((s) => s.enabled) ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
    const tick = (): void => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!loaded) return null;

  if (!sched) {
    return (
      <Card className="p-4">
        <div className="text-[0.78rem] text-text-faint">
          No schedule set yet.{" "}
          <Link href="/schedule" className="text-aqua underline-offset-2 hover:underline">
            Create one
          </Link>{" "}
          so the app can run it — until then the pump follows its onboard program.
        </div>
      </Card>
    );
  }

  const current = rpmAt(sched.segments, now);
  return (
    <Card className="space-y-2.5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-aqua shadow-[0_0_7px_var(--color-aqua)]" />
          <span className="font-display text-sm">{sched.name}</span>
        </div>
        <span className="font-mono text-[0.6rem] text-text-faint">
          {runtimeHours(sched.segments).toFixed(1)}h/day
        </span>
      </div>
      <ScheduleTimeline segments={sched.segments} nowMinutes={now} height={40} />
      <div className="flex items-center justify-between text-[0.7rem]">
        <span className="text-text-faint">Running now</span>
        <span
          className="font-display"
          style={{ color: current > 0 ? "var(--color-aqua)" : "var(--color-text-faint)" }}
        >
          {current > 0 ? `${current} rpm` : "Off"}
        </span>
      </div>
    </Card>
  );
}
