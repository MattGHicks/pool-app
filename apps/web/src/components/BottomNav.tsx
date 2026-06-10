"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGauge, IconClock, IconBolt, IconSliders } from "./icons";

const TABS = [
  { href: "/", label: "Live", Icon: IconGauge },
  { href: "/schedule", label: "Schedule", Icon: IconClock },
  { href: "/energy", label: "Energy", Icon: IconBolt },
  { href: "/settings", label: "Settings", Icon: IconSliders },
] as const;

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md px-4 pb-[max(0.7rem,env(safe-area-inset-bottom))]">
      <div className="glass-nav flex items-center justify-around rounded-2xl px-1 py-2">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              <span className="relative grid place-items-center">
                {/* Soft radial glow behind the active icon — mobile-safe (no SVG
                    drop-shadow filter, which produced edge artifacts on Chrome mobile). */}
                {active ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute h-9 w-9 rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle, color-mix(in oklab, var(--color-aqua) 42%, transparent) 0%, transparent 68%)",
                    }}
                  />
                ) : null}
                <Icon
                  width={21}
                  height={21}
                  className={`relative ${active ? "text-aqua" : "text-text-faint"}`}
                />
              </span>
              <span
                className={`text-[0.58rem] tracking-wide ${active ? "text-aqua" : "text-text-faint"}`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
