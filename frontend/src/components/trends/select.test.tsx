// #247 AC1, AC3, AC4, AC5 — selecting a day by pointer and keyboard.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../state/actions', () => ({ loadHealth: async () => {} }));

import { TrendsScreen, selectedDay, announcement } from './trends-screen';
import { TrendPlot } from './trend-chart';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays } from '../../day/dates';
import { metricSeries, rangeBounds } from './series';
import { todayInDenver } from '../../day/dates';
import { readoutDate } from './readout';
import type { TrendMetric } from './metrics';

const TODAY = todayInDenver();

function rows(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      date: addDays(TODAY, -i),
      resting_hr: i === 2 ? '' : String(50 + (i % 5)),
      hrv: i === 1 ? '' : String(60 + (i % 7)),
      stress_avg: String(25 + (i % 6)),
      sheetRow: i + 2,
    });
  }
  return out as never[];
}

function renderScreen() {
  return render(
    h(AuthContext.Provider, {
      value: { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} },
      children: h(TrendsScreen, {}),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('thrive-trends-range', '1W');
  dailyHealth.value = { state: 'loaded', rows: rows(60) };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
  selectedDay.value = null;
  announcement.value = '';
});
afterEach(cleanup);

const wrapper = (c: Element) => c.querySelector<HTMLElement>('.trend-charts')!;
const status = (c: Element) => c.querySelector('#trends-announce')!;
const key = (c: Element, k: string) => fireEvent.keyDown(wrapper(c), { key: k });
const hairlines = (c: Element) => c.querySelectorAll('line.trend-hairline');

describe('AC3: one tab stop', () => {
  it('is a labelled group with a hint, and nothing inside takes focus', () => {
    const { container } = renderScreen();
    const w = wrapper(container);
    expect(w.getAttribute('tabindex')).toBe('0');
    expect(w.getAttribute('role')).toBe('group');
    expect(w.getAttribute('aria-label')).toMatch(/ charts$/);
    const hint = container.querySelector(`#${w.getAttribute('aria-describedby')}`)!;
    expect(hint.textContent).toBe('Left and right arrows read one day at a time. Enter opens it in the Day view. The table view lists every day.');
    expect(hint.classList.contains('sr-only')).toBe(true);
    expect(w.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(w.querySelector('svg')!.getAttribute('role')).toBe('img');
  });

  it('selects today on arrival by Tab, and announces it', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    expect(selectedDay.value).toBe(TODAY);
    expect(status(container).textContent).toContain(readoutDate(TODAY, TODAY));
  });

  it('does not take a touch tap on a card header for Tab arrival, though focus lands after pointerup', () => {
    const { container } = renderScreen();
    const head = container.querySelector('.trend-card-title')!;
    fireEvent.pointerDown(head, { pointerType: 'touch' });
    fireEvent.pointerUp(head, { pointerType: 'touch' });
    fireEvent.focus(wrapper(container));
    fireEvent.click(head);
    expect(selectedDay.value).toBeNull();
    expect(status(container).textContent).toBe('');
  });

  it('a key press between a stray press and Tab restores Tab arrival', () => {
    const { container } = renderScreen();
    fireEvent.pointerDown(wrapper(container));
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focus(wrapper(container));
    expect(selectedDay.value).toBe(TODAY);
  });

  it('does not take a mouse press for Tab arrival', () => {
    const { container } = renderScreen();
    fireEvent.pointerDown(wrapper(container));
    fireEvent.focus(wrapper(container));
    expect(selectedDay.value).toBeNull();
  });

  it('moves with the arrows, stops at the ends, and Home/End jump', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    key(container, 'ArrowLeft');
    expect(selectedDay.value).toBe(addDays(TODAY, -1));
    key(container, 'ArrowRight');
    key(container, 'ArrowRight');
    expect(selectedDay.value).toBe(TODAY);
    key(container, 'Home');
    expect(selectedDay.value).toBe(addDays(TODAY, -6));
    key(container, 'ArrowLeft');
    expect(selectedDay.value).toBe(addDays(TODAY, -6));
    key(container, 'End');
    expect(selectedDay.value).toBe(TODAY);
  });

  it('prevents the default of its keys only', () => {
    const { container } = renderScreen();
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape']) {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      wrapper(container).dispatchEvent(ev);
      expect(ev.defaultPrevented, k).toBe(true);
    }
    for (const k of ['Tab', 'ArrowUp', 'PageDown', 'a']) {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      wrapper(container).dispatchEvent(ev);
      expect(ev.defaultPrevented, k).toBe(false);
    }
  });

  it('Escape clears the selection and the status, and keeps focus on the charts', () => {
    const { container } = renderScreen();
    wrapper(container).focus();
    key(container, 'End');
    key(container, 'Escape');
    expect(selectedDay.value).toBeNull();
    expect(hairlines(container)).toHaveLength(0);
    expect(status(container).textContent).toBe('');
    expect(document.activeElement).toBe(wrapper(container));
  });

  it('leaving by Tab clears the selection', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    fireEvent.blur(wrapper(container));
    expect(selectedDay.value).toBeNull();
  });
});

