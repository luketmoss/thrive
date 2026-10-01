// #237 — the Day screen: AC1 (date and today), AC2 (header), AC3 (strip),
// AC4 (moves), AC5 (panels and when health loads).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';

const run = vi.fn(async (_t: string) => {});
const journalRun = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({
  healthRefresh: { run: (t: string) => run(t), markStarted: vi.fn() },
  journalRefresh: { run: (t: string) => journalRun(t), markStarted: vi.fn() },
  loadJournal: vi.fn(async () => {}),
  loadHealth: vi.fn(async () => {}),
}));

const { DayScreen } = await import('./day-screen');
const { AuthContext } = await import('../../auth/auth-context');
const { currentRoute, replaceRoute } = await import('../../router/router');
const { workouts } = await import('../../state/store');
const { today } = await import('../../day/today');
import type { WorkoutWithRow } from '../../api/types';

const TODAY = '2026-09-30'; // a Wednesday

function wk(id: string, date: string, status = ''): WorkoutWithRow {
  return { id, date, status } as WorkoutWithRow;
}

function renderAt(hash: string) {
  act(() => {
    window.history.replaceState(null, '', '#/activities');
    replaceRoute(hash);
  });
  return render(
    <AuthContext.Provider value={{ token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} }}>
      <DayScreen />
    </AuthContext.Provider>,
  );
}

function visible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const h1 = (c: Element) => c.querySelector('h1')!;
const status = (c: Element) => c.querySelector('p.sr-only[role="status"]')!.textContent;
const strip = (c: Element) => [...c.querySelectorAll<HTMLButtonElement>('.week-strip button')];
const panelTitles = (c: Element) => [...c.querySelectorAll('section.day-panel h2')].map((e) => e.textContent);

function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

function pointer(el: Element, type: string, x: number, y: number, t: number, pointerType = 'touch') {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerType, pointerId: 1, isPrimary: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'timeStamp', { value: t });
  act(() => {
    el.dispatchEvent(e);
  });
}

function swipe(el: Element, dx: number, dy = 0, ms = 200, pointerType = 'touch') {
  pointer(el, 'pointerdown', 200, 200, 1000, pointerType);
  pointer(el, 'pointerup', 200 + dx, 200 + dy, 1000 + ms, pointerType);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-09-30T18:00:00Z')); // noon in Denver
  today.value = TODAY;
  workouts.value = [];
  run.mockClear();
  journalRun.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AC1 — addressed by date, today in Denver', () => {
  it('shows today at #/', () => {
    const { container } = renderAt('#/');
    expect(h1(container).textContent).toBe('Wednesday, September 30, 2026');
    expect(container.querySelector('.day-pill')!.textContent).toBe('Today');
  });

  it('shows an explicit date in its state, and #/day/<today> as today', () => {
    const { container } = renderAt('#/day/2026-09-12');
    expect(h1(container).textContent).toBe('Saturday, September 12, 2026');
    expect(container.querySelector('.day-pill')!.textContent).toBe('3 weeks ago');
    cleanup();
    const again = renderAt('#/day/2026-09-30');
    expect(again.container.querySelector('.day-pill')!.textContent).toBe('Today');
  });

  it('moves #/ to the new today at midnight; keeps an explicit date and updates its pill', () => {
    const { container } = renderAt('#/');
    act(() => {
      vi.setSystemTime(new Date('2026-10-01T06:30:00Z')); // 00:30 on 1 Oct in Denver
      vi.advanceTimersByTime(60_000);
    });
    expect(h1(container).textContent).toBe('Thursday, October 1, 2026');
    expect(status(container)).toBe(''); // a rollover is not announced
    cleanup();

    vi.setSystemTime(new Date('2026-09-30T18:00:00Z'));
    today.value = TODAY;
    const other = renderAt('#/day/2026-09-30');
    act(() => {
      vi.setSystemTime(new Date('2026-10-01T06:30:00Z'));
      visible();
    });
    expect(h1(other.container).textContent).toBe('Wednesday, September 30, 2026');
    expect(other.container.querySelector('.day-pill')!.textContent).toBe('Yesterday');
  });

  it('moving between days replaces the history entry', () => {
    const { getByLabelText } = renderAt('#/');
    const before = window.history.length;
    for (let i = 0; i < 10; i++) fireEvent.click(getByLabelText('Next day'));
    expect(window.history.length).toBe(before);
    expect(window.location.hash).toBe('#/day/2026-10-10');
  });
});

