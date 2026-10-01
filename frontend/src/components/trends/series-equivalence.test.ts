// #270 AC1, AC4, AC5, AC6 (unit) — the series is the same series it always was,
// built without a Date per window day, from one copy of the day arithmetic.

import { describe, it, expect, afterEach } from 'vitest';
import {
  AVERAGES, RANGES, averageDays, datesBetween, earliestDate, metricSeries, rangeBounds, rolling, usablePoints,
} from './series';
import { addDays, dayNumber } from '../../day/dates';
import { yourRange } from '../../api/your-range';
import type { TrendMetric, TrendPoint } from './metrics';

const TODAY = '2026-09-27';

// ── The references: what shipped before #270 ─────────────────────────

const MS = 86_400_000;
const oldDayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / MS);
const oldAddDays = (ymd: string, days: number) => new Date((oldDayNumber(ymd) + days) * MS).toISOString().slice(0, 10);

/** `rolling` as it was: a date string looked up for every day of every window. */
function refRolling(values: ReadonlyMap<string, number>, dates: readonly string[], n: number): Map<string, number> {
  const out = new Map<string, number>();
  if (n <= 0) return out;
  const need = Math.ceil(n / 2);
  for (const d of dates) {
    if (!values.has(d)) continue;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const v = values.get(oldAddDays(d, -i));
      if (v !== undefined) {
        sum += v;
        count++;
      }
    }
    if (count >= need) out.set(d, sum / count);
  }
  return out;
}

