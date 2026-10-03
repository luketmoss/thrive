// #241 — the Calendar screen: AC1 (route, back), AC2 (grid), AC3 (shading),
// AC4 (summary), AC5 (moving between months).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';

const healthRun = vi.fn(async (_t: string) => {});
const journalRun = vi.fn(async (_t: string) => {});
const loadHealth = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({
  healthRefresh: { run: (t: string) => healthRun(t), markStarted: vi.fn() },
  journalRefresh: { run: (t: string) => journalRun(t), markStarted: vi.fn() },
  loadJournal: vi.fn(async () => {}),
  loadHealth: (t: string) => loadHealth(t),
}));

const { CalendarScreen, cellLabel, notePreview, initialSelection } = await import('./calendar-screen');
const { AuthContext } = await import('../../auth/auth-context');
const { currentRoute, replaceRoute } = await import('../../router/router');
const { workouts, journalEntries, dailyHealth } = await import('../../state/store');
const { today } = await import('../../day/today');
const { DAILY_HEALTH_FIELDS } = await import('../../api/health-api');
const { shadeChoices, SHADE_STORAGE_KEY } = await import('../../calendar/shade');
import type { DailyHealthRow } from '../../api/health-api';
import type { WorkoutWithRow } from '../../api/types';

const TODAY = '2026-09-30'; // a Wednesday

function wk(over: Partial<WorkoutWithRow>): WorkoutWithRow {
  return { id: '', date: '', status: '', type: 'bike', sub_type: '', name: '', elapsed_seconds: '', moving_seconds: '', sheetRow: 2, ...over } as WorkoutWithRow;
}

function hr(date: string, over: Partial<Record<string, string>> = {}): DailyHealthRow {
  const r = { sheetRow: 2 } as DailyHealthRow;
  for (const f of DAILY_HEALTH_FIELDS) (r as unknown as Record<string, string>)[f] = '';
  return { ...r, date, ...over } as DailyHealthRow;
}

function renderAt(hash: string) {
  act(() => {
    window.history.replaceState(null, '', '#/');
    replaceRoute(hash);
  });
  return render(
    <AuthContext.Provider value={{ token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} }}>
      <CalendarScreen />
    </AuthContext.Provider>,
  );
}

const cells = (c: Element) => [...c.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')];
const cell = (c: Element, date: string) => {
  const day = Number(date.slice(8));
  const month = Number(date.slice(5, 7));
  // In-month cells are found by their label's date words.
  const words = new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
  const found = cells(c).filter((b) => b.getAttribute('aria-label')!.split(', ')[1] === words);
  if (found.length !== 1) throw new Error(`no single cell for ${date}`);
  return found[0];
};
const summary = (c: Element) => c.querySelector('section.calendar-summary')!;

function pointer(el: Element, type: string, x: number, y: number, t: number) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'timeStamp', { value: t });
  act(() => {
    el.dispatchEvent(e);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-09-30T18:00:00Z'));
  today.value = TODAY;
  workouts.value = [];
  journalEntries.value = { state: 'loaded', entries: [] };
  dailyHealth.value = { state: 'loaded', rows: [] };
  localStorage.clear();
  healthRun.mockClear();
  journalRun.mockClear();
  loadHealth.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AC1 — route and back header', () => {
  it("shows today's month at #/calendar and a named month at #/calendar/YYYY-MM", () => {
    const a = renderAt('#/calendar');
    expect(a.container.querySelector('h1')!.textContent).toBe('September 2026');
    cleanup();
    const b = renderAt('#/calendar/2025-01');
    expect(b.container.querySelector('h1')!.textContent).toBe('January 2025');
  });

  it('has a "Back to Day" control that goes to today when nothing is behind it', () => {
    const { getByRole } = renderAt('#/calendar/2025-01');
    const back = getByRole('button', { name: 'Back to Day' });
    expect(back.classList.contains('template-editor-back')).toBe(true);
    fireEvent.click(back);
    expect(window.location.hash).toBe('#/');
  });

  it('loads health and the journal on show, through their throttles', () => {
    renderAt('#/calendar');
    expect(healthRun).toHaveBeenCalledWith('tok');
    expect(journalRun).toHaveBeenCalledWith('tok');
  });
});

