/**
 * Energy math ported from the energy_usage Python project (pool_pump_analysis.py,
 * build_charts.py). Used to derive flow, calibrated watts, cost, and turnover
 * efficiency from live RPM/watts.
 */
export const ENERGY_DEFAULTS = {
  ratePerKwh: 0.205,
  poolGallons: 8500,
  wefGalPerKwh: 9000,
} as const;

/** Real-world flow estimates (conservative residential install), RPM -> GPM. */
export const RPM_TO_GPM: ReadonlyArray<readonly [number, number]> = [
  [1400, 22], [1500, 25], [1800, 34], [2000, 40], [2200, 48],
  [2400, 54], [2500, 58], [3000, 78], [3450, 98],
];

/** Calibrated VST watts curve for this install (160 W @ 1500 RPM measured). */
export const WATTS_CURVE: ReadonlyArray<readonly [number, number]> = [
  [1000, 90], [1200, 107], [1400, 133], [1500, 160], [1800, 267], [2000, 344],
  [2200, 407], [2400, 494], [2500, 614], [2800, 802], [3000, 1007], [3200, 1234], [3450, 1487],
];

function interpolate(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1]!;
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Estimated flow (GPM) from RPM. */
export function estGpm(rpm: number): number {
  return rpm <= 0 ? 0 : Math.round(interpolate(RPM_TO_GPM, rpm));
}

/** Calibrated watts estimate from RPM (cross-check against the live drive watts). */
export function calibratedWatts(rpm: number): number {
  return rpm <= 0 ? 0 : Math.round(interpolate(WATTS_CURVE, rpm));
}

/** Live cost rate ($/hour) from instantaneous watts. */
export function dollarsPerHour(watts: number, ratePerKwh: number = ENERGY_DEFAULTS.ratePerKwh): number {
  return (watts / 1000) * ratePerKwh;
}

/** Turnover-based filtration efficiency: (1 - e^-turnovers) * 100. */
export function efficiencyPct(turnovers: number): number {
  return (1 - Math.exp(-turnovers)) * 100;
}

/** Gallons moved over a duration at a given GPM. */
export function gallonsMoved(gpm: number, minutes: number): number {
  return gpm * minutes;
}
