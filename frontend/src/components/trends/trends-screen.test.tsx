// #242 AC1, AC5 — the Trends screen: controls, remembering them, and the
// loading, empty and failed states.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const loadHealth = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({ loadHealth: (t: string) => loadHealth(t) }));

import { TrendsScreen, captionText } from './trends-screen';
import { AuthContext } from '../../auth/auth-context';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { addDays, localToday } from './series';

const TODAY = localToday();

function rows(n: number, skip: number[] = []) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ date: addDays(TODAY, -i), resting_hr: skip.includes(i) ? '' : String(50 + (i % 5)), sheetRow: i + 2 });
  }
  return out as never[];
}

function renderScreen(token: string | null = 'tok') {
  return render(
    h(AuthContext.Provider, {
      value: { token, user: null, isAuthenticated: true, login: () => {}, logout: () => {} },
      children: h(TrendsScreen, {}),
    }),
  );
}

const loaded = (r: never[]) => {
  dailyHealth.value = { state: 'loaded', rows: r };
  bodyMeasurements.value = { state: 'loaded', rows: [] };
  dailySummary.value = { state: 'loaded', rows: [] };
};

beforeEach(() => {
  localStorage.clear();
  loadHealth.mockClear();
  dailyHealth.value = { state: 'idle' };
  bodyMeasurements.value = { state: 'idle' };
  dailySummary.value = { state: 'idle' };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const group = (c: Element, name: string) => {
  const label = [...c.querySelectorAll('.trends-control-label')].find((l) => l.textContent === name)!;
  return c.querySelector(`[role="group"][aria-labelledby="${label.id}"]`)!;
};
const pressed = (g: Element) => [...g.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);

describe('AC1: controls', () => {
  it('renders one h1 and three labelled groups in order, each with one pressed default', () => {
    loaded(rows(100));
    const { container } = renderScreen();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')!.textContent).toBe('Trends');
    expect([...container.querySelectorAll('.trends-control-label')].map((l) => l.textContent)).toEqual(['Range', 'Average', 'View']);
    const buttons = (n: string) => [...group(container, n).querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons('Range')).toEqual(['1W', '1M', '3M', '6M', '1Y', 'All']);
    expect(buttons('Average')).toEqual(['Off', '7d', '14d', '30d']);
    expect(buttons('View')).toEqual(['Chart', 'Table']);
    expect(pressed(group(container, 'Range'))).toEqual(['3M']);
    expect(pressed(group(container, 'Average'))).toEqual(['7d']);
    expect(pressed(group(container, 'View'))).toEqual(['Chart']);
    expect(group(container, 'Range').classList.contains('trends-toggle-tight')).toBe(true);
  });

  it('redraws from loaded rows without a read, stores the choice, and restores it', () => {
    loaded(rows(100));
    const first = renderScreen();
    expect(loadHealth).not.toHaveBeenCalled();
    fireEvent.click([...group(first.container, 'Range').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '1W')!);
    fireEvent.click([...group(first.container, 'Average').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Off')!);
    expect(first.container.querySelector('svg')!.getAttribute('aria-label')).toBe('Resting HR, last 7 days');
    expect(first.container.querySelectorAll('circle.trend-dot')).toHaveLength(7);
    expect(first.container.querySelector('path.trend-line')).toBeNull();
    expect(localStorage.getItem('thrive-trends-range')).toBe('1W');
    expect(localStorage.getItem('thrive-trends-average')).toBe('Off');
    expect(loadHealth).not.toHaveBeenCalled();
    cleanup();
    const again = renderScreen();
    expect(pressed(group(again.container, 'Range'))).toEqual(['1W']);
    expect(pressed(group(again.container, 'Average'))).toEqual(['Off']);
  });

  it('applies a choice for this visit when storage fails, and reads defaults when it cannot read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    loaded(rows(100));
    const { container } = renderScreen();
    expect(pressed(group(container, 'Range'))).toEqual(['3M']);
    fireEvent.click([...group(container, 'View').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Table')!);
    expect(pressed(group(container, 'View'))).toEqual(['Table']);
    expect(container.querySelector('table')).not.toBeNull();
  });
});

describe('AC2: caption', () => {
  it('follows the average and the band', () => {
    expect(captionText(7, true)).toBe(
      'Dots are each day · line is the 7-day average · shaded band is your range, the mean ± 1 SD of the 30 days before today. Blank days stay blank.',
    );
    expect(captionText(0, true)).not.toMatch(/line/);
    expect(captionText(14, false)).toBe('Dots are each day · line is the 14-day average. Blank days stay blank.');
  });

  it('is shown under the controls in chart and table view', () => {
    loaded(rows(100));
    const { container } = renderScreen();
    expect(container.querySelector('.trends-caption')!.textContent).toContain('7-day average');
    fireEvent.click([...group(container, 'View').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Table')!);
    expect(container.querySelector('.trends-caption')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(91);
  });
});

describe('AC5: loading, empty and failed', () => {
  it('calls loadHealth once when idle', () => {
    renderScreen();
    expect(loadHealth).toHaveBeenCalledTimes(1);
    expect(loadHealth).toHaveBeenCalledWith('tok');
  });

  it('does not call it when loading or loaded', () => {
    dailyHealth.value = { state: 'loading' };
    bodyMeasurements.value = { state: 'loading' };
    dailySummary.value = { state: 'loading' };
    const { container } = renderScreen();
    expect(loadHealth).not.toHaveBeenCalled();
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Loading…');
    cleanup();
    loaded(rows(10));
    renderScreen();
    expect(loadHealth).not.toHaveBeenCalled();
  });

  it('shows the error with a Try again that reloads', () => {
    dailyHealth.value = { state: 'error' };
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    dailySummary.value = { state: 'loaded', rows: [] };
    const { container, getByText } = renderScreen();
    expect(container.textContent).toContain("Couldn't load your health data.");
    fireEvent.click(getByText('Try again'));
    expect(loadHealth).toHaveBeenCalledWith('tok');
  });

  it('says "Nothing recorded yet." with no resting HR ever, and draws no chart', () => {
    loaded([]);
    const { container } = renderScreen();
    expect(container.textContent).toContain('Nothing recorded yet.');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('says "No resting HR in this range." when none fall in it', () => {
    loaded([{ date: addDays(TODAY, -200), resting_hr: '50', sheetRow: 2 }] as never[]);
    const { container } = renderScreen();
    expect(container.textContent).toContain('No resting HR in this range.');
    expect(container.querySelector('svg')).toBeNull();
  });
});
