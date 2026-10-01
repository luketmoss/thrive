// Trends series maths (#242). Pure: no DOM, no signals, no clock — "today" is
// always passed in. The chart, the table and every group (#243–#246) read
// their numbers from here, so a chart and its table never disagree.

import type { TrendMetric, TrendPoint } from './metrics';
import { yourRange, type YourRange } from '../../api/your-range';

// ── Dates ────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD → whole UTC days since the epoch. */
export function dayNumber(ymd: string): number {
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / MS_PER_DAY);
}

/** Shift a YYYY-MM-DD by whole days. */
export function addDays(ymd: string, days: number): string {
  return new Date((dayNumber(ymd) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The device's local calendar date. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Every date from..to inclusive, oldest first. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(from), end = dayNumber(to); n <= end; n++) {
    out.push(new Date(n * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return out;
}

// ── Controls ─────────────────────────────────────────────────────────

export const RANGES = ['1W', '1M', '3M', '6M', '1Y', 'All'] as const;
export type RangeKey = (typeof RANGES)[number];

/** Days in each fixed range, ending today inclusive. All has none. */
export const RANGE_DAYS: Record<Exclude<RangeKey, 'All'>, number> = {
  '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365,
};

/** "Resting HR, last 3 months" — the chart's accessible name. */
export const RANGE_PHRASE: Record<RangeKey, string> = {
  '1W': 'last 7 days', '1M': 'last 30 days', '3M': 'last 3 months',
  '6M': 'last 6 months', '1Y': 'last year', All: 'all time',
};

export const AVERAGES = ['Off', '7d', '14d', '30d'] as const;
export type AverageKey = (typeof AVERAGES)[number];

/** The window of an average option, or 0 for Off. */
export function averageDays(a: AverageKey): number {
  return a === 'Off' ? 0 : parseInt(a, 10);
}

export const VIEWS = ['Chart', 'Table'] as const;
export type ViewKey = (typeof VIEWS)[number];

/**
 * The range's first and last day. Fixed ranges are the last n days ending
 * `today`, inclusive. All starts at `earliest` (the first date any metric on
 * the screen has a value), falling back to 1M when there is none.
 */
export function rangeBounds(range: RangeKey, today: string, earliest: string | null): { from: string; to: string } {
  if (range === 'All') {
    if (earliest && earliest <= today) return { from: earliest, to: today };
    return { from: addDays(today, -(RANGE_DAYS['1M'] - 1)), to: today };
  }
  return { from: addDays(today, -(RANGE_DAYS[range] - 1)), to: today };
}

/** The earliest date with a value across metrics, or null. */
export function earliestDate(pointSets: readonly (readonly TrendPoint[])[]): string | null {
  let min: string | null = null;
  for (const pts of pointSets) for (const p of pts) if (min === null || p.date < min) min = p.date;
  return min;
}

// ── Rolling average ──────────────────────────────────────────────────

/**
 * The trailing n-day mean for each of `dates`: the day plus the n − 1 before
 * it, the window free to reach before the range. A day gets a point only when
 * it has a value itself and at least ⌈n/2⌉ of its window does.
 */
export function rolling(values: ReadonlyMap<string, number>, dates: readonly string[], n: number): Map<string, number> {
  const out = new Map<string, number>();
  if (n <= 0) return out;
  const need = Math.ceil(n / 2);
  for (const d of dates) {
    if (!values.has(d)) continue;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const v = values.get(addDays(d, -i));
      if (v !== undefined) {
        sum += v;
        count++;
      }
    }
    if (count >= need) out.set(d, sum / count);
  }
  return out;
}

/**
 * Runs of consecutive days, for drawing a line that breaks at every gap.
 * Input is by date; nothing is interpolated.
 */
export function segments<T extends { date: string }>(points: readonly T[]): T[][] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: T[][] = [];
  let run: T[] = [];
  for (const p of sorted) {
    if (run.length && dayNumber(p.date) !== dayNumber(run[run.length - 1].date) + 1) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

// ── Axes ─────────────────────────────────────────────────────────────

/** A 1, 2 or 5 × 10^k step giving about `count` intervals over min..max. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/**
 * About `count` gridlines at round numbers, covering min..max: the first at
 * or below min, the last at or above max.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  // A step too small to move the value (or an absurd tick count) would never
  // finish: draw the two ends rather than hang the page.
  if (!(step > 0) || lo + step === lo || (hi - lo) / step > 100) return [min, max];
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/**
 * The y domain: the range's values and the band, padded, then widened to its
 * round gridlines. `zeroBased` pins the bottom at 0.
 */
export function yDomain(
  values: readonly number[],
  band: { lo: number; hi: number } | null,
  zeroBased = false,
): { min: number; max: number; ticks: number[] } {
  const all = [...values];
  if (band) all.push(band.lo, band.hi);
  if (all.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  let min = Math.min(...all);
  let max = Math.max(...all);
  // A spread that is only floating-point noise (a 7-day mean of a constant 45.3
  // comes out 45.300000000000004) is no spread: pad it like a flat series.
  const spread = max - min;
  const pad = spread > Math.abs(max) * 1e-9 ? spread * 0.08 : Math.max(1, Math.abs(max) * 0.05);
  min -= pad;
  max += pad;
  if (zeroBased) min = 0;
  else if (Math.min(...all) >= 0 && min < 0) min = 0;
  const ticks = niceTicks(min, max, 4);
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
}

/**
 * A gridline value printed to the precision its step needs, so a 0.5 step
 * never shows as rounded whole numbers. For metrics without `axisFormat`.
 */
export function tickLabel(v: number, ticks: readonly number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(ymd: string): { y: number; m: number; d: number; wd: number } {
  const dt = new Date(`${ymd}T00:00:00Z`);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

/** "Sep 26". */
export function shortDate(ymd: string): string {
  const p = parts(ymd);
  return `${MONTHS[p.m]} ${p.d}`;
}

/** "Sat, Sep 26", with ", 2025" only when the year is not `today`'s. */
export function rowDate(ymd: string, today: string): string {
  const p = parts(ymd);
  const base = `${WEEKDAYS[p.wd]}, ${MONTHS[p.m]} ${p.d}`;
  return p.y === parts(today).y ? base : `${base}, ${p.y}`;
}

/** "(Aug 28 – Sep 26)", with years only when either end is not this year. */
export function windowText(from: string, to: string, today: string): string {
  const ty = parts(today).y;
  const fmt = (d: string) => (parts(d).y === ty ? shortDate(d) : `${shortDate(d)}, ${parts(d).y}`);
  return `(${fmt(from)} – ${fmt(to)})`;
}

export interface DateTick { date: string; label: string }

/** Rough px width of an axis label: 11px text at ~6.5px a character, plus a gap. */
const labelWidth = (label: string) => label.length * 6.5 + 10;

/**
 * Date labels for an x axis `plotWidth` px wide: weekdays for up to a week,
 * dates up to a month, months up to a year and a bit, years beyond. Thinned
 * until no two can overlap.
 */
export function dateTicks(from: string, to: string, plotWidth: number): DateTick[] {
  const dates = datesBetween(from, to);
  const n = dates.length;
  const pxPerDay = plotWidth / Math.max(1, n);
  let candidates: DateTick[];
  let steps: number[];
  if (n <= 7) {
    candidates = dates.map((d) => ({ date: d, label: WEEKDAYS[parts(d).wd] }));
    steps = [1, 2, 3, 7];
  } else if (n <= 45) {
    // Every day, counted back from `to` so the last day is always labelled.
    candidates = dates.map((d) => ({ date: d, label: shortDate(d) })).reverse();
    steps = [1, 2, 3, 7, 14, 21];
  } else if (n <= 400) {
    candidates = dates
      .filter((d) => parts(d).d === 1)
      .map((d) => ({ date: d, label: parts(d).m === 0 ? String(parts(d).y) : MONTHS[parts(d).m] }));
    steps = [1, 2, 3, 6, 12];
  } else {
    candidates = dates.filter((d) => d.endsWith('-01-01')).map((d) => ({ date: d, label: String(parts(d).y) }));
    steps = [1, 2, 5, 10, 20];
  }
  const index = new Map(dates.map((d, i) => [d, i]));
  // Thinned months keep January, which carries the year.
  const jan = n > 45 && n <= 400 ? candidates.findIndex((c) => /^\d{4}$/.test(c.label)) : -1;
  for (const step of steps) {
    const phase = jan >= 0 ? jan % step : 0;
    const picked = candidates.filter((_, i) => i % step === phase);
    let fits = true;
    for (let i = 1; i < picked.length && fits; i++) {
      const gap = Math.abs(index.get(picked[i].date)! - index.get(picked[i - 1].date)!) * pxPerDay;
      const need = (labelWidth(picked[i].label) + labelWidth(picked[i - 1].label)) / 2;
      if (gap < need) fits = false;
    }
    if (fits) return picked.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return candidates.length ? [candidates[0]] : [];
}

// ── One metric over one range ────────────────────────────────────────

export interface MetricSeries {
  /** Every day of the range, oldest first. */
  dates: string[];
  /** Every value the metric has (any date), for averages and the band. */
  all: Map<string, number>;
  /** The points inside the range, oldest first. */
  points: TrendPoint[];
  /** The rolling average per date inside the range; empty when Off. */
  average: Map<string, number>;
  /** Mean of the range's values, or null. */
  mean: number | null;
  /** Days in the range that have a value. */
  covered: number;
  /** Your range as of today, when the metric declares a band. */
  band: YourRange | null;
}

/** Everything a card or table column needs for `metric` over from..to. */
export function metricSeries(
  metric: TrendMetric,
  from: string,
  to: string,
  avgDays: number,
  today: string,
  pts: readonly TrendPoint[] = metric.points(),
): MetricSeries {
  const usable = metric.excludesToday ? pts.filter((p) => p.date !== today) : pts;
  const all = new Map(usable.map((p) => [p.date, p.value]));
  const dates = datesBetween(from, to);
  const points = usable
    .filter((p) => p.date >= from && p.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const mean = points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : null;
  return {
    dates,
    all,
    points,
    average: rolling(all, dates, avgDays),
    mean,
    covered: points.length,
    band: metric.band ? yourRange(all, today) : null,
  };
}
