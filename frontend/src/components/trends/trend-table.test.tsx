// #242 AC4 — the table view: a row per day, newest first, blanks as "—".

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { TrendTable } from './trend-table';
import type { TrendGroup, TrendMetric, TrendPoint } from './metrics';
import { addDays, rangeBounds } from './series';

afterEach(cleanup);

const TODAY = '2026-09-27';

function metric(pts: TrendPoint[], extra: Partial<TrendMetric> = {}): TrendMetric {
  return { id: 'resting_hr', label: 'Resting HR', unit: 'bpm', points: () => pts, format: (v) => String(Math.round(v)), band: true, ...extra };
}

function renderTable(m: TrendMetric, avgDays = 7) {
  const group: TrendGroup = { id: 'g', label: 'Heart', metrics: [m] };
  const { from, to } = rangeBounds('1W', TODAY, null);
  return render(h(TrendTable, { group, from, to, range: '1W', avgDays, today: TODAY }));
}

const pts: TrendPoint[] = [];
for (let i = 40; i >= 0; i--) if (i !== 2) pts.push({ date: addDays(TODAY, -i), value: i === 0 ? 0 : 50 });

describe('TrendTable', () => {
  it('has one row per day, newest first, with blanks as — and 0 as 0', () => {
    const { container } = renderTable(metric(pts));
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(7);
    expect(rows[0].querySelector('th[scope="row"]')!.textContent).toBe('Sun, Sep 27');
    expect(rows[0].querySelectorAll('td')[0].textContent).toBe('0');
    expect(rows[2].querySelectorAll('td')[0].textContent).toBe('—');
    expect(rows[2].querySelectorAll('td')[1].textContent).toBe('—'); // no average on a blank day
  });

  it('adds the chosen average column, and none when Off', () => {
    let r = renderTable(metric(pts));
    expect([...r.container.querySelectorAll('thead th[scope="col"]')].map((t) => t.textContent))
      .toEqual(['Date', 'Resting HR (bpm)', '7-day avg']);
    cleanup();
    r = renderTable(metric(pts), 0);
    expect(r.container.querySelectorAll('thead th')).toHaveLength(2);
  });

  it('captions the range and your range with its window', () => {
    const { container } = renderTable(metric(pts));
    expect(container.querySelector('caption')!.textContent)
      .toBe('Last 7 days. Resting HR: your range 50–50 bpm (Aug 28 – Sep 26).');
  });

  it('sits in a keyboard-reachable, labelled region', () => {
    const { container } = renderTable(metric(pts));
    const region = container.querySelector('[role="region"]')!;
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Resting HR table');
    expect(region.querySelector('table')).not.toBeNull();
  });

  it('shows a partial day\'s sentence as text', () => {
    const p = [...pts];
    p[p.length - 1] = { ...p[p.length - 1], partial: 'partial day' };
    const { container } = renderTable(metric(p));
    expect(container.querySelector('tbody tr td')!.textContent).toBe('0 partial day');
  });
});
