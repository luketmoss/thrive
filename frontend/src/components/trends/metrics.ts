// The Trends metric registry (#242) — the contract #243–#246 plug into.
//
// A metric says where its daily values come from and how to print them; the
// chart, the table, the averages and "your range" are the same for every one.
// Adding a metric is one entry in TREND_GROUPS, with no chart change.

import { dailyHealth, bodyMeasurements } from '../../state/store';
import type { DailyHealthField, BodyMeasurementRow } from '../../api/health-api';
import { parse, kgToLb } from '../../api/units';
import { bodyDayOf, type BodyDay } from '../../api/body-day';
import { formatSleep, axisSleep } from './sleep-duration';

export interface TrendPoint {
  date: string;
  value: number;
  /** A sentence for the table; the chart draws the day as a hollow dot (#245's coverage). */
  partial?: string;
}

/** The health tab a metric's `points()` reads; Trends waits on, and reports errors from, exactly these. */
export type TrendSource = 'dailyHealth' | 'bodyMeasurements';

export interface TrendMetric {
  id: string;
  /** Which tab `points()` reads. Defaults to `dailyHealth`. */
  source?: TrendSource;
  label: string;
  unit: string;
  /** Every day with a value, from #236's signals. Blanks omitted. The metric owns any reduction. */
  points(): TrendPoint[];
  /** A value as the chart and table print it, without the unit. */
  format(v: number): string;
  /** Y-axis labels, when they want a different precision from `format`. */
  axisFormat?(v: number, ticks: readonly number[]): string;
  /** Draws yourRange as of today. */
  band: boolean;
  /** The y-axis starts at 0 (steps, activity). */
  zeroBased?: boolean;
  /** Today is a partial day and is not plotted (steps). */
  excludesToday?: boolean;
  /** One line under the card's header, e.g. "Outdoor only" (#245). */
  note?: string;
}

/** 1–4 metrics, one card each, on one shared x domain. */
export interface TrendGroup {
  id: string;
  label: string;
  metrics: TrendMetric[];
}

// ── Point sources ────────────────────────────────────────────────────

/**
 * One DailyHealth column as points: one per row with a date and a value,
 * `''` omitted and `'0'` kept as 0. Empty until the tab has loaded.
 */
export function dailyHealthPoints(field: DailyHealthField): TrendPoint[] {
  const s = dailyHealth.value;
  if (s.state !== 'loaded') return [];
  const out: TrendPoint[] = [];
  for (const row of s.rows) {
    if (!row.date) continue;
    const v = parse(row[field] ?? '');
    if (v !== null) out.push({ date: row.date, value: v });
  }
  return out;
}

// BodyMeasurements holds one row per reading, so a day can have several. The
// metric owns the reduction: `bodyDayOf` is the Day view's, which mirrors
// DailySummary U:Y (first weigh-in with a weight; BP mean, half up).

let dayCache: { rows: unknown; days: [string, BodyDay][] } | null = null;

/** Every local date with a BodyMeasurements reading, oldest first, reduced to one BodyDay. Empty until loaded. */
export function bodyDays(): [string, BodyDay][] {
  const s = bodyMeasurements.value;
  if (s.state !== 'loaded') return [];
  if (dayCache?.rows === s.rows) return dayCache.days;
  const byDate = new Map<string, BodyMeasurementRow[]>();
  for (const r of s.rows) {
    if (!r.grpid || !r.date) continue;
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const days = [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, rs]) => [d, bodyDayOf(rs)] as [string, BodyDay]);
  dayCache = { rows: s.rows, days };
  return days;
}

type BodyDayField = 'weight_kg' | 'fat_ratio_pct' | 'systolic_mmhg' | 'diastolic_mmhg' | 'bp_count';

/** One BodyDay field as points: a day without it is omitted, a stored `0` kept. */
export function bodyDayPoints(field: BodyDayField, convert: (v: string) => number | null = parse): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const [date, day] of bodyDays()) {
    const v = convert(day[field]);
    if (v !== null) out.push({ date, value: v });
  }
  return out;
}

/** Whole numbers, e.g. bpm. */
export const formatWhole = (v: number): string => Math.round(v).toLocaleString('en-US');

// ── The registry ─────────────────────────────────────────────────────

export const RESTING_HR: TrendMetric = {
  id: 'resting_hr',
  label: 'Resting HR',
  unit: 'bpm',
  points: () => dailyHealthPoints('resting_hr'),
  format: formatWhole,
  band: true,
};

// ── Recovery (#243) ──────────────────────────────────────────────────
// `stress_avg` (#231) joins here as one entry once #236's mirror carries it.

export const HRV: TrendMetric = {
  id: 'hrv',
  label: 'HRV',
  unit: 'ms',
  points: () => dailyHealthPoints('hrv'),
  format: formatWhole,
  band: true,
};

const RECOVERY_METRICS: TrendMetric[] = [RESTING_HR, HRV];

// ── Sleep (#243) ─────────────────────────────────────────────────────
// Durations chart in hours (see sleep-duration.ts). Sleep is filed under its
// wake-up day, so today's night is complete: no `excludesToday`. Light and
// awake are not charted here; each field's blank stays blank on its own.

