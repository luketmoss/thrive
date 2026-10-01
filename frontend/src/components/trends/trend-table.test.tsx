// #242 AC4 — the table view: a row per day, newest first, blanks as "—".

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';
import { TrendTable, resetTableStop } from './trend-table';
import type { TrendGroup, TrendMetric, TrendPoint } from './metrics';
import { addDays } from '../../day/dates';
import { metricSeries, rangeBounds } from './series';

beforeEach(() => { resetTableStop(); window.location.hash = '#/trends'; });
afterEach(cleanup);

const TODAY = '2026-09-27';

function metric(pts: TrendPoint[], extra: Partial<TrendMetric> = {}): TrendMetric {
  return { id: 'resting_hr', label: 'Resting HR', unit: 'bpm', points: () => pts, format: (v) => String(Math.round(v)), band: true, ...extra };
}

function renderTable(m: TrendMetric, avgDays = 7, range: '1W' | '1M' = '1W', metrics: TrendMetric[] = [m]) {
  const group: TrendGroup = { id: 'g', label: 'Heart', metrics };
  const { from, to } = rangeBounds(range, TODAY, null);
  return render(h(TrendTable, { group, series: metrics.map((m) => metricSeries(m, from, to, avgDays, TODAY)), range, avgDays, today: TODAY }));
}

const pts: TrendPoint[] = [];
for (let i = 40; i >= 0; i--) if (i !== 2) pts.push({ date: addDays(TODAY, -i), value: i === 0 ? 0 : 50 });

