import { describe, it, expect } from 'vitest';
import { buildExerciseList, mergeWarmups } from './build-exercise-list';
import type { TrackerExercise } from './exercise-row';
import type { SetWithRow } from '../../api/types';

function makeSetRow(overrides: Partial<SetWithRow> = {}): SetWithRow {
  return {
    workout_id: 'w1',
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    set_number: 1,
    planned_reps: '8-10',
    weight: '',
    reps: '',
    effort: '',
    notes: '',
    sheetRow: 2,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<TrackerExercise> = {}): TrackerExercise {
  return {
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    sets: [],
    quickFillWeight: '',
    quickFillReps: '',
    quickFillEffort: '',
    ...overrides,
  };
}

describe('buildExerciseList', () => {
  it('groups set rows by exercise_id + exercise_order', () => {
    const rows = [
      makeSetRow({ exercise_id: 'ex1', exercise_order: 1, set_number: 1 }),
      makeSetRow({ exercise_id: 'ex1', exercise_order: 1, set_number: 2 }),
      makeSetRow({ exercise_id: 'ex2', exercise_name: 'Squat', exercise_order: 2, set_number: 1 }),
    ];
    const result = buildExerciseList(rows);
    expect(result).toHaveLength(2);
    expect(result[0].sets).toHaveLength(2);
    expect(result[1].sets).toHaveLength(1);
  });

  it('includes warmup set rows as exercises', () => {
    const rows = [
      makeSetRow({ exercise_id: 'w1', exercise_name: 'Arm Circles', section: 'warmup', exercise_order: 1, set_number: 1 }),
    ];
    const result = buildExerciseList(rows);
    expect(result).toHaveLength(1);
    expect(result[0].section).toBe('warmup');
    expect(result[0].sets).toHaveLength(1);
  });
});

describe('mergeWarmups', () => {
  // AC1 & AC2: No duplicate warmups
  it('skips warmup metadata that already exists in tracked exercises', () => {
    const tracked = [
      makeExercise({
        exercise_id: 'w1',
        exercise_name: 'Arm Circles',
        section: 'warmup',
        exercise_order: 1,
        sets: [{ set_number: 1, planned_reps: '', weight: '', reps: '', effort: '', notes: '', saved: true, sheetRow: 2 }],
      }),
      makeExercise({ exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 2 }),
    ];
    const warmupInfos = [
      { exercise_id: 'w1', exercise_name: 'Arm Circles', exercise_order: 1 },
    ];

    const result = mergeWarmups(tracked, warmupInfos);
    const warmups = result.filter((e) => e.exercise_id === 'w1');
    expect(warmups).toHaveLength(1);
    expect(warmups[0].sets).toHaveLength(1); // keeps the tracked version with sets
  });

  // AC3: Deletion integrity — each exercise has unique identity in merged list
  it('produces exercises with unique exercise_id + exercise_order keys', () => {
    const tracked = [
      makeExercise({ exercise_id: 'w1', section: 'warmup', exercise_order: 1 }),
      makeExercise({ exercise_id: 'ex1', section: 'primary', exercise_order: 2 }),
    ];
    const warmupInfos = [
      { exercise_id: 'w1', exercise_name: 'Arm Circles', exercise_order: 1 },
    ];

    const result = mergeWarmups(tracked, warmupInfos);
    const keys = result.map((e) => `${e.exercise_id}__${e.exercise_order}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // AC4: Warmup-only templates
  it('adds warmup metadata when no tracked exercises exist', () => {
    const tracked: TrackerExercise[] = [];
    const warmupInfos = [
      { exercise_id: 'w1', exercise_name: 'Arm Circles', exercise_order: 1 },
      { exercise_id: 'w2', exercise_name: 'Leg Swings', exercise_order: 2 },
    ];

    const result = mergeWarmups(tracked, warmupInfos);
    expect(result).toHaveLength(2);
    expect(result[0].section).toBe('warmup');
    expect(result[1].section).toBe('warmup');
  });

  // AC5: Edit mode — same merge logic, warmups from set rows already tracked
  it('handles edit mode where warmups are already in tracked from persisted sets', () => {
    const tracked = [
      makeExercise({
        exercise_id: 'w1',
        exercise_name: 'Arm Circles',
        section: 'warmup',
        exercise_order: 1,
        sets: [{ set_number: 1, planned_reps: '', weight: '', reps: '', effort: '', notes: '', saved: true, sheetRow: 5 }],
      }),
      makeExercise({
        exercise_id: 'w2',
        exercise_name: 'Leg Swings',
        section: 'warmup',
        exercise_order: 2,
        sets: [{ set_number: 1, planned_reps: '', weight: '', reps: '', effort: '', notes: '', saved: true, sheetRow: 6 }],
      }),
      makeExercise({ exercise_id: 'ex1', section: 'primary', exercise_order: 3 }),
    ];
    const warmupInfos = [
      { exercise_id: 'w1', exercise_name: 'Arm Circles', exercise_order: 1 },
      { exercise_id: 'w2', exercise_name: 'Leg Swings', exercise_order: 2 },
    ];

    const result = mergeWarmups(tracked, warmupInfos);
    expect(result).toHaveLength(3);
    expect(result.filter((e) => e.section === 'warmup')).toHaveLength(2);
  });

  it('preserves sort order by exercise_order', () => {
    const tracked = [
      makeExercise({ exercise_id: 'ex1', section: 'primary', exercise_order: 3 }),
    ];
    const warmupInfos = [
      { exercise_id: 'w1', exercise_name: 'Arm Circles', exercise_order: 1 },
    ];

    const result = mergeWarmups(tracked, warmupInfos);
    expect(result[0].exercise_order).toBe(1);
    expect(result[1].exercise_order).toBe(3);
  });
});
