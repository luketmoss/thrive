// #347 — overdue planned workouts carried onto today's Training panel, with
// Move to today, Reschedule and Start now; planned cards open the detail view.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/preact';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';
import type { DayState } from '../../day/dates';

const rescheduleWorkout = vi.fn();
const startPlannedWorkout = vi.fn();
const navigate = vi.fn();
vi.mock('../../state/actions', () => ({
  rescheduleWorkout: (...a: unknown[]) => rescheduleWorkout(...a),
  startPlannedWorkout: (...a: unknown[]) => startPlannedWorkout(...a),
}));
vi.mock('../../router/router', () => ({ navigate: (p: string) => navigate(p) }));

const { TrainingPanel, trainingOrder, overdueForToday } = await import('./training-panel');
const { AuthContext } = await import('../../auth/auth-context');
const { workouts, sets, activeWorkoutId, toasts } = await import('../../state/store');

const D = '2026-09-30'; // today

function wk(id: string, over: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id, date: D, time: '', type: 'weight', name: '', template_id: '', notes: '',
    elapsed_seconds: '', created: '', copied_from: '', status: '',
    moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '',
    fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '',
    sheetRow: 2, ...over,
  };
}
function st(workout_id: string, exercise_id: string, order: number, n: number): SetWithRow {
  return { workout_id, exercise_id, exercise_name: exercise_id, section: 'primary', exercise_order: order,
    set_number: n, planned_reps: '', weight: '', reps: '', effort: '', sheetRow: 2 };
}

/** The real action's effect on the store: the date written in place. */
function moveInStore(id: string, date: string) {
  workouts.value = workouts.value.map((w) => (w.id === id ? { ...w, date } : w));
}

