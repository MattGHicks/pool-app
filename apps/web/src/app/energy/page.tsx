"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Stat } from "@/components/ui";
import { AreaChart, BarSeries, StackedBar } from "@/components/charts";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { fmtDollars, fmtWatts } from "@/lib/format";
import { calibratedWatts, estGpm } from "@/lib/curves";
import type { EnergySummaryDTO, EnergyBucketDTO } from "@pool/types";

const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
const RATE = 0.205;
const POOL_GAL = 8500;
const WEF = 9000;
const TURNOVER_TARGET = 1.5; // turnovers/day for a healthy pool

type RangeKey = "today" | "7d" | "30d";
const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

const BANDS: Array<{ key: string; label: string; color: string }> = [
  { key: "off", label: "Off", color: "#33414f" },
  { key: "low", label: "Eco", color: "var(--color-aqua)" },
  { key: "mid", label: "Clean", color: "#8fd14f" },
  { key: "high", label: "Boost", color: "var(--color-amber)" },
];

function rangeBounds(key: RangeKey): { from: number; to: number; res: "hour" | "day" } {
  const to = Date.now();
  if (key === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to, res: "hour" };
  }
  const days = key === "7d" ? 7 : 30;
  return { from: to - days * 86_400_000, to, res: "day" };
}

