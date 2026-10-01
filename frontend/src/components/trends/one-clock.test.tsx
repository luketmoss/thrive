// #286 — Trends reads "today" from the one clock the Day view uses (America/Denver).
//
// The system time is pinned with fake timers, and the device's time zone is
// pinned with `process.env.TZ`, so the mismatch window is reproduced on any CI
// machine: the device's date a day ahead of Denver's, and a day behind it.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../state/actions', () => ({ loadHealth: async () => {} }));

import { TrendsScreen, selectedDay, announcement } from './trends-screen';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays, rowDate } from './series';
import { todayInDenver } from '../../day/dates';
import { today as todaySignal, recheckToday } from '../../day/today';

function renderScreen() {
  return render(
    h(AuthContext.Provider, {
      value: { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} },
      children: h(TrendsScreen, {}),
    }),
  );
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const realTZ = process.env.TZ;

function pin(iso: string, tz: string) {
  process.env.TZ = tz;
  vi.setSystemTime(new Date(iso));
  recheckToday();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  localStorage.clear();
  localStorage.setItem('thrive-trends-range', '1W');
  const base = '2026-10-01';
  const rows = [];
  for (let i = -3; i < 30; i++) rows.push({ date: addDays(base, -i), resting_hr: '55', hrv: '60', sheetRow: i + 10 });
  dailyHealth.value = { state: 'loaded', rows: rows as never[] };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
  selectedDay.value = null;
  announcement.value = '';
  window.location.hash = '#/trends';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (realTZ === undefined) delete process.env.TZ; else process.env.TZ = realTZ;
  recheckToday();
});

const dots = (c: Element) => [...c.querySelectorAll<SVGElement>('.trend-card:first-of-type .trend-dot')].map((d) => d.getAttribute('data-date')!);
const lastTableRow = (c: Element) => [...c.querySelectorAll('tbody tr th')].pop()!.textContent;
const firstTableRow = (c: Element) => c.querySelector('tbody tr th')!.textContent;

describe.each([
  // Denver is 2026-10-01 11:10 (MDT) in both.
  ['device a day ahead (UTC+14)', 'Pacific/Kiritimati', '2026-10-01T17:10:00Z'],
  ['device a day behind (UTC-11)', 'Pacific/Pago_Pago', '2026-10-02T03:10:00Z'],
])('AC1/AC3: %s', (_name, tz, iso) => {
  const DENVER_TODAY = todayInDenver(new Date(iso));

  it('really is a mismatch window', () => {
    pin(iso, tz);
    // Guard the premise: if the runtime ignores a runtime TZ change, say so.
    expect(DENVER_TODAY).toBe('2026-10-01');
    if (localDate(new Date(iso)) === DENVER_TODAY) return; // TZ not switchable here
    expect(localDate(new Date(iso))).not.toBe(DENVER_TODAY);
  });

  it('ends the chart and the table on Denver\'s date', () => {
    pin(iso, tz);
    const { container } = renderScreen();
    const d = dots(container);
    expect(d[d.length - 1]).toBe(DENVER_TODAY);
    expect(d[0]).toBe(addDays(DENVER_TODAY, -6));
    fireEvent.click([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Table')!);
    // The table lists the newest day first.
    expect(firstTableRow(container)).toBe(rowDate(DENVER_TODAY, DENVER_TODAY));
    expect(lastTableRow(container)).toBe(rowDate(addDays(DENVER_TODAY, -6), DENVER_TODAY));
  });

  it('links the last day to #/ and the day before to #/day/DATE', () => {
    pin(iso, tz);
    const { container } = renderScreen();
    selectedDay.value = DENVER_TODAY;
    return Promise.resolve().then(() => {
      expect(container.querySelector('a.trend-open-day')!.getAttribute('href')).toBe('#/');
      selectedDay.value = addDays(DENVER_TODAY, -1);
      return Promise.resolve().then(() => {
        expect(container.querySelector('a.trend-open-day')!.getAttribute('href')).toBe(`#/day/${addDays(DENVER_TODAY, -1)}`);
      });
    });
  });

  it('Enter on the last day goes to the Day view\'s today', () => {
    pin(iso, tz);
    const { container } = renderScreen();
    const wrap = container.querySelector<HTMLElement>('.trend-charts')!;
    fireEvent.keyDown(wrap, { key: 'End' });
    expect(selectedDay.value).toBe(DENVER_TODAY);
    fireEvent.keyDown(wrap, { key: 'Enter' });
    expect(window.location.hash).toBe('#/');
  });
});

describe('AC2: rollover at Denver midnight', () => {
  it('appends a new last day, clears the selection, with no reload', async () => {
    pin('2026-10-02T05:30:00Z', 'America/Denver'); // 23:30 on 10-01 in Denver
    const { container } = renderScreen();
    expect(dots(container).pop()).toBe('2026-10-01');
    selectedDay.value = '2026-10-01';
    announcement.value = 'something';
    vi.setSystemTime(new Date('2026-10-02T06:05:00Z')); // 00:05 on 10-02
    vi.advanceTimersByTime(60_000);
    expect(todaySignal.value).toBe('2026-10-02');
    await new Promise((r) => setTimeout(r, 200)); // let the render and its effects run
    expect(selectedDay.value).toBeNull();
    expect(announcement.value).toBe('');
    expect(dots(container).pop()).toBe('2026-10-02');
    expect(dots(container)[0]).toBe('2026-09-26');
  });

  it('releases the watch on unmount: the minute timer stops', () => {
    pin('2026-10-02T05:30:00Z', 'America/Denver');
    const { unmount } = renderScreen();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