function panel(state: DayState = 'today', date = D) {
  return render(
    <AuthContext.Provider value={{ token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} }}>
      <TrainingPanel date={date} state={state} today={D} />
    </AuthContext.Provider>,
  );
}
const names = (c: Element) => [...c.querySelectorAll('.workout-name')].map((e) => e.textContent);
const button = (c: Element, label: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

afterEach(cleanup);
beforeEach(() => {
  workouts.value = [];
  sets.value = [];
  activeWorkoutId.value = null;
  toasts.value = [];
  rescheduleWorkout.mockReset();
  rescheduleWorkout.mockImplementation(async (id: string, date: string) => moveInStore(id, date));
  startPlannedWorkout.mockReset();
  startPlannedWorkout.mockImplementation(async (id: string) => id);
  navigate.mockReset();
});

describe('overdueForToday', () => {
  it('keeps planned rows dated before today, oldest first, equal dates in sheet order', () => {
    const all = [
      wk('b2', { date: '2026-09-28', status: 'planned' }),
      wk('today', { status: 'planned' }),
      wk('a', { date: '2026-09-20', status: 'planned' }),
      wk('done', { date: '2026-09-20' }),
      wk('active', { date: '2026-09-21', status: 'active' }),
      wk('completed', { date: '2026-09-21', status: 'completed' }),
      wk('b1', { date: '2026-09-28', status: 'planned' }),
      wk('future', { date: '2026-10-02', status: 'planned' }),
    ];
    expect(overdueForToday(all, D).map((w) => w.id)).toEqual(['a', 'b2', 'b1']);
  });
});

describe('AC1 — overdue plans are carried onto today, above its own', () => {
  it('lists carried cards first, then today\'s planned, then done, with Overdue and the planned date', () => {
    workouts.value = [
      wk('d', { name: 'Done', time: '06:00' }),
      wk('p', { name: 'Today plan', status: 'planned' }),
      wk('y', { name: 'Yesterday plan', status: 'planned', date: '2026-09-29' }),
      wk('o', { name: 'Old plan', status: 'planned', date: '2026-09-20', estimated_seconds: '2700' }),
    ];
    sets.value = [st('o', 'e1', 1, 1), st('o', 'e1', 1, 2)];
    const { container } = panel();
    expect(names(container)).toEqual(['Old plan', 'Yesterday plan', 'Today plan', 'Done']);
    const carried = [...container.querySelectorAll('.training-overdue')];
    expect(carried).toHaveLength(2);
    expect(carried[0].querySelector('.badge-overdue')!.textContent).toBe('Overdue');
    expect(carried[0].querySelector('.training-type')!.textContent).toBe('weight');
    expect(carried[0].querySelector('.workout-meta')!.textContent).toBe('1 exercise · 2 sets · about 45 min');
    expect(carried[0].querySelector('.training-planned-for')!.textContent).toBe('Planned Sep 20');
    expect(carried[1].querySelector('.training-planned-for')!.textContent).toBe('Planned Yesterday');
    // Today's own plan keeps its Planned badge and no actions.
    const own = [...container.querySelectorAll('.training-list > a')].find((a) => a.textContent!.includes('Today plan'))!;
    expect(own.querySelector('.badge-planned')).not.toBeNull();
  });

  it('replaces "Nothing planned today." with the list and the header Plan link', () => {
    workouts.value = [wk('o', { name: 'Old', status: 'planned', date: '2026-09-25' })];
    const { container } = panel();
    expect(container.querySelector('.panel-note')).toBeNull();
    expect(container.querySelector('.training-plan-btn')).toBeNull();
    expect(container.querySelector('.day-panel-action a')!.textContent).toBe('Plan');
    expect(names(container)).toEqual(['Old']);
  });

  it('never carries a past-dated row whose status is not planned', () => {
    workouts.value = [
      wk('a', { name: 'Active', status: 'active', date: '2026-09-29' }),
      wk('c', { name: 'Completed', status: 'completed', date: '2026-09-29' }),
      wk('b', { name: 'Blank', date: '2026-09-29' }),
    ];
    const { container } = panel();
    expect(container.querySelector('.panel-note')!.textContent).toBe('Nothing planned today.');
  });
});

describe('AC2 — regression guards', () => {
  const day = [
    wk('d2', { name: 'Done late', time: '17:00' }),
    wk('p2', { name: 'Plan two', status: 'planned' }),
    wk('d1', { name: 'Done early', time: '06:00', status: 'active' }),
    wk('n', { name: 'Untimed' }),
    wk('p1', { name: 'Plan one', status: 'planned' }),
  ];
  const order = (s: DayState) => trainingOrder(day, s).map(({ w, kind }) => `${w.id}:${kind}`);

  it('trainingOrder returns exactly what it did before #347', () => {
    expect(order('past')).toEqual(['d1:done', 'd2:done', 'n:done', 'p2:overdue', 'p1:overdue']);
    expect(order('today')).toEqual(['p2:planned', 'p1:planned', 'd1:done', 'd2:done', 'n:done']);
    expect(order('future')).toEqual(['p2:planned', 'p1:planned', 'd1:done', 'd2:done', 'n:done']);
    expect(trainingOrder([], 'today')).toEqual([]);
  });

  it('a past day still lists its missed plan as Overdue after done, with no action buttons', () => {
    const P = '2026-09-28';
    workouts.value = [wk('m', { name: 'Missed', status: 'planned', date: P }), wk('d', { name: 'Done', date: P })];
    const { container } = panel('past', P);
    expect(names(container)).toEqual(['Done', 'Missed']);
    expect(container.querySelector('.badge-overdue')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.training-overdue')).toBeNull();
  });

  it('the same workout is on its own day and on today until acted on', () => {
    const P = '2026-09-28';
    workouts.value = [wk('m', { name: 'Missed', status: 'planned', date: P })];
    expect(names(panel('past', P).container)).toEqual(['Missed']);
    cleanup();
    expect(names(panel('today').container)).toEqual(['Missed']);
  });

  it('a future day shows no overdue workouts', () => {
    const F = '2026-10-02';
    workouts.value = [wk('m', { name: 'Missed', status: 'planned', date: '2026-09-28' })];
    const { container } = panel('future', F);
    expect(container.querySelector('.panel-note')!.textContent).toBe('Nothing planned.');
    expect(container.querySelector('.badge-overdue')).toBeNull();
  });
});

describe('AC3 — Move to today', () => {
  it('writes today in place through rescheduleWorkout and focuses the card among today\'s plans', async () => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
    const { container } = panel();
    fireEvent.click(button(container, 'Move to today'));
    await flush();
    expect(rescheduleWorkout).toHaveBeenCalledWith('o', D, 'tok', D);
    expect(container.querySelector('.training-overdue')).toBeNull();
    const card = container.querySelector<HTMLAnchorElement>('a.training-card')!;
    expect(card.querySelector('.badge-planned')).not.toBeNull();
    expect(document.activeElement).toBe(card);
  });
});

describe('AC4 — Reschedule', () => {
  beforeEach(() => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
  });

  it('opens a labelled date field pre-filled with today, replacing the actions row, and focuses it', async () => {
    const { container, getByLabelText } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    const input = getByLabelText('New date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe(D);
    expect(container.querySelector(`label[for="${input.id}"]`)!.textContent).toBe('New date');
    expect(document.activeElement).toBe(input);
    expect(button(container, 'Move to today')).toBeUndefined();
    expect(button(container, 'Start now')).toBeUndefined();
    expect(button(container, 'Save')).toBeDefined();
    expect(button(container, 'Cancel')).toBeDefined();
  });

  it('saves a future date, leaves today, and focuses the panel heading', async () => {
    const { container, getByLabelText } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.input(getByLabelText('New date'), { target: { value: '2026-10-03' } });
    fireEvent.click(button(container, 'Save'));
    await flush();
    expect(rescheduleWorkout).toHaveBeenCalledWith('o', '2026-10-03', 'tok', D);
    expect(container.querySelector('.panel-note')!.textContent).toBe('Nothing planned today.');
    expect(document.activeElement).toBe(container.querySelector('.day-panel-title'));
  });

  it('saving today behaves as Move to today', async () => {
    const { container } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.click(button(container, 'Save'));
    await flush();
    expect(rescheduleWorkout).toHaveBeenCalledWith('o', D, 'tok', D);
    expect(document.activeElement).toBe(container.querySelector('a.training-card'));
  });

  it('a past date is allowed and the workout stays carried with its new date', async () => {
    const { container, getByLabelText } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.input(getByLabelText('New date'), { target: { value: '2026-09-29' } });
    fireEvent.click(button(container, 'Save'));
    await flush();
    expect(rescheduleWorkout).toHaveBeenCalledWith('o', '2026-09-29', 'tok', D);
    expect(container.querySelector('.training-planned-for')!.textContent).toBe('Planned Yesterday');
    expect(button(container, 'Move to today')).toBeDefined();
  });

  it('Save is disabled while empty or on the current date', async () => {
    const { container, getByLabelText } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.input(getByLabelText('New date'), { target: { value: '' } });
    expect(button(container, 'Save').disabled).toBe(true);
    fireEvent.input(getByLabelText('New date'), { target: { value: '2026-09-27' } });
    expect(button(container, 'Save').disabled).toBe(true);
    fireEvent.click(button(container, 'Save'));
    expect(rescheduleWorkout).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close without writing and return focus to Reschedule', async () => {
    const { container, getByLabelText } = panel();
    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.click(button(container, 'Cancel'));
    await flush();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(document.activeElement).toBe(button(container, 'Reschedule'));

    fireEvent.click(button(container, 'Reschedule'));
    await flush();
    fireEvent.keyDown(getByLabelText('New date'), { key: 'Escape' });
    await flush();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(document.activeElement).toBe(button(container, 'Reschedule'));
    expect(rescheduleWorkout).not.toHaveBeenCalled();
  });
});

describe('AC5 — Start now', () => {
  it('starts through startPlannedWorkout and goes to the workout', async () => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
    const { container } = panel();
    fireEvent.click(button(container, 'Start now'));
    await flush();
    expect(startPlannedWorkout).toHaveBeenCalledWith('o', 'tok');
    expect(navigate).toHaveBeenCalledWith('/workout/o');
  });

  it('refuses while another workout is active, writing nothing', async () => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
    activeWorkoutId.value = 'other';
    const { container } = panel();
    fireEvent.click(button(container, 'Start now'));
    await flush();
    expect(startPlannedWorkout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(toasts.value.map((t) => t.text)).toContain('Finish your current workout before starting a new one');
  });
});

