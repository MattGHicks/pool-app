import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`glass rounded-2xl ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="text-center">
      <div className="font-display text-lg leading-none" style={{ color: color ?? "var(--color-text)" }}>
        {value}
        {unit ? <span className="ml-0.5 text-[0.6rem] text-text-dim">{unit}</span> : null}
      </div>
      <div className="mt-1.5 text-[0.56rem] uppercase tracking-[0.18em] text-text-faint">{label}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-1 text-[0.66rem] font-medium uppercase tracking-[0.24em] text-text-faint">
      {children}
    </h2>
  );
}
