"use client";
import { useStore } from "@/lib/store";
import { IconShield } from "./icons";

export function FailsafeBanner() {
  const control = useStore((s) => s.control);
  const connected = useStore((s) => s.connected);
  const mode = control?.controlMode ?? "off";
  const label =
    mode === "manual" ? "Manual override" : mode === "schedule" ? "On app schedule" : "Pump-managed";
  return (
    <div className="glass flex items-start gap-3 rounded-2xl px-4 py-3">
      <div className="mt-0.5 text-aqua">
        <IconShield width={18} height={18} />
      </div>
      <div className="text-[0.78rem] leading-relaxed">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium text-text">{label}</span>
          <span className="text-text-faint">·</span>
          <span className={connected ? "text-aqua" : "text-amber"}>
            {connected ? "bridge connected" : "bridge offline"}
          </span>
        </div>
        <div className="text-text-faint">
          If the app or bridge drops, the pump safely reverts to its onboard schedule.
        </div>
      </div>
    </div>
  );
}
