// #239 — the Health panel's rules: which rows, what each says, and how each
// compares with your range. Pure: rows in, a view out; health-panel.tsx only
// draws it.
//
// The range comparison is decided on the DISPLAYED numbers: the value and
// both bounds are rounded to the metric's display precision before `zoneOf`,
// so the words can never contradict the numbers beside them.

import { DAILY_HEALTH_FIELDS, type DailyHealthRow } from '../../api/health-api';
import { parse } from '../../api/units';
import { yourRange, valuesInWindow, zoneOf, YOUR_RANGE_MIN_VALUES, type Unwelcome, type Zone } from '../../api/your-range';
import { clock12, hoursMinutes, nightOf, syncTime, syncedLabel } from '../../day/format';

export type HealthMetricKey = 'sleep' | 'resting_hr' | 'hrv' | 'stress' | 'steps';

export interface HealthMetric {
  key: HealthMetricKey;
  /** The DailyHealth column. `stress_avg` arrives with #231. */
  field: string;
  label: string;
  unwelcome: Unwelcome;
  /** A stored value in display units, rounded to display precision (sleep: whole minutes). */
  toDisplay(stored: number): number;
  /** A display-unit number as text, without its unit: "7h 12m", "52", "9,412". */
  format(display: number): string;
  /** Appended after the number or range: " bpm", " ms", or nothing. */
  unit: string;
  /** Today's value is a day in progress ("so far", no range line). */
  inProgressToday: boolean;
}

const whole = (n: number) => Math.round(n);

/** Every metric the panel can show, in order. Stress only once #231 adds `stress_avg`. */
export const HEALTH_METRICS: readonly HealthMetric[] = [
  {
    key: 'sleep', field: 'sleep_total_s', label: 'Sleep', unwelcome: 'below',
    toDisplay: (s) => Math.round(s / 60), format: (min) => hoursMinutes(min * 60), unit: '',
    inProgressToday: false,
  },
  {
    key: 'resting_hr', field: 'resting_hr', label: 'Resting HR', unwelcome: 'above',
    toDisplay: whole, format: String, unit: ' bpm', inProgressToday: false,
  },
  {
    key: 'hrv', field: 'hrv', label: 'HRV', unwelcome: 'below',
    toDisplay: whole, format: String, unit: ' ms', inProgressToday: false,
  },
  {
    key: 'stress', field: 'stress_avg', label: 'Average stress', unwelcome: 'above',
    toDisplay: whole, format: String, unit: '', inProgressToday: true,
  },
  {
    key: 'steps', field: 'steps', label: 'Steps', unwelcome: null,
    toDisplay: whole, format: (n) => n.toLocaleString('en-US'), unit: '', inProgressToday: true,
  },
];

/** The metrics whose column the frontend reads: stress appears when `DAILY_HEALTH_FIELDS` gains `stress_avg`. */
export function activeMetrics(fields: readonly string[] = DAILY_HEALTH_FIELDS): HealthMetric[] {
  return HEALTH_METRICS.filter((m) => fields.includes(m.field));
}

export type HealthCaption =
  | { kind: 'text'; text: string }
  | { kind: 'stages'; items: string[] }
  | { kind: 'range'; bounds: string; zone: Zone; attention: boolean }
  | { kind: 'building'; n: number };

export interface HealthRowView {
  key: HealthMetricKey;
  label: string;
  /** Shown after the label: "Fri night", "last night". */
  qualifier?: string;
  /** '' for a blank, shown as "—". */
  value: string;
  captions: HealthCaption[];
}

export type HealthView =
  | { kind: 'note'; sub?: string; note: string }
  | { kind: 'rows'; sub?: string; rows: HealthRowView[] };

const cell = (row: DailyHealthRow, field: string): string => (row as unknown as Record<string, string>)[field] ?? '';

/** A metric's history as date → stored number, blanks left out and `'0'` kept. */
export function seriesOf(rows: readonly DailyHealthRow[], field: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = parse(cell(r, field));
    if (v !== null && r.date) m.set(r.date, v);
  }
  return m;
}