describe('AC2 — header', () => {
  it('has one h1 naming the weekday, the whole date in sr-only text', () => {
    const { container } = renderAt('#/day/2026-09-12');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(h1(container).querySelector('.sr-only')!.textContent).toBe(', September 12, 2026');
    expect(h1(container).getAttribute('tabindex')).toBe('-1');
    expect(container.querySelector('.day-date')!.textContent).toContain('September 12, 2026');
  });

  it('shows Today only off today, before the arrows', () => {
    const on = renderAt('#/');
    expect(on.queryByText('Today', { selector: 'button' })).toBeNull();
    cleanup();
    const off = renderAt('#/day/2026-09-12');
    const buttons = [...off.container.querySelectorAll('.day-nav button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons).toEqual(['Today', 'Previous day', 'Next day', 'Calendar']);
  });

  it('ends the controls with a 44 px Calendar button that pushes to the viewed month (#241 AC1)', () => {
    const on = renderAt('#/');
    const onLabels = [...on.container.querySelectorAll('.day-nav button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(onLabels).toEqual(['Previous day', 'Next day', 'Calendar']);
    const cal = on.getByRole('button', { name: 'Calendar' });
    expect(cal.classList.contains('day-arrow')).toBe(true);
    fireEvent.click(cal);
    expect(window.location.hash).toBe('#/calendar');
    cleanup();
    const off = renderAt('#/day/2025-01-14');
    fireEvent.click(off.getByRole('button', { name: 'Calendar' }));
    expect(window.location.hash).toBe('#/calendar/2025-01');
  });

  it('writes the sun line in words, three nowrap items', () => {
    const { container } = renderAt('#/day/2026-09-27');
    expect(container.querySelector('.day-sun')!.textContent).toBe(
      'Sunrise 6:51 AM · Sunset 6:51 PM · 12h 00m of daylight (−3 min)',
    );
    expect(container.querySelectorAll('.day-sun > span')).toHaveLength(3);
  });

  it("uses the today pill's colours only on today", () => {
    const { container } = renderAt('#/');
    expect(container.querySelector('.day-pill')!.classList.contains('day-pill-today')).toBe(true);
    cleanup();
    const past = renderAt('#/day/2026-09-29');
    expect(past.container.querySelector('.day-pill')!.classList.contains('day-pill-today')).toBe(false);
  });
});

describe('AC3 — week strip', () => {
  it('shows Monday to Sunday as a labelled group, viewed day pressed, today current', () => {
    const { container } = renderAt('#/day/2026-10-02');
    const group = container.querySelector('.week-strip')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Week of September 28, 2026');
    const days = strip(container);
    expect(days.map((b) => b.querySelector('.week-day-letter')!.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(days.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'true', 'false', 'false']);
    expect(days.map((b) => b.getAttribute('aria-current'))).toEqual([null, null, 'date', null, null, null, null]);
    expect(days[2].classList.contains('week-day-today')).toBe(true);
    expect(days[4].classList.contains('week-day-viewed')).toBe(true);
  });

  it('marks both when today is the viewed day', () => {
    const { container } = renderAt('#/');
    const d = strip(container)[2];
    expect(d.classList.contains('week-day-today')).toBe(true);
    expect(d.classList.contains('week-day-viewed')).toBe(true);
    expect(d.getAttribute('aria-pressed')).toBe('true');
    expect(d.getAttribute('aria-current')).toBe('date');
  });

  it('draws dots then rings, three at most, and names every count', () => {
    workouts.value = [
      wk('a', '2026-09-29', 'planned'),
      wk('b', '2026-09-29'),
      wk('c', '2026-09-29', 'planned'),
      wk('d', '2026-09-29'),
      wk('e', '2026-09-28', 'planned'), // past and planned: still a ring
    ];
    const { container } = renderAt('#/');
    const [mon, tue, wed] = strip(container);
    expect([...tue.querySelectorAll('.week-mark')].map((m) => m.className)).toEqual([
      'week-mark week-mark-dot', 'week-mark week-mark-dot', 'week-mark week-mark-ring',
    ]);
    expect(tue.getAttribute('aria-label')).toBe('Tuesday, September 29 — 2 workouts done, 2 planned');
    expect(mon.querySelectorAll('.week-mark-ring')).toHaveLength(1);
    expect(wed.querySelectorAll('.week-mark')).toHaveLength(0);
    expect(wed.querySelector('.week-day-marks')).not.toBeNull();
    expect(wed.getAttribute('aria-label')).toBe('Wednesday, September 30');
  });

  it('shows a week crossing a year end', () => {
    const { container } = renderAt('#/day/2027-01-01');
    expect(container.querySelector('.week-strip')!.getAttribute('aria-label')).toBe('Week of December 28, 2026');
    expect(strip(container).map((b) => b.querySelector('.week-day-num')!.textContent)).toEqual(['28', '29', '30', '31', '1', '2', '3']);
    expect(strip(container)[6].getAttribute('aria-label')).toBe('Sunday, January 3');
  });
});

describe('AC4 — moving between days', () => {
  it('taps a strip day, the arrows and Today', () => {
    const { container, getByLabelText, getByText } = renderAt('#/');
    fireEvent.click(strip(container)[0]);
    expect(window.location.hash).toBe('#/day/2026-09-28');
    fireEvent.click(getByLabelText('Previous day'));
    expect(window.location.hash).toBe('#/day/2026-09-27');
    expect(strip(container)[6].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(getByLabelText('Next day'));
    expect(window.location.hash).toBe('#/day/2026-09-28');
    fireEvent.click(getByText('Today'));
    expect(window.location.hash).toBe('#/');
  });

  it('← / → move a day and t goes to today, but not in a text field, with modifiers or on repeat', () => {
    const { container } = renderAt('#/');
    key('ArrowLeft');
    expect(currentRoute.value.params.date).toBe('2026-09-29');
    key('ArrowRight');
    key('ArrowRight');
    expect(currentRoute.value.params.date).toBe('2026-10-01');
    key('t');
    expect(window.location.hash).toBe('#/');
    key('ArrowLeft', { ctrlKey: true });
    key('ArrowLeft', { altKey: true });
    key('ArrowLeft', { metaKey: true });
    key('ArrowLeft', { repeat: true });
    expect(window.location.hash).toBe('#/');
    const input = document.createElement('input');
    container.appendChild(input);
    key('ArrowLeft', {}, input);
    key('t', {}, input);
    expect(window.location.hash).toBe('#/');
  });

  it('t on today does nothing and announces nothing', () => {
    const { container } = renderAt('#/');
    key('t');
    expect(window.location.hash).toBe('#/');
    expect(status(container)).toBe('');
  });

  it('a touch swipe on the content moves a day; on the strip, a week', () => {
    const { container } = renderAt('#/');
    const panels = container.querySelector('.day-panels')!;
    swipe(panels, -80);
    expect(currentRoute.value.params.date).toBe('2026-10-01');
    swipe(panels, 80);
    swipe(panels, 80);
    expect(currentRoute.value.params.date).toBe('2026-09-29');
    swipe(container.querySelector('.week-strip button')!, -80);
    expect(currentRoute.value.params.date).toBe('2026-10-06');
    swipe(container.querySelector('.week-strip button')!, 80, 0, 200, 'pen');
    expect(currentRoute.value.params.date).toBe('2026-09-29');
  });

  it('ignores short, steep, slow and mouse swipes, and swipes from a text field', () => {
    const { container } = renderAt('#/');
    const panels = container.querySelector('.day-panels')!;
    swipe(panels, -60); // not more than 60 px
    swipe(panels, -80, 50); // 80 is not over 1.6 × 50
    swipe(panels, -80, 0, 900); // not under 900 ms
    swipe(panels, -200, 0, 200, 'mouse');
    const input = document.createElement('textarea');
    panels.appendChild(input);
    swipe(input, -200);
    expect(window.location.hash).toBe('#/');
  });

  it('swallows the click that ends a swipe', () => {
    const { container } = renderAt('#/');
    const monday = strip(container)[0];
    swipe(monday, -80);
    expect(currentRoute.value.params.date).toBe('2026-10-07');
    fireEvent.click(monday);
    expect(currentRoute.value.params.date).toBe('2026-10-07');
  });

  it('announces a move, politely, and not the first load', () => {
    const { container, getByLabelText } = renderAt('#/day/2026-09-22');
    const live = container.querySelector('p.sr-only[role="status"]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.classList.contains('sr-only')).toBe(true);
    expect(live.textContent).toBe('');
    fireEvent.click(getByLabelText('Previous day'));
    expect(live.textContent).toBe('Monday, September 21, 2026, 9 days ago');
  });

  it('keeps focus on the control that moved; Today used moves focus to the h1', () => {
    const { container, getByLabelText, getByText } = renderAt('#/day/2026-09-12');
    const next = getByLabelText('Next day') as HTMLButtonElement;
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(getByLabelText('Next day'));
    const day = strip(container)[3];
    day.focus();
    fireEvent.click(day);
    expect(document.activeElement).toBe(day);
    const todayBtn = getByText('Today') as HTMLButtonElement;
    todayBtn.focus();
    fireEvent.click(todayBtn);
    expect(window.location.hash).toBe('#/');
    expect(document.activeElement).toBe(h1(container));
  });
});

describe('AC5 — panels and health', () => {
  it('renders Training, Health, Body and Note on a past day and today; Training and Note on a future day', () => {
    const past = renderAt('#/day/2026-09-01');
    expect(panelTitles(past.container)).toEqual(['Training', 'Health', 'Body', 'Note']);
    cleanup();
    const now = renderAt('#/');
    expect(panelTitles(now.container)).toEqual(['Training', 'Health', 'Body', 'Note']);
    cleanup();
    const future = renderAt('#/day/2026-10-09');
    expect(panelTitles(future.container)).toEqual(['Training', 'Note']);
  });

  it('labels each section by its h2', () => {
    const { container } = renderAt('#/');
    for (const s of container.querySelectorAll('section.day-panel')) {
      const id = s.getAttribute('aria-labelledby')!;
      expect(s.querySelector('h2')!.id).toBe(id);
    }
  });

  it('mounts the panels fresh for every date', () => {
    const { container, getByLabelText } = renderAt('#/');
    const first = container.querySelector('section.day-panel');
    fireEvent.click(getByLabelText('Next day'));
    expect(container.querySelector('section.day-panel')).not.toBe(first);
  });

  it('loads health on show and on visible, never on a move', () => {
    const { getByLabelText } = renderAt('#/');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('tok');
    fireEvent.click(getByLabelText('Next day'));
    fireEvent.click(getByLabelText('Next day'));
    key('ArrowLeft');
    expect(run).toHaveBeenCalledTimes(1);
    visible();
    expect(run).toHaveBeenCalledTimes(2);
    cleanup();
    visible();
    expect(run).toHaveBeenCalledTimes(2); // not once the screen is gone
  });

  it('loads the journal on show and on visible, never on a move (#240 AC1)', () => {
    const { getByLabelText } = renderAt('#/');
    expect(journalRun).toHaveBeenCalledTimes(1);
    expect(journalRun).toHaveBeenCalledWith('tok');
    fireEvent.click(getByLabelText('Next day'));
    key('ArrowLeft');
    expect(journalRun).toHaveBeenCalledTimes(1);
    visible();
    expect(journalRun).toHaveBeenCalledTimes(2);
    cleanup();
    visible();
    expect(journalRun).toHaveBeenCalledTimes(2);
  });

  it('keeps the Start workout FAB', () => {
    const { getByLabelText } = renderAt('#/');
    fireEvent.click(getByLabelText('Start workout'));
    expect(window.location.hash).toBe('#/workout/new');
  });
});
