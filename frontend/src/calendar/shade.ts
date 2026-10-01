// #241 AC3 — shading the month grid by one health metric. Pure, apart from
// the two wrapped localStorage touches that remember the choice.
//
// Bins are quartiles of the values present across the shown month's own days
// (never the leading/trailing days of its neighbours), recomputed for every
// month: a heat map of where this month ran high or low, not a comparison with
// a personal baseline (that is `yourRange`, on the Day and Trends screens).

import { DAILY_HEALTH_FIELDS } from '../api/health-api';
import { activeMetrics, type HealthMetric } from '../components/day/health-rows';

export type ShadeKey = 'none' | 'sleep' | 'resting_hr' | 'hrv' | 'steps' | 'stress';
export type Bin = 1 | 2 | 3 | 4;

export interface ShadeChoice {
  key: ShadeKey;
  /** The button's word. */
  label: string;
  /** The metric, or null for Nothing. */
  metric: HealthMetric | null;
  /** The metric as it is spoken in a sentence: "resting HR". */
  spoken: string;
}

const SPOKEN: Record<string, string> = {
  sleep: 'sleep',
  resting_hr: 'resting HR',
  hrv: 'HRV',
  steps: 'steps',
  stress: 'average stress',
};

/**
 * The Shade-by buttons in order: Nothing, Sleep, Resting HR, HRV, Steps, and
 * Average stress sixth, only once `DAILY_HEALTH_FIELDS` includes `stress_avg`.
 */
export function shadeChoices(fields: readonly string[] = DAILY_HEALTH_FIELDS): ShadeChoice[] {
  const metrics = activeMetrics(fields);
  const ordered = [...metrics.filter((m) => m.key !== 'stress'), ...metrics.filter((m) => m.key === 'stress')];
  return [
    { key: 'none', label: 'Nothing', metric: null, spoken: '' },
    ...ordered.map((m) => ({ key: m.key as ShadeKey, label: m.label, metric: m, spoken: SPOKEN[m.key] })),
  ];
}

export const SHADE_STORAGE_KEY = 'thrive-calendar-shade';

/** The remembered choice, or `none` when missing, unrecognised or unreadable. */
export function readShade(choices: readonly ShadeChoice[] = shadeChoices()): ShadeKey {
  try {
    const v = localStorage.getItem(SHADE_STORAGE_KEY);
    const hit = choices.find((c) => c.key === v);
    return hit ? hit.key : 'none';
  } catch {
    return 'none';
  }
}

/** Remember a choice. Never throws: a failed write holds for this visit only. */
export function writeShade(key: ShadeKey): void {
  try {
    localStorage.setItem(SHADE_STORAGE_KEY, key);
  } catch {
    // Storage unavailable.
  }
}

/** The value at fraction `p` of sorted `xs`, interpolated linearly. */
function quantile(xs: readonly number[], p: number): number {
  const at = (xs.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return xs[lo] + (xs[hi] - xs[lo]) * (at - lo);
}

/** The three cut points (25th, 50th, 75th percentiles) of `values`, or null with none. */
export function quartiles(values: readonly number[]): [number, number, number] | null {
  if (values.length === 0) return null;
  const xs = [...values].sort((a, b) => a - b);
  return [quantile(xs, 0.25), quantile(xs, 0.5), quantile(xs, 0.75)];
}

/** Which of the four bins, low to high, `v` falls in. */
export function binOf(v: number, [q1, q2, q3]: readonly [number, number, number]): Bin {
  if (v <= q1) return 1;
  if (v <= q2) return 2;
  if (v <= q3) return 3;
  return 4;
}

export interface MonthShading {
  /** Bin per in-month date that has a value. A date absent here is not shaded. */
  bins: Record<string, Bin>;
  /** The lowest and highest in-month values, or null when the month has none. */
  low: number | null;
  high: number | null;
}

/** Shade `inMonth` dates from `series` (date → stored value). Other dates are ignored. */
export function shadeMonth(inMonth: readonly string[], series: ReadonlyMap<string, number>): MonthShading {
  const present = inMonth.filter((d) => series.has(d));
  const values = present.map((d) => series.get(d)!);
  const q = quartiles(values);
  const bins: Record<string, Bin> = {};
  if (q) for (const d of present) bins[d] = binOf(series.get(d)!, q);
  return {
    bins,
    low: values.length ? Math.min(...values) : null,
    high: values.length ? Math.max(...values) : null,
  };
}

/** A stored value in the metric's own words: "7h 12m", "52 bpm", "9,412". */
export function formatValue(metric: HealthMetric, stored: number): string {
  return `${metric.format(metric.toDisplay(stored))}${metric.unit}`;
}

/**
 * The metric's clause for a day, as the cell's accessible name and the
 * summary say it: "resting HR 52 bpm", "steps 9,412", or "no resting HR".
 */
export function metricWords(choice: ShadeChoice, stored: number | undefined): string {
  if (!choice.metric) return '';
  return stored === undefined ? `no ${choice.spoken}` : `${choice.spoken} ${formatValue(choice.metric, stored)}`;
}
