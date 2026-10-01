// #238 — the Day screen's Training panel.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { TrainingPanel } from './training-panel';
import { SLOTS } from './slots';
import { workouts, sets } from '../../state/store';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';
import type { DayState } from '../../day/dates';

afterEach(cleanup);
beforeEach(() => {
  workouts.value = [];
  sets.value = [];
});

const D = '2026-09-30';

function wk(id: string, over: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id, date: D, time: '', type: 'weight', name: '', template_id: '', notes: '',
    elapsed_seconds: '', created: '', copied_from: '', status: '',
    moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '',
    fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '',
    sheetRow: 2, ...over,
  };
}
function st(workout_id: string, exercise_id: string, order: number, n: number): SetWithRow {
  return { workout_id, exercise_id, exercise_name: exercise_id, section: 'primary', exercise_order: order,
    set_number: n, planned_reps: '', weight: '', reps: '', effort: '', sheetRow: 2 };
}

function panel(state: DayState, date = D) {
  return render(<TrainingPanel date={date} state={state} today={D} />);
}
const names = (c: Element) => [...c.querySelectorAll('.workout-name')].map((e) => e.textContent);

describe('slot', () => {
  it('fills the training slot', () => {
    expect(SLOTS.training).toBe(TrainingPanel);
  });
});

describe('AC1 — past day', () => {
  it('lists done by time (untimed last), then missed with an Overdue pill', () => {
    workouts.value = [
      wk('a', { name: 'Late', time: '18:00' }),
      wk('p', { name: 'Missed', status: 'planned' }),
      wk('n', { name: 'Untimed' }),
      wk('b', { name: 'Early', time: '07:00', status: 'active' }),
      wk('x', { name: 'Other day', date: '2026-09-29' }),
    ];
    const { container } = panel('past', D);
    expect(names(container)).toEqual(['Early', 'Late', 'Untimed', 'Missed']);
    const missed = container.querySelectorAll('.training-card')[3];
    expect(missed.querySelector('.badge-overdue')!.textContent).toBe('Overdue');
    expect(container.querySelector('.badge-planned')).toBeNull();
  });

  it('says "No activities." with no Plan control when empty', () => {
    const { container } = panel('past');
    expect(container.querySelector('.panel-note')!.textContent).toBe('No activities.');
    expect(container.querySelector('a')).toBeNull();
  });

  it('never offers Plan, even with workouts', () => {
    workouts.value = [wk('a')];
    const { container } = panel('past');
    expect(container.querySelector('.day-panel-action')).toBeNull();
  });
});

describe('AC2 — today', () => {
  it('lists planned in sheet order with a Planned pill, then done by time', () => {
    workouts.value = [
      wk('d2', { name: 'Done late', time: '17:00' }),
      wk('p2', { name: 'Plan two', status: 'planned' }),
      wk('d1', { name: 'Done early', time: '06:00' }),
      wk('p1', { name: 'Plan one', status: 'planned' }),
    ];
    const { container } = panel('today');
    expect(names(container)).toEqual(['Plan two', 'Plan one', 'Done early', 'Done late']);
    expect(container.querySelector('.badge-planned')!.textContent).toBe('Planned');
    expect(container.querySelector('.badge-overdue')).toBeNull();
  });

  it('marks an active workout with an Active pill and no duration', () => {
    workouts.value = [wk('a', { status: 'active', name: 'Now' })];
    const { container } = panel('today');
    expect(container.querySelector('.badge-active')!.textContent).toBe('Active');
    expect(container.querySelector('.workout-meta')).toBeNull();
  });

  it('keeps a card in place when a refresh replaces the store (keyed by id)', () => {
    workouts.value = [wk('a', { name: 'One', time: '06:00' }), wk('b', { name: 'Two', time: '07:00' })];
    const { container } = panel('today');
    const before = container.querySelectorAll('a.training-card')[1];
    act(() => { workouts.value = workouts.value.map((w) => ({ ...w })); });
    expect(container.querySelectorAll('a.training-card')[1]).toBe(before);
  });

  it('says "Nothing planned today." with a Plan in Thrive button and no header action', () => {
    const { container } = panel('today');
    expect(container.querySelector('.panel-note')!.textContent).toBe('Nothing planned today.');
    const btn = container.querySelector('a.btn.btn-secondary')!;
    expect(btn.textContent).toBe('Plan in Thrive');
    expect(btn.getAttribute('href')).toBe(`#/workout/new?plan=${D}`);
    expect(container.querySelector('.day-panel-action')).toBeNull();
  });
});

