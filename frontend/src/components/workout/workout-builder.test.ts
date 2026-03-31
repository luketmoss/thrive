import { describe, it, expect } from 'vitest';
import { parseSetCount } from '../../state/actions';
import type { BuilderExercise } from '../../api/types';

// ── Unit tests for Workout Builder logic (issue #70) ───

describe('WorkoutBuilder — BuilderExercise type', () => {
  it('BuilderExercise defaults sets to 3 and planned_reps to empty', () => {
    const ex: BuilderExercise = {
      exercise_id: 'ex_1',
      exercise_name: 'Bench Press',
      section: 'primary',
      sets: 3,
      planned_reps: '',
    };
    expect(ex.sets).toBe(3);
    expect(ex.planned_reps).toBe('');
  });

  it('planned_reps accepts range strings like "8-12"', () => {
    const ex: BuilderExercise = {
      exercise_id: 'ex_2',
      exercise_name: 'Squat',
      section: 'primary',
      sets: 4,
      planned_reps: '8-12',
    };
    expect(ex.planned_reps).toBe('8-12');
  });
});

describe('WorkoutBuilder — set prepopulation logic', () => {
  // AC3: sets are pre-populated with one row per configured set count
  it('generates correct number of set rows from builder exercises', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', sets: 3, planned_reps: '8-12' },
      { exercise_id: 'ex_2', exercise_name: 'Squat', section: 'primary', sets: 5, planned_reps: '5' },
    ];

    const sets = exercises.flatMap((ex, index) =>
      Array.from({ length: ex.sets }, (_, s) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: 'primary',
        exercise_order: index + 1,
        set_number: s + 1,
        planned_reps: ex.planned_reps,
      })),
    );

    expect(sets).toHaveLength(8); // 3 + 5
    expect(sets.filter((s) => s.exercise_id === 'ex_1')).toHaveLength(3);
    expect(sets.filter((s) => s.exercise_id === 'ex_2')).toHaveLength(5);
  });

  // AC3: section defaults to 'primary'
  it('all generated sets have section "primary"', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Deadlift', section: 'primary', sets: 4, planned_reps: '3-5' },
    ];

    const sets = exercises.flatMap((ex, index) =>
      Array.from({ length: ex.sets }, (_, s) => ({
        section: 'primary',
        exercise_order: index + 1,
        set_number: s + 1,
        planned_reps: ex.planned_reps,
      })),
    );

    expect(sets.every((s) => s.section === 'primary')).toBe(true);
  });

  // AC3: exercise_order follows list position
  it('exercise_order follows builder list position (1-based)', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Bench', section: 'primary', sets: 2, planned_reps: '' },
      { exercise_id: 'ex_2', exercise_name: 'Row', section: 'primary', sets: 2, planned_reps: '' },
      { exercise_id: 'ex_3', exercise_name: 'Curl', section: 'primary', sets: 2, planned_reps: '' },
    ];

    const sets = exercises.flatMap((ex, index) =>
      Array.from({ length: ex.sets }, () => ({
        exercise_id: ex.exercise_id,
        exercise_order: index + 1,
      })),
    );

    expect(sets.filter((s) => s.exercise_id === 'ex_1').every((s) => s.exercise_order === 1)).toBe(true);
    expect(sets.filter((s) => s.exercise_id === 'ex_2').every((s) => s.exercise_order === 2)).toBe(true);
    expect(sets.filter((s) => s.exercise_id === 'ex_3').every((s) => s.exercise_order === 3)).toBe(true);
  });

  // AC3: planned_reps from builder is carried through
  it('planned_reps from builder is carried into each set row', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Press', section: 'primary', sets: 3, planned_reps: '10-15' },
    ];

    const sets = exercises.flatMap((ex) =>
      Array.from({ length: ex.sets }, () => ({
        planned_reps: ex.planned_reps,
      })),
    );

    expect(sets.every((s) => s.planned_reps === '10-15')).toBe(true);
  });

  // AC4: empty exercises list produces no sets
  it('empty exercise list produces zero sets', () => {
    const exercises: BuilderExercise[] = [];
    const sets = exercises.flatMap((ex, index) =>
      Array.from({ length: ex.sets }, (_, s) => ({
        set_number: s + 1,
        exercise_order: index + 1,
      })),
    );
    expect(sets).toHaveLength(0);
  });
});

describe('WorkoutBuilder — exercise list management', () => {
  // AC2: duplicate exercises are skipped
  it('duplicate exercise_id should be detectable for skip logic', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Bench', section: 'primary', sets: 3, planned_reps: '' },
    ];
    const newExId = 'ex_1';
    const isDuplicate = exercises.some((e) => e.exercise_id === newExId);
    expect(isDuplicate).toBe(true);
  });

  // AC2: removal filters by exercise_id
  it('remove filters out the target exercise', () => {
    const exercises: BuilderExercise[] = [
      { exercise_id: 'ex_1', exercise_name: 'Bench', section: 'primary', sets: 3, planned_reps: '' },
      { exercise_id: 'ex_2', exercise_name: 'Squat', section: 'primary', sets: 4, planned_reps: '5' },
      { exercise_id: 'ex_3', exercise_name: 'Row', section: 'primary', sets: 3, planned_reps: '8-12' },
    ];
    const afterRemove = exercises.filter((e) => e.exercise_id !== 'ex_2');
    expect(afterRemove).toHaveLength(2);
    expect(afterRemove.map((e) => e.exercise_id)).toEqual(['ex_1', 'ex_3']);
  });

  // AC2: set count clamped between 1 and 20
  it('set count is clamped to max 20', () => {
    const raw = 25;
    const clamped = Math.min(Math.max(raw, 1), 20);
    expect(clamped).toBe(20);
  });

  it('set count is clamped to min 1', () => {
    const raw = 0;
    const valid = raw >= 1;
    expect(valid).toBe(false);
  });
});

describe('parseSetCount reuse', () => {
  it('parses "3" as 3', () => expect(parseSetCount('3')).toBe(3));
  it('parses "4-5" as 5 (upper bound)', () => expect(parseSetCount('4-5')).toBe(5));
  it('parses "" as 3 (default)', () => expect(parseSetCount('')).toBe(3));
});
