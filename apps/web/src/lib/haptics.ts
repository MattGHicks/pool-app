/** Light haptic tick (no-op where unsupported). */
export function tick(pattern: number | number[] = 5): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

export const haptics = {
  step: () => tick(4),
  apply: () => tick([14, 30, 14]),
  toggle: () => tick(10),
};