describe('AC3 — future day', () => {
  const F = '2026-10-02';
  it('shows planned first, then an inconsistent done row', () => {
    workouts.value = [
      wk('d', { date: F, name: 'Odd', time: '08:00' }),
      wk('p', { date: F, name: 'Plan', status: 'planned' }),
    ];
    const { container } = panel('future', F);
    expect(names(container)).toEqual(['Plan', 'Odd']);
  });

  it('says "Nothing planned." with the button when empty', () => {
    const { container } = panel('future', F);
    expect(container.querySelector('.panel-note')!.textContent).toBe('Nothing planned.');
    expect(container.querySelector('a.btn')!.getAttribute('href')).toBe(`#/workout/new?plan=${F}`);
  });
});

describe('AC4 — header Plan action', () => {
  it('links Plan for the viewed date when there is something to show', () => {
    workouts.value = [wk('p', { status: 'planned' })];
    const { container } = panel('today');
    const a = container.querySelector('.day-panel-action a')!;
    expect(a.textContent).toBe('Plan');
    expect(a.getAttribute('href')).toBe(`#/workout/new?plan=${D}`);
    expect(container.querySelector('a.btn')).toBeNull();
  });
});

describe('AC5 — a card', () => {
  it('shows every set field, joined, with a readable effort pill', () => {
    workouts.value = [wk('r', {
      type: 'bike', sub_type: 'Mountain', name: 'Ride', time: '07:30',
      distance_m: '16093.4', moving_seconds: '3600', elapsed_seconds: '4200',
      ascent_m: '304.8', descent_m: '300', avg_hr: '140', effort: 'Hard',
    })];
    const { container } = panel('today');
    const card = container.querySelector('a.training-card')!;
    expect(card.getAttribute('href')).toBe('#/history/r');
    expect(card.querySelector('.training-type')!.textContent).toBe('bike · Mountain');
    const meta = card.querySelector('.workout-meta')!.textContent!;
    expect(meta).toContain('07:30');
    expect(meta).toContain('10 mi');
    expect(meta).toContain('60 min');
    expect(meta).not.toContain('70 min');
    expect(meta).toContain('↑ 1,000 ft');
    expect(meta).toContain('↓');
    expect(meta).toContain('140 bpm');
    const pill = card.querySelector('.workout-effort-hard')!;
    expect(pill.textContent).toBe('Hard');
    expect(pill.getAttribute('aria-hidden')).toBeNull();
  });

  it('falls back to elapsed time and omits blank fields and effort', () => {
    workouts.value = [wk('w', { elapsed_seconds: '1800', name: 'Lift' })];
    const { container } = panel('today');
    expect(container.querySelector('.workout-meta')!.textContent).toBe('30 min');
    expect(container.querySelector('.workout-effort')).toBeNull();
  });

  it('uses the type word when name is blank', () => {
    workouts.value = [wk('w', { type: 'hike' })];
    expect(names(panel('today').container)).toEqual(['hike']);
  });

  it('planned weight card shows counts and estimate; edit link', () => {
    workouts.value = [wk('p', { status: 'planned', name: 'Push', estimated_seconds: '2700' })];
    sets.value = [st('p', 'e1', 1, 1), st('p', 'e1', 1, 2), st('p', 'e2', 2, 1), st('other', 'e9', 1, 1)];
    const { container } = panel('today');
    const card = container.querySelector('a.training-card')!;
    expect(card.getAttribute('href')).toBe('#/history/p/edit');
    expect(card.querySelector('.workout-meta')!.textContent).toBe('2 exercises · 3 sets · about 45 min');
  });

  it('planned card with no sets and no estimate has no meta line; non-weight has no counts', () => {
    workouts.value = [wk('p', { status: 'planned' }), wk('q', { status: 'planned', type: 'bike' })];
    sets.value = [st('q', 'e1', 1, 1)];
    const { container } = panel('today');
    expect(container.querySelector('.workout-meta')).toBeNull();
  });

  it('renders a row with no id without a link, and does not drop it', () => {
    workouts.value = [wk('', { name: 'Hand edited' })];
    const { container } = panel('today');
    expect(names(container)).toEqual(['Hand edited']);
    expect(container.querySelector('a.training-card')).toBeNull();
  });
});
