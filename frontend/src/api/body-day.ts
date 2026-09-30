// #239 AC4 — one day's BodyMeasurements readings, reduced for the Day view.
//
// A MIRROR of `summarizeBodyDay` in apps-script/src/daily-summary.js (#203),
// which writes DailySummary U:Y. Change both together; body-day.test.ts runs
// the same fixtures as that file's tests, and health-demo checks the demo
// DailySummary agrees with this on every demo day. The Day view reads the
// readings rather than DailySummary because it needs the weigh-in's time and
// the BP readings' count and times, and DailySummary may be stale.
//
//  - Weight and body fat come from the day's FIRST scale reading that has a
//    weight, by `measured_at_utc` parsed as an instant. Body fat is that
//    reading's own `fat_ratio_pct`, never taken from another reading.
//  - Blood pressure is the mean of the day's `bp` readings, systolic and
//    diastolic each over the readings that have it, rounded half up to whole
//    mmHg. The count is of readings, not of values.
//
// Pure: pass one day's readings (any order).

import type { BodyMeasurementRow } from './health-api';

export interface BodyDay {
  /** The first scale reading with a weight, or null. */
  weighIn: BodyMeasurementRow | null;
  /** DailySummary U: kg as stored, '' when no weigh-in. */
  weight_kg: string;
  /** DailySummary V: from the weigh-in only, '' when it had none. */
  fat_ratio_pct: string;
  /** DailySummary W and X: whole mmHg as text, '' when no reading had it. */
  systolic_mmhg: string;
  diastolic_mmhg: string;
  /** DailySummary Y: the BP readings, '' when none. */
  bp_count: string;
  /** The day's BP readings, oldest first. */
  bp: BodyMeasurementRow[];
}

function instant(m: BodyMeasurementRow): number {
  const t = Date.parse(m.measured_at_utc);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

const byInstant = (a: BodyMeasurementRow, b: BodyMeasurementRow) => {
  const ta = instant(a);
  const tb = instant(b);
  return ta === tb ? 0 : ta < tb ? -1 : 1;
};

/** Round half up — Math.floor(n + 0.5), as daily-summary.js's `roundHalfUp`. */
function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

function meanHalfUp(rows: BodyMeasurementRow[], field: 'systolic_mmhg' | 'diastolic_mmhg'): string {
  const vals = rows.filter((r) => r[field] !== '').map((r) => Number(r[field]));
  return vals.length ? String(roundHalfUp(vals.reduce((a, b) => a + b, 0) / vals.length)) : '';
}

export function bodyDayOf(readings: readonly BodyMeasurementRow[]): BodyDay {
  const weighIn = readings
    .filter((r) => r.kind === 'scale' && r.weight_kg !== '')
    .sort(byInstant)[0] ?? null;
  const bp = readings.filter((r) => r.kind === 'bp').sort(byInstant);
  return {
    weighIn,
    weight_kg: weighIn?.weight_kg ?? '',
    fat_ratio_pct: weighIn?.fat_ratio_pct ?? '',
    systolic_mmhg: meanHalfUp(bp, 'systolic_mmhg'),
    diastolic_mmhg: meanHalfUp(bp, 'diastolic_mmhg'),
    bp_count: bp.length ? String(bp.length) : '',
    bp,
  };
}
