"use client";
import { Gauge } from "@/components/Gauge";
import { RadialRpmSlider } from "@/components/RadialRpmSlider";
import { ControlPad } from "@/components/ControlPad";
import { ActiveScheduleCard } from "@/components/ActiveScheduleCard";
import { FailsafeBanner } from "@/components/FailsafeBanner";
import { Sparkline } from "@/components/Sparkline";
import { Card, Stat } from "@/components/ui";
import { useStore } from "@/lib/store";
import { commandSetRpm } from "@/lib/controls";
import { fmtRpm, fmtWatts, fmtDollars } from "@/lib/format";

export default function LivePage() {
  const tel = useStore((s) => s.telemetry);
  const control = useStore((s) => s.control);
  const history = useStore((s) => s.history);

  const rpm = tel?.rpm ?? 0;
  const watts = tel?.watts ?? 0;
  const target = control?.targetRpm ?? rpm;
  const gpm = tel?.estGpm ?? 0;
  const dph = tel?.dollarsPerHour ?? 0;
  const ok = !tel || tel.statusWord === 0;

  return (
    <div className="space-y-4">
      <div className="rise grid place-items-center pt-1">
        <RadialRpmSlider target={target} actual={rpm} onApply={(r) => void commandSetRpm(r)} />
      </div>

      <div className="rise" style={{ animationDelay: "60ms" }}>
        <ControlPad />
      </div>

      {control?.controlMode === "schedule" ? (
        <div className="rise" style={{ animationDelay: "90ms" }}>
          <ActiveScheduleCard />
        </div>
      ) : null}

      <div className="rise grid grid-cols-2 gap-3" style={{ animationDelay: "120ms" }}>
        <Card className="grid place-items-center py-3">
          <Gauge value={rpm} max={3450} label="Speed" display={fmtRpm(rpm)} unit="rpm" />
        </Card>
        <Card className="grid place-items-center py-3">
          <Gauge
            value={watts}
            max={1500}
            label="Power"
            display={fmtWatts(watts)}
            unit="watts"
            color="var(--color-amber)"
          />
        </Card>
      </div>

      <Card className="rise p-4" style={{ animationDelay: "180ms" }}>
        <div className="mb-2 flex items-center justify-between text-[0.6rem] uppercase tracking-[0.2em] text-text-faint">
          <span>Recent power</span>
          <span className="text-amber">{fmtWatts(watts)} W now</span>
        </div>
        <Sparkline points={history.map((h) => h.watts)} color="var(--color-amber)" />
      </Card>

      <div className="rise grid grid-cols-3 gap-3" style={{ animationDelay: "220ms" }}>
        <Card className="py-4">
          <Stat label="Flow" value={String(gpm)} unit="gpm" color="var(--color-aqua)" />
        </Card>
        <Card className="py-4">
          <Stat label="Cost" value={fmtDollars(dph)} unit="/hr" />
        </Card>
        <Card className="py-4">
          <Stat
            label="Status"
            value={tel?.statusText ?? "—"}
            color={ok ? "var(--color-aqua)" : "var(--color-coral)"}
          />
        </Card>
      </div>

      <div className="rise" style={{ animationDelay: "260ms" }}>
        <FailsafeBanner />
      </div>
    </div>
  );
}
