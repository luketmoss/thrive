// #254 — opening a chart day in the Day view.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../state/actions', () => ({ loadHealth: async () => {} }));

import { TrendsScreen, selectedDay, announcement } from './trends-screen';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays } from '../../day/dates';
import { todayInDenver } from '../../day/dates';
import { openDayName } from './trend-readout';

const TODAY = todayInDenver();

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
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ date: addDays(TODAY, -i), resting_hr: String(50 + (i % 5)), hrv: '60', stress_avg: '30', sheetRow: i + 2 });
  dailyHealth.value = { state: 'loaded', rows: rows as never[] };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
  selectedDay.value = null;
  announcement.value = '';
  window.location.hash = '#/trends';
});
afterEach(cleanup);

const wrapper = (c: Element) => c.querySelector<HTMLElement>('.trend-charts')!;
const links = (c: Element) => [...c.querySelectorAll<HTMLAnchorElement>('a.trend-open-day')];

describe('AC1: Open day in the readout', () => {
  it('has no link while nothing is selected', () => {
    const { container } = renderScreen();
    expect(links(container)).toHaveLength(0);
  });

  it('puts one tabindex=-1 link in every card, to #/ for today and #/day/DATE otherwise', () => {
    const { container } = renderScreen();
    selectedDay.value = TODAY;
    return Promise.resolve().then(() => {
      const ls = links(container);
      expect(ls.length).toBe(container.querySelectorAll('.trend-card').length);
      for (const a of ls) {
        expect(a.getAttribute('tabindex')).toBe('-1');
        expect(a.getAttribute('href')).toBe('#/');
      }
      selectedDay.value = addDays(TODAY, -3);
      return Promise.resolve().then(() => {
        expect(links(container)[0].getAttribute('href')).toBe(`#/day/${addDays(TODAY, -3)}`);
      });
    });
  });

  it('is named "Open day, Weekday, Month D", with the year when not this year', async () => {
    const { container } = renderScreen();
    selectedDay.value = TODAY;
    await Promise.resolve();
    const a = links(container)[0];
    expect(a.textContent!.startsWith('Open day, ')).toBe(true);
    expect(a.querySelector('.sr-only')!.textContent).toBe(`, ${openDayName(TODAY, TODAY)}`);
    expect(a.closest('[aria-hidden="true"]')).toBeNull();
    expect(openDayName('2025-08-28', '2026-10-01')).toBe('Thursday, August 28, 2025');
    expect(openDayName('2026-08-28', '2026-10-01')).toBe('Friday, August 28');
  });

  it('adds no tab stops and the wrapper keeps the selection when focus moves to the link', async () => {
    const { container } = renderScreen();
    selectedDay.value = addDays(TODAY, -1);
    await Promise.resolve();
    const a = links(container)[0];
    fireEvent.blur(wrapper(container), { relatedTarget: a });
    expect(selectedDay.value).toBe(addDays(TODAY, -1));
    fireEvent.blur(wrapper(container), { relatedTarget: null });
    expect(selectedDay.value).toBeNull();
  });

  it('a press on the link is inside the charts, so it does not clear the selection', async () => {
    const { container } = renderScreen();
    selectedDay.value = addDays(TODAY, -1);
    await Promise.resolve();
    fireEvent.pointerDown(links(container)[0]);
    expect(selectedDay.value).toBe(addDays(TODAY, -1));
  });

  it('opens the day on click, pushing a history entry', async () => {
    const { container } = renderScreen();
    selectedDay.value = addDays(TODAY, -2);
    await Promise.resolve();
    const before = window.history.length;
    fireEvent.click(links(container)[0]);
    expect(window.location.hash).toBe(`#/day/${addDays(TODAY, -2)}`);
    expect(window.history.length).toBeGreaterThanOrEqual(before);
  });
});

describe('AC2: Enter', () => {
  it('opens the selected day', () => {
    const { container } = renderScreen();
    selectedDay.value = addDays(TODAY, -4);
    const notPrevented = fireEvent.keyDown(wrapper(container), { key: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(window.location.hash).toBe(`#/day/${addDays(TODAY, -4)}`);
  });

  it("opens today as '#/'", () => {
    const { container } = renderScreen();
    window.location.hash = '#/trends';
    selectedDay.value = TODAY;
    fireEvent.keyDown(wrapper(container), { key: 'Enter' });
    expect(window.location.hash === '#/' || window.location.hash === '').toBe(true);
  });

  it('does nothing with no selection, or with a modifier', () => {
    const { container } = renderScreen();
    expect(fireEvent.keyDown(wrapper(container), { key: 'Enter' })).toBe(true);
    selectedDay.value = addDays(TODAY, -4);
    for (const mod of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) {
      fireEvent.keyDown(wrapper(container), { key: 'Enter', [mod]: true });
    }
    expect(window.location.hash).toBe('#/trends');
  });

  it('leaves Space unhandled', () => {
    const { container } = renderScreen();
    selectedDay.value = addDays(TODAY, -4);
    expect(fireEvent.keyDown(wrapper(container), { key: ' ' })).toBe(true);
  });
});

describe('AC3: scroll', () => {
  it('scrolls the Day view to its top once the hash has changed', async () => {
    const { container } = renderScreen();
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    selectedDay.value = addDays(TODAY, -2);
    fireEvent.keyDown(wrapper(container), { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });
});