describe('TrendTable', () => {
  it('has one row per day, newest first, with blanks as — and 0 as 0', () => {
    const { container } = renderTable(metric(pts));
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(7);
    expect(rows[0].querySelector('th[scope="row"] a')!.firstChild!.textContent).toBe('Sun, Sep 27');
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

  it('has no links and no description on a group with no rows', () => {
    const { container } = render(h(TrendTable, { group: { id: 'g', label: 'Heart', metrics: [] }, series: [], range: '1W', avgDays: 0, today: TODAY }));
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('[role="region"]')!.getAttribute('aria-describedby')).toBeNull();
  });
});

// #255
const links = (c: Element) => [...c.querySelectorAll<HTMLAnchorElement>('tbody a.trend-row-link')];
const stops = (c: Element) => links(c).filter((a) => a.getAttribute('tabindex') === '0');
const key = (a: Element, k: string, init: object = {}) => fireEvent.keyDown(a, { key: k, ...init });

describe('#255 AC1: a link per row', () => {
  it('links each date to its day: today #/, others #/day/DATE, blanks too', () => {
    const { container } = renderTable(metric(pts));
    const ls = links(container);
    expect(ls).toHaveLength(7);
    expect(ls[0].getAttribute('href')).toBe('#/');
    expect(ls[1].getAttribute('href')).toBe('#/day/2026-09-26');
    expect(ls[2].getAttribute('href')).toBe('#/day/2026-09-25'); // the blank day
  });

  it('names the link by its visible date, the chevron aria-hidden, one link per row header', () => {
    const { container } = renderTable(metric(pts));
    for (const th of container.querySelectorAll('tbody th[scope="row"]')) {
      expect(th.querySelectorAll('a')).toHaveLength(1);
      expect(th.querySelector('a span')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(links(container)[0].textContent).toBe('Sun, Sep 27›');
    expect(links(container)[0].hasAttribute('aria-label')).toBe(false);
  });

  it('stays a native table and gives the custom set one link per row', () => {
    const m2 = metric(pts, { id: 'hrv', label: 'HRV', unit: 'ms' });
    const { container } = renderTable(metric(pts), 7, '1W', [metric(pts), m2]);
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(links(container)).toHaveLength(7);
  });
});

describe('#255 AC2: opening a day', () => {
  it('prevents the click and pushes the day', () => {
    const { container } = renderTable(metric(pts));
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    links(container)[1].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('#/day/2026-09-26');
  });

  it('leaves a modified click to the browser and registers no scroll reset', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { container } = renderTable(metric(pts));
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      links(container)[1].dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(add.mock.calls.filter((c) => c[0] === 'hashchange')).toHaveLength(0);
    expect(window.location.hash).toBe('#/trends');
    add.mockRestore();
  });
});

describe('#255 AC3/AC4: one tab stop and the keys', () => {
  it('has exactly one tabindex 0, on the newest row, the rest -1', () => {
    const { container } = renderTable(metric(pts));
    expect(stops(container)).toEqual([links(container)[0]]);
    expect(links(container).filter((a) => a.getAttribute('tabindex') === '-1')).toHaveLength(6);
  });

  it('describes the region once', () => {
    const { container } = renderTable(metric(pts));
    const region = container.querySelector('[role="region"]')!;
    const hint = container.querySelector('#' + region.getAttribute('aria-describedby'))!;
    expect(hint.textContent).toBe('Up and down arrows, Home, End, Page Up and Page Down move between days. Enter opens a day in the Day view.');
    expect(region.getAttribute('aria-label')).toBe('Resting HR table');
  });

  it('moves with the arrows, Home, End and the page keys, clamped, moving the stop', () => {
    const { container } = renderTable(metric(pts), 7, '1M');
    const ls = () => links(container);
    ls()[0].focus();
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(ls()[1]);
    expect(stops(container)).toEqual([ls()[1]]);
    key(document.activeElement!, 'ArrowUp');
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(ls()[0]);
    key(document.activeElement!, 'PageDown');
    expect(document.activeElement).toBe(ls()[7]);
    key(document.activeElement!, 'PageUp');
    expect(document.activeElement).toBe(ls()[0]);
    key(document.activeElement!, 'End');
    expect(document.activeElement).toBe(ls()[ls().length - 1]);
    key(document.activeElement!, 'ArrowDown');
    key(document.activeElement!, 'PageDown');
    expect(document.activeElement).toBe(ls()[ls().length - 1]);
    key(document.activeElement!, 'Home');
    expect(document.activeElement).toBe(ls()[0]);
    key(document.activeElement!, 'PageUp');
    expect(document.activeElement).toBe(ls()[0]);
  });

  it('prevents handled keys, and leaves modified keys, Left, Right, Tab and others alone', () => {
    const { container } = renderTable(metric(pts));
    links(container)[2].focus();
    const press = (k: string, init: object = {}) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
      document.activeElement!.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    for (const k of ['ArrowLeft', 'ArrowRight', 'Tab', 'Escape', ' ', 'Enter']) expect(press(k)).toBe(false);
    for (const init of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
      expect(press('ArrowDown', init)).toBe(false);
    }
    expect(document.activeElement).toBe(links(container)[2]);
    expect(press('ArrowDown')).toBe(true);
  });

  it('does not handle keys pressed on the region itself', () => {
    const { container } = renderTable(metric(pts));
    const region = container.querySelector<HTMLElement>('[role="region"]')!;
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    region.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('makes a focused row the stop by any means', () => {
    const { container } = renderTable(metric(pts));
    act(() => links(container)[4].focus());
    expect(stops(container)).toEqual([links(container)[4]]);
  });

  it('keeps the stop on its date over a range change, else the newest row', () => {
    const m = metric(pts);
    const group: TrendGroup = { id: 'g', label: 'Heart', metrics: [m] };
    const props = (range: '1W' | '1M') => {
      const { from, to } = rangeBounds(range, TODAY, null);
      return { group, series: [metricSeries(m, from, to, 7, TODAY)], range, avgDays: 7, today: TODAY };
    };
    const { container, rerender } = render(h(TrendTable, props('1M')));
    act(() => links(container)[20].focus()); // 20 days back
    rerender(h(TrendTable, props('1W')));
    expect(stops(container)).toEqual([links(container)[0]]); // not a row any more
    act(() => links(container)[3].focus());
    rerender(h(TrendTable, props('1M')));
    expect(stops(container)).toEqual([links(container)[3]]);
  });

  it('remembers the stop across a remount, falling back to the newest row', () => {
    let r = renderTable(metric(pts));
    act(() => links(r.container)[3].focus());
    cleanup();
    r = renderTable(metric(pts));
    expect(links(r.container)[3].getAttribute('tabindex')).toBe('0');
    expect(stops(r.container)).toHaveLength(1);
    cleanup();
    resetTableStop();
    r = renderTable(metric(pts));
    expect(stops(r.container)).toEqual([links(r.container)[0]]);
  });

  it('remembers a clicked row even where a click does not focus the link', () => {
    let r = renderTable(metric(pts));
    fireEvent.click(links(r.container)[2]);
    cleanup();
    r = renderTable(metric(pts));
    expect(links(r.container)[2].getAttribute('tabindex')).toBe('0');
  });

  it('sets the measured header height on the wrapper for scroll-margin', () => {
    const { container } = renderTable(metric(pts));
    expect(container.querySelector<HTMLElement>('.trend-table-wrap')!.style.getPropertyValue('--trend-head-h')).toMatch(/px$/);
  });
});
