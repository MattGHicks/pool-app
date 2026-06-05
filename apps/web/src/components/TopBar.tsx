"use client";
import { useStore } from "@/lib/store";
import { fmtClock } from "@/lib/format";
import { IconWaves } from "./icons";

export function TopBar() {
  const connected = useStore((s) => s.connected);
  const tel = useStore((s) => s.telemetry);
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-xl bg-aqua/10 text-aqua"
          style={{ boxShadow: "0 0 18px -4px var(--color-aqua)" }}
        >
          <IconWaves width={18} height={18} />
        </div>
        <div className="font-display text-sm tracking-wide">PoolPilot</div>
      </div>
      <div className="flex items-center gap-2 text-[0.7rem]">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-aqua" : "bg-text-faint"}`}
          style={connected ? { boxShadow: "0 0 8px var(--color-aqua)" } : undefined}
        />
        <span className="font-mono text-text-dim">{connected ? "Live" : "Offline"}</span>
        {tel ? <span className="font-mono text-text-faint">· {fmtClock(tel.clockMinutes)}</span> : null}
      </div>
    </header>
  );
}
