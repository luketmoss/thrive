import { describe, it, expect } from 'vitest';
import { groupSetsIntoExercises } from './exercise-detail';
import type { SetWithRow } from '../../api/types';

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

describe('groupSetsIntoExercises', () => {
  it('returns empty array for empty input', () => {
    expect(groupSetsIntoExercises([])).toEqual([]);
  });

  it('groups a single exercise with multiple sets', () => {
    const sets: SetWithRow[] = [
      makeSet({ set_number: 1, sheetRow: 2 }),
      makeSet({ set_number: 2, sheetRow: 3 }),
      makeSet({ set_number: 3, sheetRow: 4 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups).toHaveLength(1);
    expect(groups[0].exercise_id).toBe('ex1');
    expect(groups[0].exercise_name).toBe('Bench Press');
    expect(groups[0].section).toBe('primary');
    expect(groups[0].sets).toHaveLength(3);
  });

  it('sorts sets within a group by set_number', () => {
    const sets: SetWithRow[] = [
      makeSet({ set_number: 3, sheetRow: 4 }),
      makeSet({ set_number: 1, sheetRow: 2 }),
      makeSet({ set_number: 2, sheetRow: 3 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups[0].sets.map((s) => s.set_number)).toEqual([1, 2, 3]);
  });

  it('groups multiple exercises separately', () => {
    const sets: SetWithRow[] = [
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', exercise_order: 1, set_number: 1, sheetRow: 2 }),
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', exercise_order: 1, set_number: 2, sheetRow: 3 }),
      makeSet({ exercise_id: 'ex2', exercise_name: 'Squat', exercise_order: 2, set_number: 1, sheetRow: 4 }),
      makeSet({ exercise_id: 'ex2', exercise_name: 'Squat', exercise_order: 2, set_number: 2, sheetRow: 5 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups).toHaveLength(2);
    expect(groups[0].exercise_name).toBe('Bench Press');
    expect(groups[0].sets).toHaveLength(2);
    expect(groups[1].exercise_name).toBe('Squat');
    expect(groups[1].sets).toHaveLength(2);
  });

  it('sorts groups by exercise_order', () => {
    const sets: SetWithRow[] = [
      makeSet({ exercise_id: 'ex2', exercise_name: 'Squat', exercise_order: 3, set_number: 1, sheetRow: 4 }),
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', exercise_order: 1, set_number: 1, sheetRow: 2 }),
      makeSet({ exercise_id: 'ex3', exercise_name: 'Deadlift', exercise_order: 2, set_number: 1, sheetRow: 6 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups.map((g) => g.exercise_name)).toEqual(['Bench Press', 'Deadlift', 'Squat']);
  });

  it('treats same exercise at different exercise_order as separate groups', () => {
    // Same exercise appearing as warmup (order 1) and primary (order 3)
    const sets: SetWithRow[] = [
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'warmup', exercise_order: 1, set_number: 1, sheetRow: 2 }),
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 3, set_number: 1, sheetRow: 3 }),
      makeSet({ exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 3, set_number: 2, sheetRow: 4 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups).toHaveLength(2);
    expect(groups[0].section).toBe('warmup');
    expect(groups[0].sets).toHaveLength(1);
    expect(groups[1].section).toBe('primary');
    expect(groups[1].sets).toHaveLength(2);
  });

  it('preserves section labels per group', () => {
    const sets: SetWithRow[] = [
      makeSet({ exercise_id: 'ex1', section: 'SS1', exercise_order: 4, set_number: 1, sheetRow: 2 }),
      makeSet({ exercise_id: 'ex2', exercise_name: 'Cable Fly', section: 'SS1', exercise_order: 5, set_number: 1, sheetRow: 3 }),
      makeSet({ exercise_id: 'ex3', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 1, sheetRow: 4 }),
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups[0].section).toBe('SS1');
    expect(groups[1].section).toBe('SS1');
    expect(groups[2].section).toBe('burnout');
  });

  it('handles real demo data shape correctly', () => {
    // Simulate a subset of DEMO_SETS for w_demo001
    const sets: SetWithRow[] = [
      { workout_id: 'w_demo001', exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '15', effort: '', notes: '', sheetRow: 2 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'warmup', exercise_order: 2, set_number: 1, planned_reps: '', weight: '95', reps: '10', effort: 'Easy', notes: '', sheetRow: 3 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 4 },
      { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Medium', notes: '', sheetRow: 5 },
    ];

    const groups = groupSetsIntoExercises(sets);
    expect(groups).toHaveLength(3);

    // Warmup pushups
    expect(groups[0].exercise_name).toBe('Push Ups');
    expect(groups[0].section).toBe('warmup');
    expect(groups[0].sets).toHaveLength(1);

    // Warmup bench (different exercise_order from primary bench)
    expect(groups[1].exercise_name).toBe('Bench Press BB');
    expect(groups[1].section).toBe('warmup');
    expect(groups[1].sets).toHaveLength(1);

    // Primary bench
    expect(groups[2].exercise_name).toBe('Bench Press BB');
    expect(groups[2].section).toBe('primary');
    expect(groups[2].sets).toHaveLength(2);
  });
});
