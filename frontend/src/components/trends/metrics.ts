// The Trends metric registry (#242) — the contract #243–#246 plug into.
//
// A metric says where its daily values come from and how to print them; the
// chart, the table, the averages and "your range" are the same for every one.
// Adding a metric is one entry in TREND_GROUPS, with no chart change.

import { dailyHealth } from '../../state/store';
import type { DailyHealthField } from '../../api/health-api';
import { parse } from '../../api/units';
import { formatSleep, axisSleep } from './sleep-duration';

export interface TrendPoint {
  date: string;
  value: number;
  /** A sentence for the table; the chart draws the day as a hollow dot (#245's coverage). */
  partial?: string;
}

export interface TrendMetric {
  id: string;
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

/**
 * The groups, in switcher order. One entry per line: #244 and #245 append
 * their own (each with its own const above this array).
 */
export const TREND_GROUPS: TrendGroup[] = [
  { id: 'recovery', label: 'Recovery', metrics: RECOVERY_METRICS },
  { id: 'sleep', label: 'Sleep', metrics: SLEEP_METRICS },
  { id: 'fitness', label: 'Fitness', metrics: FITNESS_METRICS },
];
