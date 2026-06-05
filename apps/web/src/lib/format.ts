export function fmtRpm(rpm: number): string {
  return Math.round(rpm).toLocaleString("en-US");
}

export function fmtWatts(w: number): string {
  return Math.round(w).toLocaleString("en-US");
}

export function fmtDollars(d: number): string {
  return `$${d.toFixed(2)}`;
}

export function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