/** metricSeries as it was, around `refRolling`. */
function refSeries(metric: TrendMetric, from: string, to: string, avgDays: number, today: string, pts: readonly TrendPoint[]) {
  const usable = metric.excludesToday ? pts.filter((p) => p.date !== today) : pts;
  const all = new Map(usable.map((p) => [p.date, p.value]));
  const dates: string[] = [];
  for (let n = oldDayNumber(from), end = oldDayNumber(to); n <= end; n++) dates.push(new Date(n * MS).toISOString().slice(0, 10));
  const points = usable
    .filter((p) => p.date >= from && p.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const mean = points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : null;
  return {
    dates, all, points, average: refRolling(all, dates, avgDays), mean, covered: points.length,
    band: metric.band ? yourRange(all, today) : null,
  };
}

/** A small seeded generator, so a failure reproduces. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sameBits = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => {
  expect([...a.keys()]).toEqual([...b.keys()]);
  for (const [k, v] of a) expect(Object.is(v, b.get(k))).toBe(true);
};

describe('AC1: the series equals what it was', () => {
  it('matches the date-string reference over seeded random fixtures', () => {
    const rnd = mulberry32(270);
    for (let trial = 0; trial < 300; trial++) {
      const span = 1 + Math.floor(rnd() * 900);
      const density = [0.05, 0.3, 0.7, 1][Math.floor(rnd() * 4)];
      const pts: TrendPoint[] = [];
      for (let i = 0; i < span; i++) {
        if (rnd() > density) continue;
        const roll = rnd();
        const value = roll < 0.1 ? 0 : roll < 0.5 ? Math.round(rnd() * 100) : rnd() * 100;
        const p: TrendPoint = { date: addDays(TODAY, -i), value };
        if (rnd() < 0.05) p.partial = 'partial day';
        pts.push(p);
      }
      // Source order is not date order.
      pts.sort(() => rnd() - 0.5);
      const metric: TrendMetric = {
        id: 'm', label: 'M', unit: 'u', points: () => pts, format: String,
        band: rnd() < 0.5, excludesToday: rnd() < 0.5,
      };
      const range = RANGES[Math.floor(rnd() * RANGES.length)];
      const avgKey = AVERAGES[Math.floor(rnd() * AVERAGES.length)];
      const avg = averageDays(avgKey);
      const { from, to } = rangeBounds(range, TODAY, earliestDate([pts]));
      const got = metricSeries(metric, from, to, avg, TODAY);
      const want = refSeries(metric, from, to, avg, TODAY, pts);
      const where = `trial ${trial} ${range} ${avgKey}`;
      expect(got.dates, where).toEqual(want.dates);
      sameBits(got.all, want.all);
      expect(got.points, where).toEqual(want.points);
      sameBits(got.average, want.average);
      expect(got.mean === want.mean || (got.mean !== null && Object.is(got.mean, want.mean)), where).toBe(true);
      expect(got.covered).toBe(want.covered);
      expect(got.band, where).toEqual(want.band);
    }
  });

  it('rolling matches the reference for non-consecutive dates and windows reaching before the first', () => {
    const rnd = mulberry32(2700);
    for (let trial = 0; trial < 300; trial++) {
      const values = new Map<string, number>();
      for (let i = 0; i < 120; i++) if (rnd() < 0.5) values.set(addDays('2026-01-01', i), rnd() < 0.1 ? 0 : rnd() * 50);
      const dates: string[] = [];
      for (let i = 0; i < 140; i++) if (rnd() < 0.6) dates.push(addDays('2025-12-20', i));
      for (const n of [1, 2, 7, 14, 30, 45]) sameBits(rolling(values, dates, n), refRolling(values, dates, n));
    }
  });

  it('keeps the newest-to-oldest sum: a constant 45.3 averages as it always did', () => {
    const dates = datesBetween('2026-09-01', '2026-09-07');
    const values = new Map(dates.map((d) => [d, 45.3]));
    const got = rolling(values, dates, 7).get('2026-09-07');
    expect(got).toBe(refRolling(values, dates, 7).get('2026-09-07'));
    expect(got).toBe(45.300000000000004);
  });

  it('is empty for no dates, and for an Off average', () => {
    expect(rolling(new Map([['2026-09-01', 1]]), [], 7).size).toBe(0);
    expect(rolling(new Map([['2026-09-01', 1]]), ['2026-09-01'], 0).size).toBe(0);
  });
});

describe('AC4: rolling allocates nothing per window day', () => {
  const RealDate = Date;
  afterEach(() => { globalThis.Date = RealDate; });

  it('builds All (2,300 days) with a 30-day average with no more Dates than datesBetween makes', () => {
    const from = addDays(TODAY, -2299);
    const pts = datesBetween(from, TODAY).map((d, i) => ({ date: d, value: 40 + (i % 17) }));
    const metric: TrendMetric = { id: 'm', label: 'M', unit: 'u', points: () => pts, format: String, band: false };
    let made = 0;
    globalThis.Date = new Proxy(RealDate, {
      construct(target, args) {
        made++;
        return Reflect.construct(target, args);
      },
    });
    const s = metricSeries(metric, from, TODAY, 30, TODAY, pts);
    globalThis.Date = RealDate;
    expect(s.dates).toHaveLength(2300);
    expect(s.average.size).toBeGreaterThan(2200);
    // datesBetween makes one per day; the 30-day windows (~70,000 lookups) make none.
    expect(made).toBeLessThanOrEqual(s.dates.length);
  });
});

describe('AC5: one copy of the day arithmetic', () => {
  it('agrees with the old implementations for every day from 1970-01-01 to 2100-12-31', () => {
    const start = Date.UTC(1970, 0, 1) / MS;
    const end = Date.UTC(2100, 11, 31) / MS;
    for (let n = start; n <= end; n++) {
      const ymd = new Date(n * MS).toISOString().slice(0, 10);
      if (dayNumber(ymd) !== oldDayNumber(ymd)) throw new Error(`dayNumber differs on ${ymd}`);
      for (const k of [-30, -1, 1, 45]) {
        if (addDays(ymd, k) !== oldAddDays(ymd, k)) throw new Error(`addDays differs on ${ymd} ${k}`);
      }
    }
  });
});

describe('AC6: All starts from what is drawn', () => {
  const steps: TrendMetric = {
    id: 'steps', label: 'Steps', unit: 'steps', points: () => [], format: String, band: true, excludesToday: true,
  };
  const other: TrendMetric = { id: 'o', label: 'O', unit: '', points: () => [], format: String, band: false };
  const earliestOf = (m: TrendMetric, pts: TrendPoint[]) => earliestDate([usablePoints(m, pts, TODAY)]);

  it('an excludesToday metric whose only value is today has no earliest date, so All is 1M', () => {
    const e = earliestOf(steps, [{ date: TODAY, value: 900 }]);
    expect(e).toBeNull();
    expect(rangeBounds('All', TODAY, e)).toEqual(rangeBounds('1M', TODAY, null));
  });

  it('stays null in a group where every other metric is empty', () => {
    expect(earliestDate([usablePoints(steps, [{ date: TODAY, value: 1 }], TODAY), usablePoints(other, [], TODAY)])).toBeNull();
  });

  it('keeps an older real value, and today for a metric that does not exclude it', () => {
    expect(earliestOf(steps, [{ date: TODAY, value: 9 }, { date: '2026-01-05', value: 3 }])).toBe('2026-01-05');
    expect(earliestOf(other, [{ date: TODAY, value: 9 }])).toBe(TODAY);
  });
});
