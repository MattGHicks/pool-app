"use client";
import { useEffect, useState } from "react";
import { Card, Stat, SectionTitle } from "@/components/ui";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { EnergySummaryDTO } from "@pool/types";
import { fmtDollars } from "@/lib/format";

function bucketize(arr: number[], n: number): number[] {
  if (arr.length === 0) return new Array<number>(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * arr.length) / n));
    const slice = arr.slice(a, b);
    out.push(slice.reduce((s, x) => s + x, 0) / slice.length);
  }
  return out;
}

export default function EnergyPage() {
  const history = useStore((s) => s.history);
  const tel = useStore((s) => s.telemetry);
  const [summary, setSummary] = useState<EnergySummaryDTO | null>(null);

  useEffect(() => {
    const to = Date.now();
    api.energySummary(to - 24 * 60 * 60 * 1000, to).then(setSummary).catch(() => {});
  }, []);

  const liveW = tel?.watts ?? 0;
  const kwh = summary?.kwh ?? (liveW / 1000) * 24 * 0.8;
  const cost = summary?.cost ?? kwh * 0.205;
  const turnovers = summary?.turnovers ?? (kwh * 9000) / 8500;
  const eff = summary?.efficiencyPct ?? (1 - Math.exp(-turnovers)) * 100;

  const bars = bucketize(
    history.map((h) => h.watts),
    24,
  );
  const maxBar = Math.max(1, ...bars);

  return (
    <div className="space-y-4 pt-2">
      <SectionTitle>Today (estimated)</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card className="py-5">
          <Stat label="Energy" value={kwh.toFixed(1)} unit="kWh" color="var(--color-amber)" />
        </Card>
        <Card className="py-5">
          <Stat label="Est. cost" value={fmtDollars(cost)} color="var(--color-aqua)" />
        </Card>
        <Card className="py-5">
          <Stat label="Turnovers" value={turnovers.toFixed(1)} unit="x" />
        </Card>
        <Card className="py-5">
          <Stat label="Filtration" value={`${Math.round(eff)}`} unit="%" color="var(--color-aqua)" />
        </Card>
      </div>

      <SectionTitle>Recent power</SectionTitle>
      <Card className="p-4">
        <div className="flex h-28 items-end gap-1">
          {bars.map((b, i) => (
            <div
              key={i}
              className="flex-1 rounded-t"
              style={{
                height: `${(b / maxBar) * 100}%`,
                minHeight: 2,
                opacity: 0.88,
                background: "linear-gradient(to top, var(--color-amber-dim), var(--color-amber))",
              }}
            />
          ))}
        </div>
        <div className="mt-2 text-[0.62rem] leading-relaxed text-text-faint">
          Watts over the recent window. Billing uses the panel meter (Emporia); the pump&apos;s RS-485 watts
          read a little lower.
        </div>
      </Card>

      <SectionTitle>Rate</SectionTitle>
      <Card className="flex items-center justify-between px-4 py-4 text-sm">
        <span className="text-text-dim">TECO blended</span>
        <span className="font-mono text-text">$0.205 / kWh</span>
      </Card>
    </div>
  );
}