/** A DailyHealth seconds column as points in hours, so gridlines land on round hours. */
export function sleepPoints(field: DailyHealthField): TrendPoint[] {
  return dailyHealthPoints(field).map((p) => ({ date: p.date, value: p.value / 3600 }));
}

const sleepDuration = (id: string, label: string, field: DailyHealthField, band: boolean): TrendMetric => ({
  id,
  label,
  unit: '',
  points: () => sleepPoints(field),
  format: formatSleep,
  axisFormat: axisSleep,
  band,
});

export const SLEEP_TOTAL = sleepDuration('sleep_total', 'Total Sleep', 'sleep_total_s', true);
export const SLEEP_DEEP = sleepDuration('sleep_deep', 'Deep Sleep', 'sleep_deep_s', false);
export const SLEEP_REM = sleepDuration('sleep_rem', 'REM Sleep', 'sleep_rem_s', false);

export const SLEEP_SCORE: TrendMetric = {
  id: 'sleep_score',
  label: 'Sleep Score',
  unit: 'pts',
  points: () => dailyHealthPoints('sleep_score'),
  format: formatWhole,
  band: true,
};

const SLEEP_METRICS: TrendMetric[] = [SLEEP_TOTAL, SLEEP_DEEP, SLEEP_REM, SLEEP_SCORE];

// ── Fitness (#243) ───────────────────────────────────────────────────
// VO2max is a current-state snapshot recorded on few days: no band.

export const VO2MAX: TrendMetric = {
  id: 'vo2max',
  label: 'VO2max',
  unit: 'mL/kg/min',
  points: () => dailyHealthPoints('vo2max'),
  format: (v) => v.toFixed(1),
  band: false,
};

export const TRAINING_LOAD: TrendMetric = {
  id: 'training_load',
  label: 'Training Load',
  unit: '',
  points: () => dailyHealthPoints('training_load'),
  format: formatWhole,
  band: true,
};

const FITNESS_METRICS: TrendMetric[] = [VO2MAX, TRAINING_LOAD];

// ── Body (#244) ──────────────────────────────────────────────────────
// Stored kg, shown lb: the conversion is the consumer's (units.ts). One value
// a day, from the first weigh-in that had a weight; fat from that same one.

/** Decimals an axis needs for these ticks: whole when every tick is, else enough for the step. */
function axisDecimals(ticks: readonly number[]): number {
  if (ticks.every((t) => Number.isInteger(t))) return 0;
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  return step >= 0.1 ? 1 : 2;
}
const axisDecimal = (v: number, ticks: readonly number[]): string => v.toFixed(axisDecimals(ticks));

export const WEIGHT: TrendMetric = {
  id: 'weight',
  label: 'Weight',
  unit: 'lb',
  source: 'bodyMeasurements',
  points: () => bodyDayPoints('weight_kg', kgToLb),
  format: (v) => v.toFixed(1),
  axisFormat: axisDecimal,
  band: true,
  zeroBased: false,
};

export const BODY_FAT: TrendMetric = {
  id: 'body_fat',
  label: 'Body Fat',
  unit: '%',
  source: 'bodyMeasurements',
  points: () => bodyDayPoints('fat_ratio_pct'),
  format: (v) => v.toFixed(1),
  axisFormat: axisDecimal,
  band: true,
  zeroBased: false,
};

const BODY_METRICS: TrendMetric[] = [WEIGHT, BODY_FAT];

// ── Blood pressure (#244) ────────────────────────────────────────────
// Systolic and diastolic are two cards, not two series on one: each is the
// day's mean of its readings. The count is its own, unbanded card.

export const SYSTOLIC: TrendMetric = {
  id: 'systolic',
  label: 'Systolic',
  unit: 'mmHg',
  source: 'bodyMeasurements',
  points: () => bodyDayPoints('systolic_mmhg'),
  format: formatWhole,
  band: true,
  zeroBased: false,
};

export const DIASTOLIC: TrendMetric = {
  id: 'diastolic',
  label: 'Diastolic',
  unit: 'mmHg',
  source: 'bodyMeasurements',
  points: () => bodyDayPoints('diastolic_mmhg'),
  format: formatWhole,
  band: true,
  zeroBased: false,
};

export const BP_READINGS: TrendMetric = {
  id: 'bp_readings',
  label: 'BP Readings',
  unit: '',
  source: 'bodyMeasurements',
  points: () => bodyDayPoints('bp_count'),
  format: (v) => (v === 1 ? '1 reading' : `${Number.isInteger(v) ? v : v.toFixed(1)} readings`),
  axisFormat: axisDecimal,
  band: false,
  zeroBased: true,
};

const BLOOD_PRESSURE_METRICS: TrendMetric[] = [SYSTOLIC, DIASTOLIC, BP_READINGS];

/**
 * The groups, in switcher order. One entry per line: #244 and #245 append
 * their own (each with its own const above this array).
 */
export const TREND_GROUPS: TrendGroup[] = [
  { id: 'recovery', label: 'Recovery', metrics: RECOVERY_METRICS },
  { id: 'sleep', label: 'Sleep', metrics: SLEEP_METRICS },
  { id: 'fitness', label: 'Fitness', metrics: FITNESS_METRICS },
  { id: 'body', label: 'Body', metrics: BODY_METRICS },
  { id: 'blood_pressure', label: 'Blood Pressure', metrics: BLOOD_PRESSURE_METRICS },
];
