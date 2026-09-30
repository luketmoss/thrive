// #242 AC2 — the pure series maths behind every Trends chart and table.

import { describe, it, expect } from 'vitest';
import {
  addDays, averageDays, dateTicks, datesBetween, earliestDate, metricSeries, niceTicks,
  rangeBounds, rolling, rowDate, segments, tickLabel, windowText, yDomain,
} from './series';
import type { TrendMetric, TrendPoint } from './metrics';

const TODAY = '2026-09-27';

describe('rangeBounds', () => {
  it.each([
    ['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365],
  ] as const)('%s covers %i days ending today, inclusive', (range, n) => {
    const { from, to } = rangeBounds(range, TODAY, null);
    expect(to).toBe(TODAY);
    expect(datesBetween(from, to)).toHaveLength(n);
  });

  it('All starts at the earliest date with a value', () => {
    expect(rangeBounds('All', TODAY, '2024-03-01')).toEqual({ from: '2024-03-01', to: TODAY });
  });

  it('All falls back to 1M when there is no value', () => {
    expect(rangeBounds('All', TODAY, null)).toEqual(rangeBounds('1M', TODAY, null));
  });

  it('earliestDate looks across every metric', () => {
    expect(earliestDate([[{ date: '2026-02-01', value: 1 }], [{ date: '2025-12-31', value: 0 }], []])).toBe('2025-12-31');
    expect(earliestDate([[], []])).toBeNull();
  });
});

describe('averageDays', () => {
  it('maps the options to windows', () => {
    expect(['Off', '7d', '14d', '30d'].map((a) => averageDays(a as never))).toEqual([0, 7, 14, 30]);
  });
});

describe('rolling', () => {
  const dates = datesBetween('2026-09-01', '2026-09-10');

  it('is the trailing N-day mean of the day and the N − 1 before it', () => {
    const v = new Map(dates.map((d, i) => [d, i + 1])); // 1..10
    const avg = rolling(v, dates, 3);
    expect(avg.get('2026-09-10')).toBe(9); // 8, 9, 10
    expect(avg.get('2026-09-03')).toBe(2);
  });

  it('reaches back before the range', () => {
    const v = new Map([['2026-08-31', 10], ['2026-09-01', 20]]);
    expect(rolling(v, ['2026-09-01'], 2).get('2026-09-01')).toBe(15);
  });

  it('needs a value on the day itself', () => {
    const v = new Map([['2026-09-01', 1], ['2026-09-02', 1]]);
    expect(rolling(v, ['2026-09-03'], 3).has('2026-09-03')).toBe(false);
  });

  it('needs at least ⌈N/2⌉ values in the window', () => {
    // N = 7 needs 4.
    const three = new Map([['2026-09-10', 5], ['2026-09-08', 5], ['2026-09-06', 5]]);
    expect(rolling(three, ['2026-09-10'], 7).has('2026-09-10')).toBe(false);
    three.set('2026-09-04', 9);
    expect(rolling(three, ['2026-09-10'], 7).get('2026-09-10')).toBe(6);
  });

  it('counts a 0 and never fills a blank', () => {
    const v = new Map([['2026-09-01', 0], ['2026-09-02', 4]]);
    expect(rolling(v, ['2026-09-02'], 2).get('2026-09-02')).toBe(2);
    expect(rolling(v, dates, 0).size).toBe(0);
  });
});

describe('segments', () => {
  it('breaks the line at any day without a point', () => {
    const pts = ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-09']
      .map((date) => ({ date, value: 1 }));
    expect(segments(pts).map((s) => s.map((p) => p.date.slice(-2)))).toEqual([
      ['01', '02'], ['04', '05', '06'], ['09'],
    ]);
  });

  it('sorts first and joins across a month end', () => {
    const pts = [{ date: '2026-10-01', value: 1 }, { date: '2026-09-30', value: 1 }];
    expect(segments(pts)).toHaveLength(1);
  });
});

describe('niceTicks and yDomain', () => {
  it('gives about four round gridlines covering the span', () => {
    const t = niceTicks(47.3, 58.1);
    expect(t[0]).toBeLessThanOrEqual(47.3);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(58.1);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(7);
    for (const v of t) expect(Number.isInteger(v * 2) || Number.isInteger(v)).toBe(true);
  });

  it('uses 1, 2 or 5 steps, and labels them to the step precision', () => {
    for (const [lo, hi] of [[47.3, 58.1], [0.2, 1.7], [4000, 11000]]) {
      const t = niceTicks(lo, hi);
      const step = t[1] - t[0];
      const mant = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mant * 1000) / 1000);
    }
    expect(tickLabel(52.5, [50, 52.5])).toBe('53'); // guarded: 2.5 steps are never produced
    expect(tickLabel(0.5, [0, 0.5, 1])).toBe('0.5');
    expect(tickLabel(1, [0, 0.5, 1])).toBe('1.0');
    expect(tickLabel(10000, [0, 5000, 10000])).toBe('10,000');
  });

  it('copes with a flat series', () => {
    expect(niceTicks(50, 50).length).toBeGreaterThanOrEqual(2);
  });

  it('covers the values and the band, and zeroBased starts at 0', () => {
    const d = yDomain([50, 55], { lo: 44, hi: 60 });
    expect(d.min).toBeLessThanOrEqual(44);
    expect(d.max).toBeGreaterThanOrEqual(60);
    expect(yDomain([5000, 9000], null, true).min).toBe(0);
  });
});

