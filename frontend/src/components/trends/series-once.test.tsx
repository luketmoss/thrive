// #270 AC2, AC3, AC6 — each metric's series is built once and shared; a
// selection builds nothing; All starts from what is drawn.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../state/actions', () => ({ loadHealth: async () => {} }));
vi.mock('./series', async (orig) => {
  const actual = await orig<typeof import('./series')>();
  return { ...actual, metricSeries: vi.fn(actual.metricSeries) };
});

import { TrendsScreen, selectedDay, announcement } from './trends-screen';
import { metricSeries } from './series';
import { TREND_GROUPS, CUSTOM_PICKABLE } from './metrics';
import { CUSTOM_KEY } from './prefs';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays, todayInDenver } from '../../day/dates';

const TODAY = todayInDenver();
const N = TREND_GROUPS[0].metrics.length;

function rows(n: number, bump = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      date: addDays(TODAY, -i),
      resting_hr: i === 2 ? '' : String(50 + bump + (i % 5)),
      hrv: String(60 + (i % 7)),
      steps: String(5000 + i),
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

let pointSpies: ReturnType<typeof vi.spyOn>[] = [];
const pointCalls = () => pointSpies.reduce((a, s) => a + s.mock.calls.length, 0);
const builds = () => vi.mocked(metricSeries).mock.calls.length;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('thrive-trends-range', '1M');
  dailyHealth.value = { state: 'loaded', rows: rows(60) };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
  selectedDay.value = null;
  announcement.value = '';
  vi.mocked(metricSeries).mockClear();
  pointSpies = CUSTOM_PICKABLE.map((m) => vi.spyOn(m, 'points'));
});
afterEach(() => {
  cleanup();
  pointSpies.forEach((s) => s.mockRestore());
});

const wrapper = (c: Element) => c.querySelector<HTMLElement>('.trend-charts')!;
const press = (c: Element, label: string) =>
  fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === label)!);

describe('AC2: one series per metric', () => {
  it('builds N series and calls points() N times for the chart view, band check included', () => {
    renderScreen();
    expect(builds()).toBe(N);
    expect(pointCalls()).toBe(N);
  });

  it('builds N series and calls points() N times for the table view', () => {
    localStorage.setItem('thrive-trends-view', 'Table');
    const { container } = renderScreen();
    expect(container.querySelector('table')).not.toBeNull();
    expect(builds()).toBe(N);
    expect(pointCalls()).toBe(N);
  });
});

describe('AC3: a selection rebuilds nothing', () => {
  it('pointer moves, arrows, Home/End and Escape call neither metricSeries nor points()', () => {
    const { container } = renderScreen();
    const b = builds();
    const p = pointCalls();
    const svg = wrapper(container).querySelector('svg')!;
    fireEvent.pointerMove(svg, { clientX: 100, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 200, pointerType: 'touch' });
    fireEvent.focus(wrapper(container));
    for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape']) {
      fireEvent.keyDown(wrapper(container), { key: k });
    }
    expect(announcement.value).toBe('');
    expect(builds()).toBe(b);
    expect(pointCalls()).toBe(p);
  });

  it('the announcement still reads the shared series', () => {
    const { container } = renderScreen();
    fireEvent.focus(wrapper(container));
    expect(container.querySelector('#trends-announce')!.textContent).toContain('Resting HR');
  });
});

describe('AC3: what changes the days rebuilds, and nothing is stale', () => {
  it('range, average, group and rows each rebuild all N', () => {
    const { container } = renderScreen();
    let b = builds();
    press(container, '1W');
    expect(builds()).toBe(b + N);
    b = builds();
    press(container, '30d');
    expect(builds()).toBe(b + N);
    b = builds();
    const before = container.querySelector('.trend-summary')!.textContent;
    act(() => { dailyHealth.value = { state: 'loaded', rows: rows(60, 40) }; });
    expect(builds()).toBe(b + N);
    expect(container.querySelector('.trend-summary')!.textContent).not.toBe(before);
  });

  it('a reload of a tab the group does not read rebuilds nothing', () => {
    renderScreen();
    const b = builds();
    act(() => { bodyMeasurements.value = { state: 'loaded', rows: [] }; });
    expect(builds()).toBe(b);
  });

  it('a one-metric custom set builds one series', () => {
    localStorage.setItem('thrive-trends-group', 'custom');
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(['resting_hr']));
    const { container } = renderScreen();
    expect(container.querySelectorAll('section.trend-card')).toHaveLength(1);
    const b = builds();
    expect(b).toBe(1);
  });
});

describe('AC6: All starts from what is drawn', () => {
  const customSteps = (ids: string[]) => {
    localStorage.setItem('thrive-trends-group', 'custom');
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(ids));
    localStorage.setItem('thrive-trends-range', 'All');
    localStorage.setItem('thrive-trends-view', 'Table');
  };
  const rowCount = (c: Element) => c.querySelectorAll('tbody tr').length;

  it('falls back to 1M when Steps has only today', () => {
    customSteps(['steps']);
    dailyHealth.value = { state: 'loaded', rows: [{ date: TODAY, steps: '900', sheetRow: 2 }] as never[] };
    expect(rowCount(renderScreen().container)).toBe(30);
  });

  it('falls back to 1M in a group where every other metric is empty', () => {
    customSteps(['steps', 'hrv']);
    dailyHealth.value = { state: 'loaded', rows: [{ date: TODAY, steps: '900', hrv: '', sheetRow: 2 }] as never[] };
    expect(rowCount(renderScreen().container)).toBe(30);
  });

  it('still starts at an older real value', () => {
    customSteps(['steps']);
    dailyHealth.value = {
      state: 'loaded',
      rows: [
        { date: TODAY, steps: '900', sheetRow: 2 },
        { date: addDays(TODAY, -99), steps: '8000', sheetRow: 3 },
      ] as never[],
    };
    expect(rowCount(renderScreen().container)).toBe(100);
  });

  it('a metric that does not exclude today still starts All today', () => {
    customSteps(['hrv']);
    dailyHealth.value = { state: 'loaded', rows: [{ date: TODAY, hrv: '60', sheetRow: 2 }] as never[] };
    expect(rowCount(renderScreen().container)).toBe(1);
  });
});
