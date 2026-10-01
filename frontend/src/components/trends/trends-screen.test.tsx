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
import { addDays } from './series';
import { todayInDenver } from '../../day/dates';

const TODAY = todayInDenver();

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

// ── #243 ─────────────────────────────────────────────────────────────
import { groupHasBand } from './trends-screen';
import type { TrendMetric } from './metrics';

describe('#243 AC5: mixed band flags', () => {
  const pts = Array.from({ length: 60 }, (_, i) => ({ date: addDays(TODAY, -i), value: 50 + (i % 5) }));
  const m = (id: string, band: boolean): TrendMetric => ({ id, label: id, unit: '', points: () => pts, format: String, band });
  const args = [addDays(TODAY, -29), TODAY, 7, TODAY] as const;

  it('keeps the clause when one metric has a band', () => {
    expect(groupHasBand([m('a', false), m('b', true)], [pts, pts], ...args)).toBe(true);
  });
  it('drops it when none do, by flag or by lack of data', () => {
    expect(groupHasBand([m('a', false), m('b', false)], [pts, pts], ...args)).toBe(false);
    expect(groupHasBand([m('a', true)], [[]], ...args)).toBe(false);
    expect(groupHasBand([m('a', true)], [pts.slice(0, 3)], ...args)).toBe(false);
  });
});