describe('dates', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('rowDate shows the year only when it is not this year', () => {
    expect(rowDate('2026-09-26', TODAY)).toBe('Sat, Sep 26');
    expect(rowDate('2025-12-31', TODAY)).toBe('Wed, Dec 31, 2025');
  });

  it('windowText dates the band', () => {
    expect(windowText('2026-08-28', '2026-09-26', TODAY)).toBe('(Aug 28 – Sep 26)');
  });
});

describe('dateTicks', () => {
  const WIDTH_375 = 375 - 32 - 32 - 40 - 6; // screen and card padding, axis gutter

  /** Rough label boxes never overlap, at the 375 px plot width. */
  function noOverlap(from: string, to: string) {
    const ticks = dateTicks(from, to, WIDTH_375);
    const all = datesBetween(from, to);
    const px = WIDTH_375 / all.length;
    const boxes = ticks.map((t) => {
      const cx = (all.indexOf(t.date) + 0.5) * px;
      const w = t.label.length * 6.5;
      return [cx - w / 2, cx + w / 2];
    });
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThan(boxes[i - 1][1]);
    return ticks;
  }

  it('uses weekdays for 1W', () => {
    const t = noOverlap(...Object.values(rangeBounds('1W', TODAY, null)) as [string, string]);
    expect(t.every((x) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/.test(x.label))).toBe(true);
  });

  it('uses dates for 1M, always labelling today', () => {
    const t = noOverlap(...Object.values(rangeBounds('1M', TODAY, null)) as [string, string]);
    expect(t.every((x) => /^[A-Z][a-z]{2} \d+$/.test(x.label))).toBe(true);
    expect(t[t.length - 1].date).toBe(TODAY);
  });

  it.each(['3M', '6M', '1Y'] as const)('uses months for %s, without overlap', (r) => {
    const t = noOverlap(...Object.values(rangeBounds(r, TODAY, null)) as [string, string]);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.every((x) => /^([A-Z][a-z]{2}|\d{4})$/.test(x.label))).toBe(true);
  });

  it('keeps January, labelled with its year, when months are thinned', () => {
    const t = dateTicks(...Object.values(rangeBounds('1Y', TODAY, null)) as [string, string], WIDTH_375);
    expect(t.map((x) => x.label)).toContain('2026');
  });

  it('uses years for a long All, without overlap', () => {
    const t = noOverlap('2020-02-10', TODAY);
    expect(t.every((x) => /^\d{4}$/.test(x.label))).toBe(true);
  });
});

describe('metricSeries', () => {
  const metric = (pts: TrendPoint[], extra: Partial<TrendMetric> = {}): TrendMetric => ({
    id: 'm', label: 'M', unit: 'u', points: () => pts, format: String, band: true, ...extra,
  });

  it('keeps the range whole, and counts coverage and the mean over values only', () => {
    const pts = [{ date: TODAY, value: 0 }, { date: addDays(TODAY, -2), value: 6 }, { date: '2020-01-01', value: 99 }];
    const s = metricSeries(metric(pts), addDays(TODAY, -6), TODAY, 0, TODAY);
    expect(s.dates).toHaveLength(7);
    expect(s.points.map((p) => p.value)).toEqual([6, 0]);
    expect(s.covered).toBe(2);
    expect(s.mean).toBe(3);
    expect(s.band).toBeNull(); // too few values
  });

  it('drops today when the metric excludes it', () => {
    const s = metricSeries(metric([{ date: TODAY, value: 5 }], { excludesToday: true }), addDays(TODAY, -6), TODAY, 0, TODAY);
    expect(s.points).toHaveLength(0);
  });
});
