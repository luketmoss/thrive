// #242 AC2, AC3 — the chart primitive: dots, a breaking average, the band,
// and a group of cards sharing one x domain (proven with a fixture group).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { TrendCharts, TrendCard, summaryText, midSentence } from './trend-chart';
import { RESTING_HR, type TrendGroup, type TrendMetric, type TrendPoint } from './metrics';
import { addDays, metricSeries, rangeBounds } from './series';
import { dailyHealth } from '../../state/store';

afterEach(cleanup);

const TODAY = '2026-09-27';

function metric(id: string, pts: TrendPoint[], extra: Partial<TrendMetric> = {}): TrendMetric {
  return { id, label: `Metric ${id}`, unit: 'u', points: () => pts, format: (v) => String(Math.round(v)), band: true, ...extra };
}

/** Values on each of the n days ending today, with `skip` days blank. */
function daily(n: number, value: (i: number) => number, skip: number[] = []): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) if (!skip.includes(i)) out.push({ date: addDays(TODAY, -i), value: value(i) });
  return out;
}

function renderCard(m: TrendMetric, range: '1W' | '1M' | '3M' | '1Y' = '1M', avgDays = 7) {
  const { from, to } = rangeBounds(range, TODAY, null);
  return render(h(TrendCard, { metric: m, from, to, range, avgDays, today: TODAY }));
}

describe('dots', () => {
  it('draws one full-opacity dot per day with a value, none for a blank, and 0 as a dot', () => {
    const pts = daily(30, (i) => (i === 3 ? 0 : 50), [5, 6]);
    const { container } = renderCard(metric('a', pts));
    const dots = container.querySelectorAll('circle.trend-dot');
    expect(dots).toHaveLength(28);
    expect(container.querySelector(`circle[data-date="${addDays(TODAY, -5)}"]`)).toBeNull();
    expect(container.querySelector(`circle[data-date="${addDays(TODAY, -3)}"]`)).not.toBeNull();
    for (const d of dots) {
      expect(d.getAttribute('fill')).toBe('var(--chart-dot)');
      expect(d.getAttribute('opacity')).toBeNull();
    }
  });

  it('keeps the radius at least 1.5 px at 1Y', () => {
    const { container } = renderCard(metric('a', daily(365, () => 50)), '1Y');
    const r = Number(container.querySelector('circle.trend-dot')!.getAttribute('r'));
    expect(r).toBeGreaterThanOrEqual(1.5);
  });

  it('draws a partial day as a hollow dot', () => {
    const pts = daily(30, () => 50);
    pts[pts.length - 1] = { ...pts[pts.length - 1], partial: 'Covers 2 of 3 activities' };
    const { container } = renderCard(metric('a', pts));
    const hollow = container.querySelectorAll('circle.trend-dot-partial');
    expect(hollow).toHaveLength(1);
    expect(hollow[0].getAttribute('fill')).toBe('var(--color-surface)');
    expect(hollow[0].getAttribute('stroke')).toBe('var(--chart-dot)');
  });
});

describe('average line', () => {
  it('breaks at a day without a point and is absent when Off', () => {
    const pts = daily(30, () => 50, [10]);
    const on = renderCard(metric('a', pts));
    expect(on.container.querySelectorAll('path.trend-line')).toHaveLength(2);
    for (const p of on.container.querySelectorAll('path.trend-line')) {
      expect(p.getAttribute('stroke')).toBe('var(--chart-line)');
    }
    cleanup();
    const off = renderCard(metric('a', pts), '1M', 0);
    expect(off.container.querySelectorAll('path.trend-line')).toHaveLength(0);
    expect(off.container.querySelectorAll('circle.trend-dot')).toHaveLength(29);
  });
});

describe('band', () => {
  it('draws your range as one flat rect behind the dots, at least 1 px tall', () => {
    const { container } = renderCard(metric('a', daily(60, () => 52)));
    const rects = container.querySelectorAll('rect.trend-band');
    expect(rects).toHaveLength(1);
    expect(rects[0].getAttribute('fill')).toBe('var(--chart-band)');
    expect(Number(rects[0].getAttribute('height'))).toBeGreaterThanOrEqual(1);
    // Behind: it comes before the dots in document order.
    const svg = container.querySelector('svg')!;
    const order = [...svg.querySelectorAll('rect.trend-band, circle.trend-dot, path.trend-line')].map((e) => e.tagName);
    expect(order[0]).toBe('rect');
    expect(container.textContent).toContain('Your range 52–52 u (Aug 28 – Sep 26)');
  });

  it('draws nothing and says nothing with fewer than 14 values before today', () => {
    const { container } = renderCard(metric('a', daily(10, () => 52)));
    expect(container.querySelector('rect.trend-band')).toBeNull();
    expect(container.textContent).not.toMatch(/Your range|Building/);
  });

  it('draws no band for a metric that does not declare one', () => {
    const { container } = renderCard(metric('a', daily(60, () => 52), { band: false }));
    expect(container.querySelector('rect.trend-band')).toBeNull();
  });
});