describe('AC1: marks across the group', () => {
  it('draws a hairline on every card and a marker where there is a value', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    key(container, 'ArrowLeft'); // yesterday: HRV is blank
    const cards = container.querySelectorAll('.trend-card');
    expect(cards.length).toBeGreaterThan(1);
    expect(hairlines(container)).toHaveLength(cards.length);
    const markers = container.querySelectorAll('circle.trend-marker');
    expect(markers.length).toBeLessThan(cards.length);
    expect(markers.length).toBeGreaterThan(0);
    const mk = markers[0];
    expect(Number(mk.getAttribute('r'))).toBeGreaterThanOrEqual(4);
    expect(mk.getAttribute('fill')).toBe('var(--color-text)');
    expect(mk.getAttribute('stroke')).toBe('var(--color-surface)');
    expect(mk.getAttribute('stroke-width')).toBe('2');
    const hl = hairlines(container)[0];
    expect(hl.getAttribute('stroke')).toBe('var(--color-text-secondary)');
    expect(hl.getAttribute('stroke-width')).toBe('1');
  });

  it('draws the marks last, above the dots and the line', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    expect(container.querySelector('svg')!.lastElementChild!.classList.contains('trend-selection')).toBe(true);
  });

  it('selects by pointer without announcing, and a mouse leaving the wrapper clears it', () => {
    const { container } = renderScreen();
    const svg = container.querySelector('svg')!;
    fireEvent.pointerMove(svg, { clientX: 9999, pointerType: 'mouse' });
    expect(selectedDay.value).toBe(TODAY);
    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' });
    expect(selectedDay.value).toBe(addDays(TODAY, -6));
    expect(status(container).textContent).toBe('');
    fireEvent.pointerLeave(wrapper(container), { pointerType: 'mouse' });
    expect(selectedDay.value).toBeNull();
  });

  it('keeps a touch selection after the finger lifts', () => {
    const { container } = renderScreen();
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 9999, pointerType: 'touch' });
    fireEvent.pointerUp(svg, { pointerType: 'touch' });
    fireEvent.pointerLeave(wrapper(container), { pointerType: 'touch' });
    expect(selectedDay.value).toBe(TODAY);
  });

  it('draws a partial point as a hollow marker', () => {
    const m: TrendMetric = {
      id: 'p', label: 'P', unit: 'u', band: false, format: String,
      points: () => [{ date: TODAY, value: 5, partial: 'partial day' }],
    };
    const { from, to } = rangeBounds('1W', TODAY, null);
    const { container } = render(h(TrendPlot, {
      metric: m, series: metricSeries(m, from, to, 0, TODAY), width: 300, label: 'P', describedBy: 'x', selectedDate: TODAY,
    }));
    const mk = container.querySelector('circle.trend-marker')!;
    expect(mk.getAttribute('fill')).toBe('var(--color-surface)');
    expect(mk.getAttribute('stroke')).toBe('var(--color-text)');
  });
});

describe('AC2: readout in place of the summary', () => {
  it('shows date and value, and keeps the summary in the same cell and the DOM', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    const card = container.querySelector('.trend-card')!;
    const cell = card.querySelector('.trend-readout-cell')!;
    expect(cell.classList.contains('has-readout')).toBe(true);
    expect(cell.querySelector('.trend-summary')).not.toBeNull();
    expect(cell.querySelector('.trend-readout-date')!.textContent).toBe(readoutDate(TODAY, TODAY));
    expect(cell.querySelector('.trend-readout-value')!.textContent).toMatch(/^\d+ bpm · 7-day avg \d+ bpm$/);
    const ids = card.querySelector('svg')!.getAttribute('aria-describedby')!.split(' ');
    for (const id of ids) expect(container.querySelector(`#${id}`)).not.toBeNull();
    key(container, 'Escape');
    expect(container.querySelector('.trend-readout')).toBeNull();
    expect(container.querySelector('.has-readout')).toBeNull();
  });
});

describe('AC4: the status region', () => {
  it('lives outside the charts and reads the date then each card', () => {
    const { container } = renderScreen();
    const region = status(container);
    expect(region.getAttribute('role')).toBe('status');
    expect(wrapper(container).contains(region)).toBe(false);
    fireEvent.focus(wrapper(container));
    key(container, 'ArrowLeft');
    const t = region.textContent!;
    expect(t.startsWith(`${readoutDate(addDays(TODAY, -1), TODAY)}. Resting HR `)).toBe(true);
    expect(t).toMatch(/HRV —, 7-day avg —\./);
  });
});

describe('AC5: lifetime of a selection', () => {
  const press = (c: Element, group: string, name: string) => {
    const label = [...c.querySelectorAll('.trends-control-label')].find((l) => l.textContent === group)!;
    const g = c.querySelector(`[role="group"][aria-labelledby="${label.id}"]`)!;
    fireEvent.click([...g.querySelectorAll('button')].find((b) => b.textContent === name)!);
  };

  it.each([['Range', '1M'], ['View', 'Table']])('clears on a change of %s', (g, v) => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    press(container, g, v);
    expect(selectedDay.value).toBeNull();
    expect(status(container).textContent).toBe('');
  });

  it('clears on a change of group', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.trends-group-btn')].find((b) => !b.classList.contains('active'))!;
    fireEvent.click(btn);
    expect(selectedDay.value).toBeNull();
  });

  it('keeps the day when the average changes, and the readout follows', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    press(container, 'Average', '14d');
    expect(selectedDay.value).toBe(TODAY);
    expect(container.querySelector('.trend-readout-value')!.textContent).toContain('14-day avg');
    press(container, 'Average', 'Off');
    expect(container.querySelector('.trend-readout-value')!.textContent).not.toContain('avg');
  });

  it('clears on a tap outside the charts, not inside', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    fireEvent.pointerDown(wrapper(container).querySelector('svg')!);
    expect(selectedDay.value).not.toBeNull();
    fireEvent.pointerDown(container.querySelector('h1')!);
    expect(selectedDay.value).toBeNull();
  });

  it('is never stored', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    expect(JSON.stringify({ ...localStorage })).not.toContain(TODAY);
    expect(location.href).not.toContain(TODAY);
  });
});