function labelFor(ts: number, res: "hour" | "day"): string {
  const d = new Date(ts);
  if (res === "hour") {
    const h = d.getHours();
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
}

function pickLabels(buckets: EnergyBucketDTO[], res: "hour" | "day"): string[] {
  if (buckets.length === 0) return [];
  const at = (f: number): string => labelFor(buckets[Math.min(buckets.length - 1, Math.floor(f * buckets.length))]!.ts, res);
  return [labelFor(buckets[0]!.ts, res), at(0.33), at(0.66), labelFor(buckets[buckets.length - 1]!.ts, res)];
}

interface Loaded {
  summary: EnergySummaryDTO;
  buckets: EnergyBucketDTO[];
  bands: Array<{ band: string; samples: number }>;
}

function demoLoad(key: RangeKey): Loaded {
  const { from, to, res } = rangeBounds(key);
  const n = key === "today" ? new Date().getHours() + 1 : key === "7d" ? 7 : 30;
  const buckets: EnergyBucketDTO[] = Array.from({ length: Math.max(1, n) }, (_, i) => {
    let avgRpm = 0;
    let runFrac = 0;
    if (res === "hour") {
      const h = i;
      if (h >= 8 && h < 18) {
        avgRpm = h >= 11 && h < 14 ? 2400 : 1500;
        runFrac = 1;
      }
    } else {
      avgRpm = 1600;
      runFrac = 0.42;
    }
    const inst = avgRpm > 0 ? calibratedWatts(avgRpm) : 0;
    const avgWatts = res === "day" ? inst * 0.42 : inst;
    return {
      ts: from + i * (res === "hour" ? 3_600_000 : 86_400_000),
      avgWatts: avgWatts * (0.92 + 0.12 * Math.sin(i * 1.3)),
      maxWatts: inst * 1.15,
      avgRpm,
      runFrac,
    };
  });
  const hours = res === "hour" ? 1 : 24;
  const kwh = buckets.reduce((s, b) => s + (b.avgWatts / 1000) * hours, 0);
  const gallons = kwh * WEF;
  const turnovers = gallons / POOL_GAL;
  return {
    summary: {
      from,
      to,
      kwh,
      cost: kwh * RATE,
      runtimeHours: buckets.reduce((s, b) => s + b.runFrac * hours, 0),
      turnovers,
      efficiencyPct: (1 - Math.exp(-turnovers)) * 100,
      avgWatts: buckets.reduce((s, b) => s + b.avgWatts, 0) / buckets.length,
      peakWatts: Math.max(...buckets.map((b) => b.maxWatts), 0),
      gallons,
    },
    buckets,
    bands: [
      { band: "off", samples: 52_000 },
      { band: "low", samples: 30_000 },
      { band: "mid", samples: 9_000 },
      { band: "high", samples: 1_200 },
    ],
  };
}

export default function EnergyPage() {
  const tel = useStore((s) => s.telemetry);
  const history = useStore((s) => s.history);
  const [range, setRange] = useState<RangeKey>("today");
  const [data, setData] = useState<Loaded | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback((): (() => void) => {
    let cancelled = false;
    const { from, to, res } = rangeBounds(range);
    Promise.all([api.energySummary(from, to), api.energySeries(from, to, res), api.energySpeed(from, to)])
      .then(([summary, series, speed]) => {
        if (!cancelled) setData({ summary, buckets: series.buckets, bands: speed.bands });
      })
      .catch(() => {
        if (!cancelled && DEMO) setData(demoLoad(range));
        else if (!cancelled) setData({ summary: demoLoad(range).summary, buckets: [], bands: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => load(), [load]);

  const resetStats = async (): Promise<void> => {
    setResetting(true);
    haptics.apply();
    try {
      await api.resetEnergy();
    } catch {
      /* offline / demo */
    }
    setConfirmingReset(false);
    setResetting(false);
    load();
  };

  const res: "hour" | "day" = range === "today" ? "hour" : "day";
  const buckets = data?.buckets ?? [];
  const s = data?.summary;
  const hoursPerBucket = res === "hour" ? 1 : 24;

  const wattsSeries = buckets.map((b) => b.avgWatts);
  const rpmSeries = buckets.map((b) => b.avgRpm);
  const kwhSeries = buckets.map((b) => (b.avgWatts / 1000) * hoursPerBucket);
  const labels = useMemo(() => pickLabels(buckets, res), [buckets, res]);
  const nowFrac = range === "today" ? (new Date().getHours() * 60 + new Date().getMinutes()) / 1440 : undefined;

  const liveW = tel?.watts ?? 0;
  const bandSec = (k: string): number => (data?.bands.find((b) => b.band === k)?.samples ?? 0);
  const bandTotal = BANDS.reduce((t, b) => t + bandSec(b.key), 0) || 1;

  const projMonth = s ? (range === "today" ? s.cost * 30 : (s.cost / (range === "7d" ? 7 : 30)) * 30) : 0;
  const turnPerDay = s ? (range === "today" ? s.turnovers : s.turnovers / (range === "7d" ? 7 : 30)) : 0;

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-end justify-between">
        <h1 className="font-display text-xl tracking-tight">Energy</h1>
        <div className="flex gap-1 rounded-xl border border-border bg-surface/40 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-lg px-2.5 py-1 text-[0.7rem] transition ${
                range === r.key ? "bg-aqua/15 text-aqua" : "text-text-faint"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live now */}
      <Card className="flex items-center justify-between p-3.5">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${liveW > 0 ? "bg-aqua" : "bg-text-faint"}`}
            style={liveW > 0 ? { boxShadow: "0 0 7px var(--color-aqua)" } : undefined}
          />
          <span className="font-mono text-[0.62rem] uppercase tracking-wider text-text-faint">Now</span>
        </div>
        <div className="flex items-center gap-5 font-mono text-[0.72rem]">
          <span>
            <span className="text-amber">{fmtWatts(liveW)}</span> <span className="text-text-faint">W</span>
          </span>
          <span>
            <span className="text-aqua">{tel?.rpm ?? 0}</span> <span className="text-text-faint">rpm</span>
          </span>
          <span>
            <span className="text-text">{estGpm(tel?.rpm ?? 0)}</span>{" "}
            <span className="text-text-faint">gpm</span>
          </span>
          <span>
            <span className="text-text">{fmtDollars((liveW / 1000) * RATE)}</span>
            <span className="text-text-faint">/hr</span>
          </span>
        </div>
      </Card>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="py-4">
          <Stat label="Energy" value={(s?.kwh ?? 0).toFixed(1)} unit="kWh" color="var(--color-amber)" />
        </Card>
        <Card className="py-4">
          <Stat label="Cost" value={fmtDollars(s?.cost ?? 0)} color="var(--color-aqua)" />
        </Card>
        <Card className="py-4">
          <Stat label="Runtime" value={(s?.runtimeHours ?? 0).toFixed(1)} unit="h" />
        </Card>
        <Card className="py-4">
          <Stat label="Avg power" value={fmtWatts(s?.avgWatts ?? 0)} unit="W" />
        </Card>
        <Card className="py-4">
          <Stat label="Peak" value={fmtWatts(s?.peakWatts ?? 0)} unit="W" color="var(--color-amber)" />
        </Card>
        <Card className="py-4">
          <Stat
            label="Turnovers"
            value={(s?.turnovers ?? 0).toFixed(1)}
            unit="x"
            color="var(--color-aqua)"
          />
        </Card>
      </div>

      {/* Power over time */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.62rem] uppercase tracking-[0.2em] text-text-faint">Power draw</span>
          <span className="font-mono text-[0.6rem] text-amber">
            peak {fmtWatts(s?.peakWatts ?? 0)} W
          </span>
        </div>
        {buckets.length > 1 ? (
          <AreaChart points={wattsSeries} color="var(--color-amber)" labels={labels} nowFrac={nowFrac} />
        ) : (
          <EmptyChart />
        )}
      </Card>

      {/* Energy per bucket */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.62rem] uppercase tracking-[0.2em] text-text-faint">
            Energy / {res === "hour" ? "hour" : "day"}
          </span>
          <span className="font-mono text-[0.6rem] text-aqua">{(s?.kwh ?? 0).toFixed(1)} kWh total</span>
        </div>
        {buckets.length > 0 ? <BarSeries values={kwhSeries} labels={labels} /> : <EmptyChart />}
      </Card>

      {/* RPM profile */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.62rem] uppercase tracking-[0.2em] text-text-faint">Speed profile</span>
          <span className="font-mono text-[0.6rem] text-text-dim">rpm</span>
        </div>
        {buckets.length > 1 ? (
          <AreaChart points={rpmSeries} color="var(--color-aqua)" max={3450} labels={labels} nowFrac={nowFrac} />
        ) : (
          <EmptyChart />
        )}
      </Card>

      {/* Speed distribution */}
      <Card className="space-y-3 p-4">
        <span className="text-[0.62rem] uppercase tracking-[0.2em] text-text-faint">Time by speed</span>
        <StackedBar segments={BANDS.map((b) => ({ value: bandSec(b.key), color: b.color }))} />
        <div className="grid grid-cols-4 gap-2">
          {BANDS.map((b) => (
            <div key={b.key} className="text-center">
              <div className="mx-auto mb-1 h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
              <div className="font-mono text-[0.7rem] text-text">{((bandSec(b.key) / 3600)).toFixed(1)}h</div>
              <div className="text-[0.52rem] uppercase tracking-wider text-text-faint">{b.label}</div>
              <div className="font-mono text-[0.5rem] text-text-faint">
                {Math.round((bandSec(b.key) / bandTotal) * 100)}%
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Projections */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="space-y-1 p-4">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-text-faint">Projected / month</div>
          <div className="font-display text-2xl text-aqua">{fmtDollars(projMonth)}</div>
          <div className="font-mono text-[0.58rem] text-text-faint">at {fmtDollars(RATE)}/kWh</div>
        </Card>
        <Card className="space-y-2 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[0.6rem] uppercase tracking-[0.18em] text-text-faint">Turnovers/day</span>
            <span className="font-mono text-[0.58rem] text-text-faint">target {TURNOVER_TARGET}x</span>
          </div>
          <div className="font-display text-2xl">{turnPerDay.toFixed(1)}x</div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-aqua"
              style={{ width: `${Math.min(100, (turnPerDay / TURNOVER_TARGET) * 100)}%` }}
            />
          </div>
        </Card>
      </div>

      {/* Live mini-strip + rate */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.62rem] uppercase tracking-[0.2em] text-text-faint">Live power</span>
          <span className="font-mono text-[0.6rem] text-amber">{fmtWatts(liveW)} W now</span>
        </div>
        <AreaChart points={history.map((h) => h.watts)} color="var(--color-amber)" height={70} />
      </Card>

      <Card className="flex items-center justify-between px-4 py-3.5 text-sm">
        <span className="text-text-dim">TECO blended rate</span>
        <span className="font-mono text-text">{fmtDollars(RATE)} / kWh</span>
      </Card>
      <p className="px-1 pb-2 text-[0.62rem] leading-relaxed text-text-faint">
        Billing uses the panel meter (Emporia); the pump&apos;s RS-485 watts read a little lower than true
        wall power. Charts fill in as the pump runs and history accumulates.
      </p>

      {/* Reset stats */}
      {confirmingReset ? (
        <Card className="space-y-3 border border-coral/40 p-4">
          <div className="flex items-start gap-2">
            <span className="text-base leading-none text-coral">⚠</span>
            <div className="space-y-1">
              <div className="text-sm text-coral">Reset all energy stats?</div>
              <p className="text-[0.66rem] leading-relaxed text-text-dim">
                This permanently deletes all recorded telemetry — energy, cost, runtime, charts and
                speed history will be wiped and can&apos;t be recovered. New data starts collecting
                from scratch.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setConfirmingReset(false)}
              disabled={resetting}
              className="rounded-xl border border-border py-2.5 text-sm text-text-dim transition active:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void resetStats()}
              disabled={resetting}
              className="rounded-xl border border-coral/60 bg-coral/10 py-2.5 text-sm text-coral transition active:bg-coral/20 disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset stats"}
            </button>
          </div>
        </Card>
      ) : (
        <button
          onClick={() => {
            haptics.toggle();
            setConfirmingReset(true);
          }}
          className="w-full pb-2 text-center text-[0.74rem] text-coral/80 transition active:text-coral"
        >
          Reset energy stats
        </button>
      )}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-[130px] place-items-center rounded-xl border border-dashed border-border text-[0.66rem] text-text-faint">
      Collecting data…
    </div>
  );
}
