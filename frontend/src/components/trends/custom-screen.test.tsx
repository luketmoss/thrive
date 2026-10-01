// #246 AC2, AC4 — the Custom group on the Trends screen: one Edit metrics
// button, the empty state, stacked cards, the table, loading gated on the
// union of the chosen metrics' tabs, and focus back to the trigger.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const loadHealth = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({ loadHealth: (t: string) => loadHealth(t) }));

import { TrendsScreen } from './trends-screen';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays, localToday } from './series';

const TODAY = localToday();

function renderScreen() {
  return render(
    h(AuthContext.Provider, {
      value: { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} },
      children: h(TrendsScreen, {}),
    }),
  );
}

const hr = Array.from({ length: 10 }, (_, i) => ({
  date: addDays(TODAY, -i), resting_hr: String(50 + i), sleep_score: String(80 + i), steps: String(5000 + i), sheetRow: i + 2,
})) as never[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('thrive-trends-group', 'custom');
  loadHealth.mockClear();
  dailyHealth.value = { state: 'loaded', rows: hr };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
});
afterEach(cleanup);

const titles = (c: Element) => [...c.querySelectorAll('.trend-card h2, .trend-card h3, .trend-title')].map((e) => e.textContent);

describe('Custom group', () => {
  it('lists Custom last in the switcher', () => {
    const { container } = renderScreen();
    const btns = [...container.querySelectorAll('.trends-group-btn')];
    expect(btns[btns.length - 1].textContent).toBe('Custom');
    expect(btns[btns.length - 1].getAttribute('aria-pressed')).toBe('true');
  });

  it('with nothing picked shows the message and one Edit metrics button, no cards or table', () => {
    const { container, getAllByText, getByText } = renderScreen();
    getByText('Pick up to 4 metrics to see them here.');
    expect(getAllByText('Edit metrics')).toHaveLength(1);
    expect(container.querySelector('.trend-card')).toBeNull();
    expect(container.querySelector('.trend-charts')).toBeNull();
  });

  it('shows the same message, never an empty table, in Table view', () => {
    localStorage.setItem('thrive-trends-view', 'Table');
    const { container, getByText } = renderScreen();
    getByText('Pick up to 4 metrics to see them here.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('does not wait on tabs when nothing is picked', () => {
    dailyHealth.value = { state: 'loading' };
    const { container, getByText } = renderScreen();
    getByText('Pick up to 4 metrics to see them here.');
    expect(container.querySelector('.trends-loading')).toBeNull();
  });

  it('stacks the picked metrics in canonical order across tabs, with one Edit metrics button', () => {
    localStorage.setItem('thrive-trends-custom', JSON.stringify(['steps', 'sleep_score', 'resting_hr']));
    const { container, getAllByText } = renderScreen();
    expect(getAllByText('Edit metrics')).toHaveLength(1);
    expect(container.querySelectorAll('.trend-card')).toHaveLength(3);
    const text = container.querySelector('.trend-cards')!.textContent!;
    expect(text.indexOf('Resting HR')).toBeLessThan(text.indexOf('Sleep Score'));
    expect(text.indexOf('Sleep Score')).toBeLessThan(text.indexOf('Steps'));
  });

  it('gates loading on exactly the union of the picked metrics\' tabs', () => {
    localStorage.setItem('thrive-trends-custom', JSON.stringify(['resting_hr']));
    bodyMeasurements.value = { state: 'error', message: 'x' } as never;
    dailySummary.value = { state: 'loading' };
    const a = renderScreen();
    expect(a.container.querySelector('.trends-error')).toBeNull();
    expect(a.container.querySelector('.trend-card')).not.toBeNull();
    cleanup();
    localStorage.setItem('thrive-trends-custom', JSON.stringify(['resting_hr', 'weight']));
    const b = renderScreen();
    expect(b.container.querySelector('.trends-error')).not.toBeNull();
    cleanup();
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    const c = renderScreen();
    expect(c.container.querySelector('.trends-loading')).toBeNull();
    localStorage.setItem('thrive-trends-custom', JSON.stringify(['resting_hr', 'distance']));
    cleanup();
    const d = renderScreen();
    expect(d.container.querySelector('.trends-loading')).not.toBeNull();
  });

  it('Table view lists exactly the picked columns in canonical order', () => {
    localStorage.setItem('thrive-trends-custom', JSON.stringify(['steps', 'resting_hr']));
    localStorage.setItem('thrive-trends-view', 'Table');
    const { container } = renderScreen();
    const heads = [...container.querySelectorAll('thead th')].map((e) => e.textContent);
    expect(heads.filter((t) => !/avg/.test(t!))).toEqual(['Date', 'Resting HR (bpm)', 'Steps (steps)']);
  });

  it('picking applies at once, is remembered, and focus returns to Edit metrics on Done, Escape and overlay', () => {
    const { container, getByText, getByLabelText } = renderScreen();
    const edit = getByText('Edit metrics');
    fireEvent.click(edit);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent.click(getByLabelText('Resting HR'));
    expect(container.querySelectorAll('.trend-card')).toHaveLength(1);
    expect(localStorage.getItem('thrive-trends-custom')).toBe('["resting_hr"]');

    fireEvent.click(container.querySelector('.trends-picker-done')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(edit);

    fireEvent.click(edit);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(edit);

    fireEvent.click(edit);
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(edit);
  });

  it('a stored selection of retired ids is the empty state, not an error', () => {
    localStorage.setItem('thrive-trends-custom', '["gone","also_gone"]');
    const { getByText } = renderScreen();
    getByText('Pick up to 4 metrics to see them here.');
  });
});