/** The range line for a value on `date`, or the "building" line with fewer than 14 values. */
export function rangeCaption(metric: HealthMetric, stored: number, series: ReadonlyMap<string, number>, date: string): HealthCaption {
  const range = yourRange(series, date);
  if (!range) return { kind: 'building', n: valuesInWindow(series, date) };
  const lo = metric.toDisplay(range.lo);
  const hi = metric.toDisplay(range.hi);
  const { zone, attention } = zoneOf(metric.toDisplay(stored), { lo, hi }, metric.unwelcome);
  const bounds = lo === hi ? metric.format(lo) : `${metric.format(lo)}–${metric.format(hi)}`;
  return { kind: 'range', bounds: `${bounds}${metric.unit}`, zone, attention };
}

/** A caption as the words it shows (the arrow is drawn separately). */
export function captionText(c: HealthCaption): string {
  switch (c.kind) {
    case 'text': return c.text;
    case 'stages': return c.items.join(' · ');
    case 'building': return `Building your range — ${c.n} of ${YOUR_RANGE_MIN_VALUES} days so far.`;
    case 'range':
      return c.zone === 'within'
        ? `Your range ${c.bounds} · in range`
        : `Your range ${c.bounds} · ${c.zone} your range`;
  }
}

const STAGES: readonly [string, string][] = [
  ['sleep_deep_s', 'Deep'],
  ['sleep_light_s', 'Light'],
  ['sleep_rem_s', 'REM'],
  ['sleep_awake_s', 'Awake'],
];

function sleepCaptions(row: DailyHealthRow): HealthCaption[] {
  const out: HealthCaption[] = [];
  const items = STAGES.flatMap(([f, name]) => {
    const v = parse(cell(row, f));
    return v === null ? [] : [`${name} ${hoursMinutes(v)}`];
  });
  if (items.length) out.push({ kind: 'stages', items });
  const bed = clock12(row.bed_time);
  const wake = clock12(row.wake_time);
  if (bed && wake) out.push({ kind: 'text', text: `${bed} – ${wake}` });
  return out;
}

/**
 * The Health panel for `date`, from every loaded DailyHealth row (any order).
 * Only past and today: the panel never mounts on a future day.
 */
export function healthView(rows: readonly DailyHealthRow[], date: string, isToday: boolean, fields: readonly string[] = DAILY_HEALTH_FIELDS): HealthView {
  const row = rows.find((r) => r.date === date);
  if (!row) {
    return isToday
      ? { kind: 'note', sub: 'Not synced yet today', note: "Last night's sleep and heart rate, and today's steps, arrive with the next sync." }
      : { kind: 'note', note: 'No watch data for this day.' };
  }

  const synced = isToday ? syncTime(row.synced_at, date) : '';
  const view: HealthRowView[] = activeMetrics(fields).map((metric) => {
    const stored = parse(cell(row, metric.field));
    const base = {
      key: metric.key,
      label: metric.label,
      qualifier: metric.key === 'sleep' ? nightOf(date, isToday) : undefined,
    };
    if (stored === null) {
      return { ...base, value: '', captions: [{ kind: 'text', text: isToday ? 'Arrives with the next sync.' : 'No reading this day.' }] };
    }
    const shown = `${metric.format(metric.toDisplay(stored))}${metric.unit}`;
    const captions: HealthCaption[] = metric.key === 'sleep' ? sleepCaptions(row) : [];
    if (isToday && metric.inProgressToday) {
      if (metric.key === 'steps' && synced) captions.push({ kind: 'text', text: `As of the ${synced} sync` });
      return { ...base, value: `${shown} so far`, captions };
    }
    captions.push(rangeCaption(metric, stored, seriesOf(rows, metric.field), date));
    return { ...base, value: shown, captions };
  });

  const sub = isToday ? syncedLabel(row.synced_at, date) || undefined : undefined;
  return { kind: 'rows', sub, rows: view };
}