describe('AC2 — the month grid', () => {
  it('is a grid labelled by the h1, Monday-first column headers, one row per week', () => {
    const { container } = renderAt('#/calendar');
    const grid = container.querySelector('[role="grid"]')!;
    const h1 = container.querySelector('h1')!;
    expect(grid.getAttribute('aria-labelledby')).toBe(h1.id);
    const heads = [...grid.querySelectorAll('[role="columnheader"]')];
    expect(heads.map((h) => h.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(heads.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(6); // header + 5 weeks
    expect(cells(container)).toHaveLength(35);
    expect(cells(container).every((c) => c.tagName === 'BUTTON')).toBe(true);
  });

  it('keeps the agreed top-to-bottom order', () => {
    const { container } = renderAt('#/calendar');
    const order = ['.calendar-back', 'h1', '.calendar-shade', '[role="grid"]', '.calendar-legend', '.calendar-summary'];
    const els = order.map((s) => container.querySelector(s)!);
    for (let i = 1; i < els.length; i++) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('marks today with aria-current and selects it on open, the grid\'s one Tab stop', () => {
    const { container } = renderAt('#/calendar');
    const t = cell(container, TODAY);
    expect(t.getAttribute('aria-current')).toBe('date');
    expect(t.getAttribute('aria-selected')).toBe('true');
    expect(t.tabIndex).toBe(0);
    expect(cells(container).filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(t.className).toContain('calendar-day-today');
    expect(t.className).toContain('calendar-day-selected');
  });

  it('mutes leading and trailing days', () => {
    const { container } = renderAt('#/calendar');
    const all = cells(container);
    expect(all[0].className).toContain('calendar-day-outside'); // 31 Aug
    expect(all[34].className).toContain('calendar-day-outside'); // 4 Oct
    expect(all.filter((c) => c.className.includes('calendar-day-outside'))).toHaveLength(5);
  });

  it('draws dots then rings, three at most, and names the day\'s activity', () => {
    workouts.value = [
      wk({ id: 'a', date: '2025-01-14', name: 'Mountain Bike' }),
      wk({ id: 'b', date: '2025-01-14', status: 'planned', name: 'Leg day', type: 'weight' }),
    ];
    const { container } = renderAt('#/calendar/2025-01');
    const c = cell(container, '2025-01-14');
    expect([...c.querySelectorAll('.calendar-mark')].map((m) => m.className)).toEqual([
      'calendar-mark calendar-mark-dot', 'calendar-mark calendar-mark-ring',
    ]);
    expect(c.getAttribute('aria-label')).toBe('Tuesday, January 14, Mountain Bike, 1 planned');
  });

  it('shows a journal dot exactly on days with an entry, and says so', () => {
    journalEntries.value = { state: 'loaded', entries: [{ date: '2026-09-12', note: 'Felt good', created: '', updated: '' }] };
    const { container } = renderAt('#/calendar');
    const c = cell(container, '2026-09-12');
    expect(c.querySelector('.calendar-note')!.getAttribute('aria-hidden')).toBe('true');
    expect(c.getAttribute('aria-label')).toBe('Saturday, September 12, journal entry');
    expect(container.querySelectorAll('[role="gridcell"] .calendar-note')).toHaveLength(1);
  });

  it('arrow keys move focus one cell, Enter/Space (a click) selects', () => {
    const { container } = renderAt('#/calendar');
    const all = cells(container);
    const i = all.indexOf(cell(container, TODAY));
    all[i].focus();
    fireEvent.keyDown(all[i], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(all[i - 1]);
    fireEvent.keyDown(all[i - 1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[i - 8]);
    fireEvent.keyDown(all[i - 8], { key: 'ArrowDown' });
    fireEvent.keyDown(all[i - 1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[i]);
    // Selection did not move with focus
    expect(all[i].getAttribute('aria-selected')).toBe('true');
  });
});

describe('AC3 — shading by one metric', () => {
  const rows = [
    hr('2026-09-01', { resting_hr: '50' }),
    hr('2026-09-02', { resting_hr: '52' }),
    hr('2026-09-03', { resting_hr: '55' }),
    hr('2026-09-04', { resting_hr: '60' }),
    hr('2026-08-31', { resting_hr: '90' }), // leading day: never shaded, not in the bins
  ];

  it('offers the six choices as a labelled pressed-button group, Nothing by default', () => {
    const { getByRole, container } = renderAt('#/calendar');
    const group = getByRole('group', { name: 'Shade days by' });
    expect(group.classList.contains('sub-type-toggle')).toBe(true);
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Nothing', 'Sleep', 'Resting HR', 'HRV', 'Steps', 'Average stress']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(container.querySelector('.calendar-day-shade, .calendar-day-nodata')).toBeNull();
  });

  it('shades in-month days by quartile, marks no-data days, and says each value', () => {
    dailyHealth.value = { state: 'loaded', rows };
    const { getByRole, container } = renderAt('#/calendar');
    fireEvent.click(getByRole('button', { name: 'Resting HR' }));
    expect(localStorage.getItem(SHADE_STORAGE_KEY)).toBe('resting_hr');
    expect(cell(container, '2026-09-01').className).toContain('calendar-shade-1');
    expect(cell(container, '2026-09-04').className).toContain('calendar-shade-4');
    expect(cell(container, '2026-09-04').getAttribute('aria-label')).toBe('Friday, September 4, resting HR 60 bpm');
    const blank = cell(container, '2026-09-05');
    expect(blank.className).toContain('calendar-day-nodata');
    expect(blank.className).not.toContain('calendar-day-shade');
    expect(blank.getAttribute('aria-label')).toBe('Saturday, September 5, no resting HR');
    const leading = cells(container)[0];
    expect(leading.className).not.toMatch(/calendar-shade-|calendar-day-nodata/);
  });

  it('remembers the choice, and shows the scale from lowest to highest in the month', () => {
    dailyHealth.value = { state: 'loaded', rows };
    localStorage.setItem(SHADE_STORAGE_KEY, 'resting_hr');
    const { container } = renderAt('#/calendar');
    const scale = container.querySelector('.calendar-scale')!;
    expect(scale.textContent).toContain('50 bpm');
    expect(scale.textContent).toContain('60 bpm');
    expect(scale.textContent).not.toContain('90 bpm');
    expect(scale.querySelectorAll('.calendar-swatches .calendar-swatch')).toHaveLength(4);
    expect(scale.textContent).toContain('no data');
    expect(container.querySelector('.calendar-legend-marks')!.textContent).toMatch(/Done.*Planned.*Journal entry/);
  });

  it('shades nothing while health is loading', () => {
    dailyHealth.value = { state: 'loading' };
    localStorage.setItem(SHADE_STORAGE_KEY, 'resting_hr');
    const { container } = renderAt('#/calendar');
    expect(container.querySelector('.calendar-day-shade, .calendar-day-nodata')).toBeNull();
    expect(container.querySelector('.panel-status')).toBeNull();
  });

  it('says it could not load, with Try again, when health failed and a metric is chosen', () => {
    dailyHealth.value = { state: 'error' };
    const { getByRole, container, queryByText } = renderAt('#/calendar');
    expect(queryByText("Couldn't load your health data.")).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Sleep' }));
    expect(queryByText("Couldn't load your health data.")).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Try again' }));
    expect(loadHealth).toHaveBeenCalledWith('tok');
    expect(container.querySelector('.calendar-day-shade')).toBeNull();
  });

  // #276 AC5 — focus goes to the pressed shading button, not body.
  describe('#276 — focus after the shading error retry', () => {
    const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const open = () => {
      dailyHealth.value = { state: 'error' };
      const r = renderAt('#/calendar');
      fireEvent.click(r.getByRole('button', { name: 'Sleep' }));
      fireEvent.click(r.getByRole('button', { name: 'Try again' }));
      return r;
    };

    it('success lands focus on the pressed Shade by button', async () => {
      const { getByRole } = open();
      expect(document.activeElement).toBe(document.querySelector('.panel-status'));
      act(() => { dailyHealth.value = { state: 'loaded', rows: [hr('2026-09-10', { sleep_total_s: '25000' })] }; });
      await settle();
      expect(document.activeElement).toBe(getByRole('button', { name: 'Sleep' }));
      expect(document.activeElement!.getAttribute('aria-pressed')).toBe('true');
    });

    // #297 AC1/AC5 — one persistent container through error -> loading -> error.
    it('a retry that fails again keeps the same container, and the focus on it', async () => {
      const { getByRole } = open();
      const before = document.querySelector('.panel-status')!;
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      const during = document.querySelector('.panel-status')!;
      expect(during).toBe(before);
      expect(during.textContent).toBe('Loading…');
      expect(during.querySelector('button')).toBeNull();
      expect(document.activeElement).toBe(before);
      act(() => { dailyHealth.value = { state: 'error' }; });
      await settle();
      const after = document.querySelector('.panel-status')!;
      expect(after).toBe(before);
      expect(after.textContent).toContain("Couldn't load your health data.");
      expect(after.querySelector('button')).not.toBeNull();
      expect(document.activeElement).toBe(before);
      expect(document.activeElement).not.toBe(getByRole('button', { name: 'Sleep' }));

      // A second press works the same way (no stale latch).
      fireEvent.click(getByRole('button', { name: 'Try again' }));
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      expect(document.querySelector('.panel-status')).toBe(before);
      expect(before.textContent).toBe('Loading…');
      act(() => { dailyHealth.value = { state: 'error' }; });
      await settle();
      expect(document.querySelector('.panel-status')).toBe(before);
      expect(document.activeElement).toBe(before);
    });

    it('a retry that succeeds after loading hands focus to the pressed button', async () => {
      const { getByRole } = open();
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      expect(document.activeElement).toBe(document.querySelector('.panel-status'));
      act(() => { dailyHealth.value = { state: 'loaded', rows: [] }; });
      await settle();
      expect(document.querySelector('.panel-status')).toBeNull();
      expect(document.activeElement).toBe(getByRole('button', { name: 'Sleep' }));
    });

    it('leaves focus alone when the user moved on mid-retry', async () => {
      const { getByRole } = open();
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      const back = getByRole('button', { name: 'Back to Day' });
      back.focus();
      act(() => { dailyHealth.value = { state: 'loaded', rows: [] }; });
      await settle();
      expect(document.activeElement).toBe(back);
    });

    // AC3 — only a Try again press shows "Loading…".
    it('shows no Loading status for a loading the user did not ask for, even after a past retry', async () => {
      const { getByRole } = open();
      act(() => { dailyHealth.value = { state: 'loading' }; });
      act(() => { dailyHealth.value = { state: 'error' }; });
      await settle();
      act(() => { dailyHealth.value = { state: 'loaded', rows: [] }; });
      await settle();
      act(() => { dailyHealth.value = { state: 'loading' }; }); // throttled refresh
      await settle();
      expect(document.querySelector('.panel-status')).toBeNull();
      expect(getByRole('button', { name: 'Sleep' })).toBeTruthy();
    });

    it('with Nothing chosen the status never shows, and choosing it mid-retry removes it', async () => {
      const { getByRole } = open();
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      expect(document.querySelector('.panel-status')).not.toBeNull();
      fireEvent.click(getByRole('button', { name: 'Nothing' }));
      expect(document.querySelector('.panel-status')).toBeNull();
      act(() => { dailyHealth.value = { state: 'error' }; });
      await settle();
      expect(document.querySelector('.panel-status')).toBeNull();
    });

    // AC4 — the status belongs to the screen, not the month.
    it('keeps the same status through a month change, and moves no focus', async () => {
      const { getByRole } = open();
      const before = document.querySelector('.panel-status')!;
      act(() => { dailyHealth.value = { state: 'loading' }; });
      fireEvent.click(getByRole('button', { name: 'Next month' }));
      await settle();
      expect(document.querySelector('.panel-status')).toBe(before);
      expect(document.activeElement).toBe(before);
    });

    it('unmounting mid-retry is clean and moves no focus', async () => {
      const r = open();
      act(() => { dailyHealth.value = { state: 'loading' }; });
      await settle();
      r.unmount();
      await settle();
      expect(document.activeElement).toBe(document.body);
    });

    it('leaves focus alone when the user moved on', async () => {
      const { getByRole } = open();
      const back = getByRole('button', { name: 'Back to Day' });
      back.focus();
      act(() => { dailyHealth.value = { state: 'loaded', rows: [] }; });
      await settle();
      expect(document.activeElement).toBe(back);
    });
  });
});

describe('AC4 — the day summary', () => {
  it('selects a tapped day and shows its date, an Open day link, workouts in order, note and value', () => {
    workouts.value = [
      wk({ id: 'p', date: '2026-09-12', status: 'planned', name: 'Leg day', type: 'weight' }),
      wk({ id: 'd', date: '2026-09-12', name: 'Ride', type: 'bike', sub_type: 'mountain', elapsed_seconds: '3600' }),
    ];
    const long = 'A'.repeat(70);
    journalEntries.value = { state: 'loaded', entries: [{ date: '2026-09-12', note: long, created: '', updated: '' }] };
    dailyHealth.value = { state: 'loaded', rows: [hr('2026-09-12', { hrv: '48' })] };
    localStorage.setItem(SHADE_STORAGE_KEY, 'hrv');
    const { container } = renderAt('#/calendar');
    fireEvent.click(cell(container, '2026-09-12'));
    expect(cell(container, '2026-09-12').getAttribute('aria-selected')).toBe('true');
    const s = summary(container);
    expect(s.querySelector('h2')!.textContent).toContain('Saturday, September 12');
    const open = s.querySelector('a.calendar-open-day')!;
    expect(open.textContent).toContain('Open day');
    expect(open.getAttribute('href')).toBe('#/day/2026-09-12');
    const lines = [...s.querySelectorAll('.calendar-summary-line')].map((l) => l.textContent);
    // A past day: done first, then the missed plan.
    expect(lines).toEqual(['bike · mountain60 min', 'weightLeg dayOverdue']);
    expect(s.querySelector('.calendar-summary-line .type-badge.badge-bike')).not.toBeNull();
    expect(s.querySelector('.calendar-summary-note')!.textContent).toBe(`Journal entry ${'A'.repeat(60)}…`);
    expect(s.querySelector('.calendar-summary-value')!.textContent).toBe('HRV 48 ms');
  });

  it('links today to #/ and says "Nothing recorded." on an empty day', () => {
    const { container } = renderAt('#/calendar');
    const s = summary(container);
    expect(s.querySelector('a.calendar-open-day')!.getAttribute('href')).toBe('#/');
    expect(s.textContent).toContain('Nothing recorded.');
  });

  // #347 AC2 regression guard: the Day view carries overdue plans onto today,
  // but the Calendar's summary of today lists only today's own workouts, and
  // the missed plan stays on its own day as Overdue.
  it("#347: today's summary does not carry an earlier missed plan; its own day still lists it", () => {
    workouts.value = [
      wk({ id: 'old', date: '2026-09-28', status: 'planned', name: 'Missed', type: 'weight' }),
      wk({ id: 'p', date: TODAY, status: 'planned', name: 'Today plan', type: 'weight' }),
    ];
    const { container } = renderAt('#/calendar');
    const lines = () => [...summary(container).querySelectorAll('.calendar-summary-line')].map((l) => l.textContent);
    expect(lines()).toEqual(['weightToday planPlanned']);
    fireEvent.click(cell(container, '2026-09-28'));
    expect(lines()).toEqual(['weightMissedOverdue']);
  });

  it("selects the 1st in a month that is not today's", () => {
    const { container } = renderAt('#/calendar/2025-01');
    expect(cell(container, '2025-01-01').getAttribute('aria-selected')).toBe('true');
  });

  it("moves to a neighbouring month's day when its cell is tapped, replacing, and selects it there", () => {
    const { container } = renderAt('#/calendar');
    const before = window.history.length;
    fireEvent.click(cells(container)[34]); // Sunday 4 October
    expect(window.location.hash).toBe('#/calendar/2026-10');
    expect(window.history.length).toBe(before);
    expect(container.querySelector('h1')!.textContent).toBe('October 2026');
    expect(cell(container, '2026-10-04').getAttribute('aria-selected')).toBe('true');
  });
});

describe('AC5 — moving between months', () => {
  it('Previous and Next month replace the URL and reset the selection', () => {
    const { getByRole, container } = renderAt('#/calendar');
    const before = window.history.length;
    fireEvent.click(getByRole('button', { name: 'Next month' }));
    expect(window.location.hash).toBe('#/calendar/2026-10');
    expect(cell(container, '2026-10-01').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(getByRole('button', { name: 'Previous month' }));
    expect(window.location.hash).toBe('#/calendar');
    expect(cell(container, TODAY).getAttribute('aria-selected')).toBe('true');
    expect(window.history.length).toBe(before);
    expect(currentRoute.value.name).toBe('calendar');
  });

  it('a touch swipe on the grid moves a month; a short one does not', () => {
    const { container } = renderAt('#/calendar');
    const grid = container.querySelector('[role="grid"]')!;
    pointer(grid, 'pointerdown', 200, 200, 1000);
    pointer(grid, 'pointerup', 120, 205, 1200);
    expect(window.location.hash).toBe('#/calendar/2026-10');
    pointer(grid, 'pointerdown', 200, 200, 2000);
    pointer(grid, 'pointerup', 170, 200, 2100);
    expect(window.location.hash).toBe('#/calendar/2026-10');
    pointer(grid, 'pointerdown', 100, 200, 3000);
    pointer(grid, 'pointerup', 200, 200, 3200);
    expect(window.location.hash).toBe('#/calendar');
  });
});

describe('helpers', () => {
  it('initialSelection is today in its month, else the 1st', () => {
    expect(initialSelection('2026-09', TODAY)).toBe(TODAY);
    expect(initialSelection('2026-08', TODAY)).toBe('2026-08-01');
  });
  it('notePreview keeps 60 characters and collapses whitespace', () => {
    expect(notePreview('short\n\nnote')).toBe('short note');
    expect(notePreview('x'.repeat(61))).toBe(`${'x'.repeat(60)}…`);
    expect(notePreview('x'.repeat(60))).toBe('x'.repeat(60));
  });
  it('cellLabel leaves the metric out when shading is off', () => {
    expect(cellLabel('2026-09-12', [], false, shadeChoices()[0], 50)).toBe('Saturday, September 12');
  });
});