describe('#243 AC4: switcher in the screen', () => {
  const click = (c: Element, text: string) =>
    fireEvent.click([...c.querySelectorAll<HTMLButtonElement>('.trends-group-btn')].find((b) => b.textContent === text)!);

  it('shows the groups above the controls, defaulting to Recovery', () => {
    loaded(rows(100));
    const { container } = renderScreen();
    const region = container.querySelector('[role="region"][aria-label="Metric group"]')!;
    expect(region.compareDocumentPosition(container.querySelector('.trends-controls')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...region.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Recovery', 'Sleep', 'Fitness', 'Body', 'Blood Pressure', 'Activity', 'Custom']);
    expect(container.querySelectorAll('.trend-card')).toHaveLength(2);
  });

  it('swaps the cards, stores the group, keeps other controls, and restores on reopen', () => {
    loaded(rows(100));
    const first = renderScreen();
    fireEvent.click([...group(first.container, 'Range').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '1W')!);
    click(first.container, 'Sleep');
    expect(first.container.querySelectorAll('.trend-card')).toHaveLength(4);
    expect(first.container.textContent).toContain('Nothing recorded yet.');
    expect(pressed(group(first.container, 'Range'))).toEqual(['1W']);
    expect(localStorage.getItem('thrive-trends-group')).toBe('sleep');
    cleanup();
    const again = renderScreen();
    expect(again.container.querySelector('.trends-group-btn.active')!.textContent).toBe('Sleep');
  });

  it('falls back to Recovery for an unknown stored group', () => {
    localStorage.setItem('thrive-trends-group', 'gone');
    loaded(rows(100));
    const { container } = renderScreen();
    expect(container.querySelector('.trends-group-btn.active')!.textContent).toBe('Recovery');
  });
});

describe('#244: per-group loading and error state', () => {
  const pickGroup = (c: Element, name: string) =>
    fireEvent.click([...c.querySelectorAll<HTMLButtonElement>('.trends-group-btn')].find((b) => b.textContent === name)!);

  it('Body is not held up by DailyHealth still loading', () => {
    dailyHealth.value = { state: 'loading' };
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    const { container } = renderScreen();
    pickGroup(container, 'Body');
    expect(container.querySelector('.trends-loading')).toBeNull();
    expect(container.textContent).toContain('Nothing recorded yet.');
  });
  it('Body shows loading while BodyMeasurements loads, even if DailyHealth has', () => {
    dailyHealth.value = { state: 'loaded', rows: rows(5) };
    bodyMeasurements.value = { state: 'loading' };
    const { container } = renderScreen();
    pickGroup(container, 'Body');
    expect(container.querySelector('.trends-loading')).not.toBeNull();
  });
  it('a BodyMeasurements error shows on Blood Pressure but not on Recovery', () => {
    dailyHealth.value = { state: 'loaded', rows: rows(5) };
    bodyMeasurements.value = { state: 'error', message: 'x' } as never;
    const { container } = renderScreen();
    expect(container.querySelector('.trends-error')).toBeNull();
    pickGroup(container, 'Blood Pressure');
    expect(container.querySelector('.trends-error')).not.toBeNull();
  });
  it('a DailyHealth error does not mask a loaded Body group', () => {
    dailyHealth.value = { state: 'error', message: 'x' } as never;
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    const { container } = renderScreen();
    pickGroup(container, 'Body');
    expect(container.querySelector('.trends-error')).toBeNull();
  });
});

describe('#245: Activity group state', () => {
  const pickGroup = (c: Element, name: string) =>
    fireEvent.click([...c.querySelectorAll<HTMLButtonElement>('.trends-group-btn')].find((b) => b.textContent === name)!);

  it('waits on DailySummary alone, and is not held up by the other tabs', () => {
    dailyHealth.value = { state: 'loading' };
    bodyMeasurements.value = { state: 'loading' };
    dailySummary.value = { state: 'loaded', rows: [] };
    const { container } = renderScreen();
    pickGroup(container, 'Activity');
    expect(container.querySelector('.trends-loading')).toBeNull();
    expect(container.textContent).toContain('Nothing recorded yet.');
  });
  it('shows loading while DailySummary loads, and Recovery is unaffected by it', () => {
    dailyHealth.value = { state: 'loaded', rows: rows(5) };
    dailySummary.value = { state: 'loading' };
    const { container } = renderScreen();
    expect(container.querySelector('.trends-loading')).toBeNull();
    pickGroup(container, 'Activity');
    expect(container.querySelector('.trends-loading')).not.toBeNull();
  });
  it('a DailySummary error shows on Activity only', () => {
    dailyHealth.value = { state: 'loaded', rows: rows(5) };
    dailySummary.value = { state: 'error', message: 'x' } as never;
    const { container } = renderScreen();
    expect(container.querySelector('.trends-error')).toBeNull();
    pickGroup(container, 'Activity');
    expect(container.querySelector('.trends-error')).not.toBeNull();
  });
});

// #256 AC5: Back restores focus to the charts, and a script restore is not a
// Tab arrival: no day is selected and nothing is announced.
import { waitFor } from '@testing-library/preact';
import { selectedDay, announcement } from './trends-screen';
import { RouteFocus } from '../../router/route-focus';
import { effect } from '@preact/signals';
import { currentRoute, navigate, goBack } from '../../router/router';

describe('#256 AC5: Back restores the charts without selecting a day', () => {
  const settle = () => new Promise((r) => setTimeout(r, 120));
  async function go(move: () => void, name: string) {
    move();
    await waitFor(() => expect(currentRoute.value.name).toBe(name));
    await settle();
  }
  // Trends on #/trends, a stand-in Day elsewhere: the app's Router in small.
  function Screen() {
    return currentRoute.value.name === 'trends' ? h(TrendsScreen, {}) : h('h1', {}, 'Day');
  }
  function renderInMain() {
    return render(
      h('main', { class: 'app-content', tabIndex: -1 },
        h(AuthContext.Provider, {
          value: { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} },
          children: h(Screen, {}),
        }),
        h(RouteFocus, {}),
      ),
    );
  }

  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    localStorage.setItem('thrive-trends-range', '1W');
    loaded(rows(30));
    selectedDay.value = null;
    announcement.value = '';
  });

  async function openDayFromCharts(container: Element) {
    await settle(); // RouteFocus subscribes after paint
    if (currentRoute.value.name !== 'trends') await go(() => navigate('/trends'), 'trends');
    container.querySelector<HTMLElement>('.trend-charts')!.focus(); // a Tab arrival: selects today
    expect(selectedDay.value).toBe(TODAY);
    await go(() => navigate(`/day/${addDays(TODAY, -1)}`), 'day');
    selectedDay.value = null;
    announcement.value = '';
  }

  it('focuses div.trend-charts, selects nothing and announces nothing; arrows then select', async () => {
    const { container } = renderInMain();
    await openDayFromCharts(container);
    expect(document.activeElement!.textContent).toBe('Day');
    // Every value either signal takes on the way back, not just the last:
    // the screen's mount effect clears the selection, which would hide one.
    const seen: unknown[] = [];
    const stop = effect(() => { seen.push(selectedDay.value, announcement.value); });
    await go(() => goBack(), 'trends');
    stop();
    const charts = container.querySelector<HTMLElement>('.trend-charts')!;
    expect(document.activeElement).toBe(charts);
    expect(seen.every((v) => v === null || v === '')).toBe(true);
    expect(selectedDay.value).toBeNull();
    expect(announcement.value).toBe('');
    fireEvent.keyDown(charts, { key: 'ArrowLeft' });
    expect(selectedDay.value).not.toBeNull();
  });

  it('focuses the heading when the charts are not rendered (Table view)', async () => {
    const { container } = renderInMain();
    await openDayFromCharts(container);
    localStorage.setItem('thrive-trends-view', 'Table'); // Trends comes back in Table view
    await go(() => goBack(), 'trends');
    expect(document.activeElement!.tagName).toBe('H1');
    expect(document.activeElement!.textContent).toBe('Trends');
  });
});