describe('card', () => {
  it('names the metric and range, and is described by its summary line', () => {
    const { container } = renderCard(metric('a', daily(30, () => 50, [0, 1])));
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Metric a, last 30 days');
    const summary = container.querySelector(`#${svg.getAttribute('aria-describedby')}`)!;
    expect(summary.textContent).toContain('Average 50 u');
    expect(summary.textContent).toContain('28 of 30 days');
  });

  it('never judges: no arrows or comparisons', () => {
    const { container } = renderCard(metric('a', daily(30, (i) => 50 + i)));
    expect(container.textContent).not.toMatch(/[↑↓▲▼]|better|worse|up |down |vs\.?|previous|good|bad/i);
  });

  it('has an axis of round gridlines and one y-axis only', () => {
    const { container } = renderCard(metric('a', daily(30, (i) => 48 + (i % 7))));
    const labels = [...container.querySelectorAll('.trend-grid text')].map((t) => t.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const l of labels) expect(Number(l) % 1).toBe(0);
    expect(container.querySelectorAll('.trend-grid')).toHaveLength(1);
  });

  it('says "Nothing recorded yet." with no values ever, and the range sentence when none are in range', () => {
    let r = renderCard(metric('a', []));
    expect(r.container.textContent).toContain('Nothing recorded yet.');
    expect(r.container.querySelector('svg')).toBeNull();
    cleanup();
    r = renderCard(RESTING_HR);
    expect(r.container.textContent).toContain('Nothing recorded yet.');
    cleanup();
    r = renderCard({ ...RESTING_HR, points: () => [{ date: '2020-01-01', value: 50 }] }, '1W');
    expect(r.container.textContent).toContain('No resting HR in this range.');
    expect(r.container.querySelector('svg')).toBeNull();
  });

  it('shows the note line when a metric has one', () => {
    const { container } = renderCard(metric('a', daily(5, () => 1), { note: 'Outdoor only' }));
    expect(container.querySelector('.trend-note')?.textContent).toBe('Outdoor only');
  });
});

describe('a group', () => {
  it('stacks one card per metric on the same date range and x positions', () => {
    const a = metric('a', daily(91, () => 50, [3]));
    const b = metric('b', daily(91, (i) => 9000 + i * 10, [4]), { zeroBased: true, band: false });
    const group: TrendGroup = { id: 'fixture', label: 'Fixture', metrics: [a, b] };
    const { from, to } = rangeBounds('3M', TODAY, null);
    const { container } = render(h(TrendCharts, { group, from, to, range: '3M', avgDays: 7, today: TODAY }));
    const cards = container.querySelectorAll('section.trend-card');
    expect(cards).toHaveLength(2);
    const cx = (card: Element, date: string) => card.querySelector(`circle[data-date="${date}"]`)!.getAttribute('cx');
    for (const date of [from, addDays(TODAY, -40), TODAY]) expect(cx(cards[0], date)).toBe(cx(cards[1], date));
    const xLabels = (card: Element) => [...card.querySelectorAll('.trend-x-axis text')].map((t) => `${t.getAttribute('x')}:${t.textContent}`);
    expect(xLabels(cards[0])).toEqual(xLabels(cards[1]));
  });
});

describe('RESTING_HR reads DailyHealth', () => {
  beforeEach(() => { dailyHealth.value = { state: 'idle' }; });

  it('keeps blank as none and 0 as 0, and is empty until loaded', () => {
    expect(RESTING_HR.points()).toEqual([]);
    dailyHealth.value = {
      state: 'loaded',
      rows: [
        { date: '2026-09-02', resting_hr: '' },
        { date: '2026-09-01', resting_hr: '0' },
        { date: '2026-09-03', resting_hr: '51' },
      ] as never,
    };
    expect(RESTING_HR.points()).toEqual([{ date: '2026-09-01', value: 0 }, { date: '2026-09-03', value: 51 }]);
  });
});

describe('text helpers', () => {
  it('midSentence lowercases a leading word, not an acronym', () => {
    expect(midSentence('Resting HR')).toBe('resting HR');
    expect(midSentence('HRV')).toBe('HRV');
  });

  it('summaryText omits the range when there is none', () => {
    const m = metric('a', daily(3, () => 5));
    const { from, to } = rangeBounds('1W', TODAY, null);
    expect(summaryText(m, metricSeries(m, from, to, 0, TODAY), TODAY)).toBe('Average 5 u · 3 of 7 days');
  });
});
