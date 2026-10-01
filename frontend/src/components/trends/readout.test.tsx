// #247 AC2 — one formatter for the table's row and the chart's readout.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { announceText, dayCells, pointsByDate, readoutLine, readoutDate, valueText } from './readout';
import { TrendTable } from './trend-table';
import { TrendCard } from './trend-chart';
import { addDays, dayAtX, dayIndexAtX, metricSeries, rangeBounds, datesBetween } from './series';
import type { TrendGroup, TrendMetric, TrendPoint } from './metrics';

afterEach(cleanup);

const TODAY = '2026-09-27';
const fmt = (v: number) => String(Math.round(v));

function metric(pts: TrendPoint[], extra: Partial<TrendMetric> = {}): TrendMetric {
  return { id: 'resting_hr', label: 'Resting HR', unit: 'bpm', points: () => pts, format: fmt, band: false, ...extra };
}

const pts: TrendPoint[] = [];
for (let i = 40; i >= 0; i--) if (i !== 2) pts.push({ date: addDays(TODAY, -i), value: 50 + (i % 3) });
pts[pts.length - 1] = { ...pts[pts.length - 1], partial: 'partial day' };

const { from, to } = rangeBounds('1W', TODAY, null);

describe('dayCells and the readout line', () => {
  const m = metric(pts);
  const s = metricSeries(m, from, to, 7, TODAY);
  const by = pointsByDate(s);

  it('writes value, then average, with the unit', () => {
    const d = addDays(TODAY, -1);
    const c = dayCells(m, s, by, d, 7);
    expect(readoutLine(m, c, 7)).toBe(`${fmt(s.all.get(d)!)} bpm · 7-day avg ${fmt(s.average.get(d)!)} bpm`);
  });

  it('reads — for a blank day, never 0, and no unit beside it', () => {
    const d = addDays(TODAY, -2);
    const c = dayCells(m, s, by, d, 7);
    expect(c.value).toBe('—');
    expect(valueText(m, c)).toBe('—');
    expect(readoutLine(m, c, 7)).toBe('— · 7-day avg —');
  });

  it('omits the average when it is Off', () => {
    const c = dayCells(m, metricSeries(m, from, to, 0, TODAY), by, addDays(TODAY, -1), 0);
    expect(c.average).toBeNull();
    expect(readoutLine(m, c, 0)).toMatch(/^\d+ bpm$/);
  });

  it('adds the partial sentence', () => {
    const c = dayCells(m, s, by, TODAY, 7);
    expect(readoutLine(m, c, 7)).toContain('bpm partial day');
  });

  it('dates the way the table row header does', () => {
    expect(readoutDate('2026-08-28', TODAY)).toBe('Fri, Aug 28');
    expect(readoutDate('2025-08-28', TODAY)).toBe('Thu, Aug 28, 2025');
  });
});

describe('the table and the readout agree', () => {
  it.each([[7], [0]])('for every day with the average at %i', (avgDays) => {
    const m = metric(pts);
    const group: TrendGroup = { id: 'g', label: 'Heart', metrics: [m] };
    const table = render(h(TrendTable, { group, from, to, range: '1W', avgDays, today: TODAY }));
    const rows = [...table.container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      const rowHead = row.querySelector('th a')!.firstChild!.textContent!;
      const date = datesBetween(from, to).find((d) => readoutDate(d, TODAY) === rowHead)!;
      const cells = [...row.querySelectorAll('td')].map((td) => td.textContent!.trim());
      const card = render(h(TrendCard, { metric: m, from, to, range: '1W', avgDays, today: TODAY, selectedDate: date }));
      const lines = card.container.querySelectorAll('.trend-readout p');
      expect(lines[0].textContent).toBe(rowHead);
      const value = lines[1].textContent!;
      // The table's value cell has the number then any partial sentence; the readout adds the unit.
      const num = cells[0].split(' ')[0];
      expect(value.startsWith(num === '—' ? '—' : `${num} bpm`)).toBe(true);
      if (avgDays > 0) expect(value.endsWith(`7-day avg ${cells[1] === '—' ? '—' : `${cells[1]} bpm`}`)).toBe(true);
      else expect(value).not.toContain('avg');
      card.unmount();
    }
  });
});

describe('announceText', () => {
  it('says the date, then every card in order', () => {
    const a = metric(pts);
    const b = metric([], { id: 'hrv', label: 'HRV', unit: '' });
    const parts = [a, b].map((mm) => ({ metric: mm, series: metricSeries(mm, from, to, 7, TODAY) }));
    const d = addDays(TODAY, -1);
    const s = parts[0].series;
    expect(announceText(d, TODAY, parts, 7)).toBe(
      `${readoutDate(d, TODAY)}. Resting HR ${fmt(s.all.get(d)!)} bpm, 7-day avg ${fmt(s.average.get(d)!)} bpm. HRV —, 7-day avg —.`,
    );
  });
});

describe('dayAtX', () => {
  const dates = datesBetween('2026-09-21', '2026-09-27'); // 1W: 7 days
  const PAD = 40;
  const W = 280;
  const slot = W / 7;
  it('picks the day whose slot holds x', () => {
    for (let i = 0; i < 7; i++) {
      expect(dayAtX(dates, PAD + (i + 0.5) * slot, PAD, W)).toBe(dates[i]);
      expect(dayAtX(dates, PAD + (i + 0.49) * slot, PAD, W)).toBe(dates[i]);
    }
    expect(dayAtX(dates, PAD + 1 * slot - 0.1, PAD, W)).toBe(dates[0]);
    expect(dayAtX(dates, PAD + 1 * slot + 0.1, PAD, W)).toBe(dates[1]);
  });
  it('clamps to the first and last day', () => {
    expect(dayAtX(dates, -50, PAD, W)).toBe(dates[0]);
    expect(dayAtX(dates, 5, PAD, W)).toBe(dates[0]);
    expect(dayAtX(dates, 9999, PAD, W)).toBe(dates[6]);
  });
  it('holds at 1Y, where a pixel is more than a day', () => {
    const w = 260;
    expect(dayIndexAtX(PAD, 365, PAD, w)).toBe(0);
    expect(dayIndexAtX(PAD + w, 365, PAD, w)).toBe(364);
    expect(dayIndexAtX(PAD + w / 2, 365, PAD, w)).toBe(182);
    let prev = -1;
    for (let x = PAD; x <= PAD + w; x += 0.5) {
      const i = dayIndexAtX(x, 365, PAD, w);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
});
