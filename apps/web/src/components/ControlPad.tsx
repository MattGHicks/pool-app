"use client";
import { useStore } from "@/lib/store";
import { commandSetRpm, commandResume, commandOff } from "@/lib/controls";
import { haptics } from "@/lib/haptics";

const PRESETS = [
  { rpm: 1500, label: "Eco" },
  { rpm: 2400, label: "Clean" },
  { rpm: 3000, label: "Boost" },
];

export function ControlPad() {
  const control = useStore((s) => s.control);
  const mode = control?.controlMode ?? "off";
  const target = control?.targetRpm ?? 0;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {PRESETS.map((p) => {
          const active = mode === "manual" && Math.abs(target - p.rpm) < 30;
          return (
            <button
              key={p.rpm}
              onClick={() => {
                haptics.toggle();
                void commandSetRpm(p.rpm);
              }}
              className={`rounded-xl border px-2 py-2.5 text-center transition ${
                active ? "border-aqua/60 bg-aqua/10" : "border-border bg-surface/40 active:bg-surface-2/60"
              }`}
            >
              <div
                className="font-display text-base leading-none"
                style={{ color: active ? "var(--color-aqua)" : "var(--color-text)" }}
              >
                {p.label}
              </div>
              <div className="mt-1 font-mono text-[0.6rem] text-text-faint">{p.rpm} rpm</div>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => {
            haptics.toggle();
            void commandResume();
          }}
          className={`rounded-xl border px-3 py-3 text-sm transition ${
            mode === "schedule"
              ? "border-aqua/60 bg-aqua/10 text-aqua"
              : "border-border bg-surface/40 text-text active:bg-surface-2/60"
          }`}
        >
          App Schedule
        </button>
        <button
          onClick={() => {
            haptics.toggle();
            void commandOff();
          }}
          className={`rounded-xl border px-3 py-3 text-sm transition ${
            mode === "off"
              ? "border-amber/60 bg-amber/10 text-amber"
              : "border-border bg-surface/40 text-text active:bg-surface-2/60"
          }`}
        >
          Pump Schedule
        </button>
      </div>
    </div>
  );
}
