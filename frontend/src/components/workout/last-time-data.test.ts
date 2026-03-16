import { describe, it, expect } from 'vitest';
import { getLastTimeDataFrom, formatLastTimeDate } from './last-time-data';
import type { SetWithRow, WorkoutWithRow } from '../../api/types';
import { toLocalDateStr } from '../activities/activities-helpers';

function makeSet(overrides: Partial<SetWithRow> = {}): SetWithRow {
  return {
    workout_id: 'w1',
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    set_number: 1,
    planned_reps: '8-10',
    weight: '135',
    reps: '10',
    effort: 'Medium',
    notes: '',
    sheetRow: 2,
    ...overrides,
  };
}

function makeWorkout(overrides: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id: 'w1',
    date: '2026-03-10',
    time: '07:00',
    type: 'weight',
    name: 'Push A',
    template_id: '',
    notes: '',
    duration_min: '60',
    created: '2026-03-10T07:00:00.000Z',
    copied_from: '',
    sheetRow: 2,
    ...overrides,
  };
}

// AC5: Data sourced from store — pure function filters correctly
describe('getLastTimeDataFrom', () => {
  // AC2: returns most recent workout's sets for the exercise
  it('returns sets from the most recent previous workout for the exercise', () => {
    const allSets: SetWithRow[] = [
      makeSet({ workout_id: 'w_old', set_number: 1, weight: '135', reps: '10', sheetRow: 2 }),
      makeSet({ workout_id: 'w_old', set_number: 2, weight: '135', reps: '8', sheetRow: 3 }),
      makeSet({ workout_id: 'w_recent', set_number: 1, weight: '185', reps: '6', sheetRow: 4 }),
      makeSet({ workout_id: 'w_recent', set_number: 2, weight: '185', reps: '5', sheetRow: 5 }),
      makeSet({ workout_id: 'w_recent', set_number: 3, weight: '185', reps: '5', effort: 'Hard', sheetRow: 6 }),
    ];
    const allWorkouts: WorkoutWithRow[] = [
      makeWorkout({ id: 'w_old', date: '2026-03-01' }),
      makeWorkout({ id: 'w_recent', date: '2026-03-10' }),
      makeWorkout({ id: 'w_current', date: '2026-03-15' }),
    ];

    const result = getLastTimeDataFrom('ex1', 'w_current', allSets, allWorkouts);
    expect(result).not.toBeNull();
    expect(result!.workoutDate).toBe('2026-03-10');
    expect(result!.sets).toHaveLength(3);
    expect(result!.sets[0].weight).toBe('185');
    expect(result!.sets[0].set_number).toBe(1);
  });

  // AC5: excludes the current workout
  it('excludes the current workout from results', () => {
    const allSets: SetWithRow[] = [
      makeSet({ workout_id: 'w_current', set_number: 1, weight: '200', sheetRow: 2 }),
      makeSet({ workout_id: 'w_prev', set_number: 1, weight: '185', sheetRow: 3 }),
    ];
    const allWorkouts: WorkoutWithRow[] = [
      makeWorkout({ id: 'w_current', date: '2026-03-15' }),
      makeWorkout({ id: 'w_prev', date: '2026-03-10' }),
    ];

    const result = getLastTimeDataFrom('ex1', 'w_current', allSets, allWorkouts);
    expect(result).not.toBeNull();
    expect(result!.workoutDate).toBe('2026-03-10');
    expect(result!.sets[0].weight).toBe('185');
  });

  // AC3: no previous data
  it('returns null when no previous sets exist for the exercise', () => {
    const allSets: SetWithRow[] = [
      makeSet({ workout_id: 'w_current', exercise_id: 'ex1', sheetRow: 2 }),
    ];
    const allWorkouts: WorkoutWithRow[] = [
      makeWorkout({ id: 'w_current', date: '2026-03-15' }),
    ];

    const result = getLastTimeDataFrom('ex1', 'w_current', allSets, allWorkouts);
    expect(result).toBeNull();
  });

  it('returns null when exercise has never been logged', () => {
    const result = getLastTimeDataFrom('ex_new', 'w_current', [], []);
    expect(result).toBeNull();
  });

  // AC2: sets sorted by set_number
  it('returns sets sorted by set_number', () => {
    const allSets: SetWithRow[] = [
      makeSet({ workout_id: 'w_prev', set_number: 3, sheetRow: 4 }),
      makeSet({ workout_id: 'w_prev', set_number: 1, sheetRow: 2 }),
      makeSet({ workout_id: 'w_prev', set_number: 2, sheetRow: 3 }),
    ];
    const allWorkouts: WorkoutWithRow[] = [
      makeWorkout({ id: 'w_prev', date: '2026-03-10' }),
      makeWorkout({ id: 'w_current', date: '2026-03-15' }),
    ];

    const result = getLastTimeDataFrom('ex1', 'w_current', allSets, allWorkouts);
    expect(result!.sets.map((s) => s.set_number)).toEqual([1, 2, 3]);
  });

  // Filters by exercise_id — other exercises excluded
  it('only includes sets for the requested exercise', () => {
    const allSets: SetWithRow[] = [
      makeSet({ workout_id: 'w_prev', exercise_id: 'ex1', set_number: 1, sheetRow: 2 }),
      makeSet({ workout_id: 'w_prev', exercise_id: 'ex2', set_number: 1, sheetRow: 3 }),
    ];
    const allWorkouts: WorkoutWithRow[] = [
      makeWorkout({ id: 'w_prev', date: '2026-03-10' }),
      makeWorkout({ id: 'w_current', date: '2026-03-15' }),
    ];

    const result = getLastTimeDataFrom('ex1', 'w_current', allSets, allWorkouts);
    expect(result!.sets).toHaveLength(1);
    expect(result!.sets[0].exercise_id).toBe('ex1');
  });

  // AC2 + AC5: works with demo data shape
  it('works with demo data shape', () => {
    const allSets: SetWithRow[] = [
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 4 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Medium', notes: '', sheetRow: 5 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Hard', notes: '', sheetRow: 6 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 4, planned_reps: '4-6', weight: '185', reps: '4', effort: 'Hard', notes: 'Last rep was a grinder', sheetRow: 7 },
    ];
    const allWorkouts: WorkoutWithRow[] = [
      { id: 'w_demo001', date: '2025-01-14', time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: '', duration_min: '62', created: '2025-01-14T06:30:00.000Z', copied_from: '', sheetRow: 2 },
    ];

    const result = getLastTimeDataFrom('ex_demo001', 'w_new', allSets, allWorkouts);
    expect(result).not.toBeNull();
    expect(result!.workoutDate).toBe('2025-01-14');
    expect(result!.sets).toHaveLength(4);
    expect(result!.sets[3].effort).toBe('Hard');
  });
});

// AC2: date formatting with relative age
describe('formatLastTimeDate', () => {
  it('formats a date with relative age', () => {
    // Use a fixed date far in the past so the test is stable
    const result = formatLastTimeDate('2020-01-15');
    expect(result).toMatch(/Jan 15, 2020/);
    expect(result).toMatch(/\(\d+ days ago\)/);
  });

  it('shows "today" for current date', () => {
    const dateStr = toLocalDateStr(new Date());
    const result = formatLastTimeDate(dateStr);
    expect(result).toContain('(today)');
  });

  it('shows "yesterday" for one day ago', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = toLocalDateStr(yesterday);
    const result = formatLastTimeDate(dateStr);
    expect(result).toContain('(yesterday)');
  });
});
