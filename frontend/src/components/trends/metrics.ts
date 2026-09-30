// The Trends metric registry (#242) — the contract #243–#246 plug into.
//
// A metric says where its daily values come from and how to print them; the
// chart, the table, the averages and "your range" are the same for every one.
// Adding a metric is one entry in TREND_GROUPS, with no chart change.

import { dailyHealth } from '../../state/store';
import type { DailyHealthField } from '../../api/health-api';
import { parse } from '../../api/units';

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
  axisFormat?(v: number): string;
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
    const v = parse(row[field]);
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

/**
 * The groups, in switcher order. T1 ships one provisional group; #243 adds
 * the switcher when there are two.
 */
export const TREND_GROUPS: TrendGroup[] = [
  { id: 'heart', label: 'Heart', metrics: [RESTING_HR] },
];