describe('AC6 — in flight and failure', () => {
  beforeEach(() => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
  });

  it('disables the card\'s buttons and relabels the pressed one while a move is in flight; re-enables on failure', async () => {
    let fail!: (e: Error) => void;
    rescheduleWorkout.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const { container } = panel();
    fireEvent.click(button(container, 'Move to today'));
    await flush();
    const busy = button(container, 'Moving…');
    expect(busy.disabled).toBe(true);
    expect(button(container, 'Reschedule').disabled).toBe(true);
    expect(button(container, 'Start now').disabled).toBe(true);
    await act(async () => { fail(new Error('boom')); });
    await flush();
    expect(button(container, 'Move to today').disabled).toBe(false);
    expect(container.querySelector('.training-overdue')).not.toBeNull();
  });

  it('reads "Starting…" and "Saving…" while those are in flight', async () => {
    startPlannedWorkout.mockImplementation(() => new Promise(() => {}));
    const { container } = panel();
    fireEvent.click(button(container, 'Start now'));
    await flush();
    expect(button(container, 'Starting…').disabled).toBe(true);
    cleanup();

    rescheduleWorkout.mockImplementation(() => new Promise(() => {}));
    const second = panel();
    fireEvent.click(button(second.container, 'Reschedule'));
    await flush();
    fireEvent.input(second.getByLabelText('New date'), { target: { value: '2026-10-05' } });
    fireEvent.click(button(second.container, 'Save'));
    await flush();
    expect(button(second.container, 'Saving…').disabled).toBe(true);
    expect(button(second.container, 'Cancel').disabled).toBe(true);
  });
});

