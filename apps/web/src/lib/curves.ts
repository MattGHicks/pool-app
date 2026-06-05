// Mirror of the API's energy curves, for client-side demo synthesis + estimates.
const RPM_TO_GPM: ReadonlyArray<readonly [number, number]> = [
  [1400, 22], [1500, 25], [1800, 34], [2000, 40], [2200, 48],
  [2400, 54], [2500, 58], [3000, 78], [3450, 98],
];
const WATTS_CURVE: ReadonlyArray<readonly [number, number]> = [
  [1000, 90], [1200, 107], [1400, 133], [1500, 160], [1800, 267], [2000, 344],
  [2200, 407], [2400, 494], [2500, 614], [2800, 802], [3000, 1007], [3200, 1234], [3450, 1487],
];

function interp(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1]!;
    const [x1, y1] = table[i]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

export const estGpm = (rpm: number): number => (rpm <= 0 ? 0 : Math.round(interp(RPM_TO_GPM, rpm)));
export const calibratedWatts = (rpm: number): number => (rpm <= 0 ? 0 : Math.round(interp(WATTS_CURVE, rpm)));
