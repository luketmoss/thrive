// "Your range" (#242 AC3): the mean ± 1 SD of the 30 local days before a date.
//
// The ONE implementation. Trends draws it as a band; the Day view (#239)
// imports this module and must not copy it — #239 adds its `zoneOf` and
// polarity here, beside it. Kept pure: no DOM, no signal, and no notion of
// "now". The caller passes the date.

/** YYYY-MM-DD → whole UTC days since the epoch. */
function dayNumber(ymd: string): number {
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

function shiftDate(ymd: string, days: number): string {
  return new Date((dayNumber(ymd) + days) * 86_400_000).toISOString().slice(0, 10);
}

export interface YourRange {
  mean: number;
  /** Population SD (÷ n). */
  sd: number;
  lo: number;
  hi: number;
  /** How many of the 30 days had a value. */
  n: number;
  /** The window's first day, D − 30. */
  from: string;
  /** The window's last day, D − 1. */
  to: string;
}

/** Fewer values than this in the window and there is no range. */
export const YOUR_RANGE_MIN_VALUES = 14;
export const YOUR_RANGE_WINDOW_DAYS = 30;

/**
 * Your range as of `date`, from the values on D − 30 … D − 1. `date` itself
 * never counts. A day with no entry contributes nothing; a `0` is a value.
 * `null` with fewer than 14 values.
 */
export function yourRange(values: ReadonlyMap<string, number>, date: string): YourRange | null {
  const from = shiftDate(date, -YOUR_RANGE_WINDOW_DAYS);
  const to = shiftDate(date, -1);
  const xs: number[] = [];
  for (let i = YOUR_RANGE_WINDOW_DAYS; i >= 1; i--) {
    const v = values.get(shiftDate(date, -i));
    if (v !== undefined && Number.isFinite(v)) xs.push(v);
  }
  if (xs.length < YOUR_RANGE_MIN_VALUES) return null;
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd, lo: mean - sd, hi: mean + sd, n, from, to };
}