describe('AC7 — cards open the detail view; buttons sit beside the link', () => {
  it('links planned and overdue cards to #/history/:id on any day, done cards unchanged', () => {
    workouts.value = [
      wk('o', { status: 'planned', date: '2026-09-27' }),
      wk('p', { status: 'planned' }),
      wk('d', {}),
    ];
    const { container } = panel();
    const hrefs = [...container.querySelectorAll('a.training-card')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/history/o', '#/history/p', '#/history/d']);
    cleanup();
    const past = panel('past', '2026-09-27').container;
    expect(past.querySelector('a.training-card')!.getAttribute('href')).toBe('#/history/o');
  });

  it('never nests a button in the link, and tabs link then Move, Reschedule, Start', () => {
    workouts.value = [wk('o', { name: 'Pull', status: 'planned', date: '2026-09-27' })];
    const { container } = panel();
    const unit = container.querySelector('.training-overdue')!;
    expect(unit.querySelector('a button')).toBeNull();
    const stops = [...unit.querySelectorAll('a, button')].map((el) => el.tagName === 'A' ? 'link' : el.textContent);
    expect(stops).toEqual(['link', 'Move to today', 'Reschedule', 'Start now']);
  });

  it('a carried row with no id is not a link and has no actions', () => {
    workouts.value = [wk('', { name: 'Hand edited', status: 'planned', date: '2026-09-27' })];
    const { container } = panel();
    expect(names(container)).toEqual(['Hand edited']);
    expect(container.querySelector('a.training-card')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.badge-overdue')).not.toBeNull();
  });
});

describe('AC9 — one unit, calm, named buttons', () => {
  it('wraps link and actions in one unit, all secondary, each named for its workout', () => {
    workouts.value = [
      wk('a', { name: 'Upper Pull A', status: 'planned', date: '2026-09-27' }),
      wk('b', { type: 'bike', status: 'planned', date: '2026-09-28' }),
    ];
    const { container } = panel();
    const units = [...container.querySelectorAll('.training-overdue')];
    expect(units).toHaveLength(2);
    expect(units[0].firstElementChild!.matches('a.training-overdue-link')).toBe(true);
    const buttons = [...container.querySelectorAll('button')];
    for (const b of buttons) {
      expect(b.classList.contains('btn-secondary')).toBe(true);
      expect(b.classList.contains('btn-primary')).toBe(false);
      expect(b.getAttribute('aria-label')!.startsWith(b.textContent!)).toBe(true);
    }
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move to today: Upper Pull A', 'Reschedule: Upper Pull A', 'Start now: Upper Pull A',
      'Move to today: bike', 'Reschedule: bike', 'Start now: bike',
    ]);
  });
});
