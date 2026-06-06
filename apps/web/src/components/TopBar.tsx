"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { fmtClock } from "@/lib/format";
import { IconWaves } from "./icons";

export function TopBar() {
  const connected = useStore((s) => s.connected);
  const tel = useStore((s) => s.telemetry);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] transition-colors duration-300 ${
        scrolled ? "glass-bar border-b border-border" : "border-b border-transparent"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-xl bg-aqua/10 text-aqua"
          style={{ boxShadow: "0 0 16px -5px var(--color-aqua)" }}
        >
          <IconWaves width={18} height={18} />
        </div>
        <div className="font-display text-sm tracking-wide">PoolPilot</div>
      </div>
      <div className="flex items-center gap-2 text-[0.7rem]">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-aqua" : "bg-text-faint"}`}
          style={connected ? { boxShadow: "0 0 7px var(--color-aqua)" } : undefined}
        />
        <span className="font-mono text-text-dim">{connected ? "Live" : "Offline"}</span>
        {tel ? <span className="font-mono text-text-faint">· {fmtClock(tel.clockMinutes)}</span> : null}
      </div>
    </header>
  );
}
