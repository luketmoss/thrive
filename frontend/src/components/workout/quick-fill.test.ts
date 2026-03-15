import { describe, it, expect } from 'vitest';
import { applyQuickFillWeight, applyQuickFillReps } from './quick-fill';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';

function makeSet(overrides: Partial<TrackerSet> = {}): TrackerSet {
  return {
    set_number: 1,
    planned_reps: '8-10',
    weight: '',
    reps: '',
    effort: '',
    notes: '',
    saved: false,
    sheetRow: -1,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<TrackerExercise> = {}): TrackerExercise {
  return {
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    sets: [makeSet({ set_number: 1 }), makeSet({ set_number: 2 }), makeSet({ set_number: 3 })],
    quickFillWeight: '',
    quickFillReps: '',
    ...overrides,
  };
}

describe('applyQuickFillWeight', () => {
  // AC1: Quick fill overwrites pre-filled set weights
  it('overwrites pre-filled set weights with new value', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, weight: '135', saved: true, sheetRow: 2 }),
        makeSet({ set_number: 2, weight: '135', saved: true, sheetRow: 3 }),
        makeSet({ set_number: 3, weight: '140', saved: true, sheetRow: 4 }),
      ],
    })];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '155');

    expect(result[0].quickFillWeight).toBe('155');
    expect(result[0].sets[0].weight).toBe('155');
    expect(result[0].sets[1].weight).toBe('155');
    expect(result[0].sets[2].weight).toBe('155');
    // Overwritten sets should be marked unsaved
    expect(result[0].sets[0].saved).toBe(false);
    expect(result[0].sets[1].saved).toBe(false);
    expect(result[0].sets[2].saved).toBe(false);
  });

  // AC2: Quick fill still works on fresh (empty) sets
  it('fills empty sets with weight value', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, weight: '' }),
        makeSet({ set_number: 2, weight: '' }),
      ],
    })];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '185');

    expect(result[0].sets[0].weight).toBe('185');
    expect(result[0].sets[1].weight).toBe('185');
  });

  // AC3: Clearing quick fill does not wipe individual set weights
  it('does not clear existing set weights when quick fill is cleared', () => {
    const exercises = [makeExercise({
      quickFillWeight: '135',
      sets: [
        makeSet({ set_number: 1, weight: '135', saved: true, sheetRow: 2 }),
        makeSet({ set_number: 2, weight: '135', saved: true, sheetRow: 3 }),
      ],
    })];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '');

    expect(result[0].quickFillWeight).toBe('');
    // Set weights should NOT be cleared
    expect(result[0].sets[0].weight).toBe('135');
    expect(result[0].sets[1].weight).toBe('135');
    // Saved status should be preserved
    expect(result[0].sets[0].saved).toBe(true);
    expect(result[0].sets[1].saved).toBe(true);
  });

  it('only affects the matching exercise', () => {
    const exercises = [
      makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
      makeExercise({ exercise_id: 'ex2', exercise_order: 2, exercise_name: 'Squat' }),
    ];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '200');

    expect(result[0].sets[0].weight).toBe('200');
    // Second exercise untouched
    expect(result[1].sets[0].weight).toBe('');
    expect(result[1].quickFillWeight).toBe('');
  });

  it('handles mixed pre-filled and empty sets', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, weight: '135' }),
        makeSet({ set_number: 2, weight: '' }),
        makeSet({ set_number: 3, weight: '140' }),
      ],
    })];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '155');

    // All sets should have the new weight
    expect(result[0].sets[0].weight).toBe('155');
    expect(result[0].sets[1].weight).toBe('155');
    expect(result[0].sets[2].weight).toBe('155');
  });
});

describe('applyQuickFillReps', () => {
  // AC1: Reps quick-fill applies rep count to all sets
  it('fills all sets with reps value and marks unsaved', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, reps: '' }),
        makeSet({ set_number: 2, reps: '' }),
        makeSet({ set_number: 3, reps: '' }),
      ],
    })];

    const result = applyQuickFillReps(exercises, 'ex1', 1, '10');

    expect(result[0].quickFillReps).toBe('10');
    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[1].reps).toBe('10');
    expect(result[0].sets[2].reps).toBe('10');
    expect(result[0].sets[0].saved).toBe(false);
    expect(result[0].sets[1].saved).toBe(false);
    expect(result[0].sets[2].saved).toBe(false);
  });

  // AC2: Lbs and reps quick-fill work independently — reps does not touch weight
  it('does not modify weight values when filling reps', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, weight: '135', reps: '8', saved: true, sheetRow: 2 }),
        makeSet({ set_number: 2, weight: '135', reps: '6', saved: true, sheetRow: 3 }),
      ],
    })];

    const result = applyQuickFillReps(exercises, 'ex1', 1, '10');

    // Weight should be untouched
    expect(result[0].sets[0].weight).toBe('135');
    expect(result[0].sets[1].weight).toBe('135');
    // Reps should be overwritten
    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[1].reps).toBe('10');
  });

  // AC2: Weight quick-fill does not touch reps
  it('weight quick-fill does not modify reps values', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, weight: '', reps: '10' }),
        makeSet({ set_number: 2, weight: '', reps: '8' }),
      ],
    })];

    const result = applyQuickFillWeight(exercises, 'ex1', 1, '185');

    expect(result[0].sets[0].weight).toBe('185');
    expect(result[0].sets[1].weight).toBe('185');
    // Reps untouched
    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[1].reps).toBe('8');
  });

  // AC3: Clearing reps quick-fill does not wipe individual set reps
  it('does not clear existing set reps when quick fill is cleared', () => {
    const exercises = [makeExercise({
      quickFillReps: '10',
      sets: [
        makeSet({ set_number: 1, reps: '10', saved: true, sheetRow: 2 }),
        makeSet({ set_number: 2, reps: '10', saved: true, sheetRow: 3 }),
      ],
    })];

    const result = applyQuickFillReps(exercises, 'ex1', 1, '');

    expect(result[0].quickFillReps).toBe('');
    // Set reps should NOT be cleared
    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[1].reps).toBe('10');
    // Saved status should be preserved
    expect(result[0].sets[0].saved).toBe(true);
    expect(result[0].sets[1].saved).toBe(true);
  });

  it('only affects the matching exercise', () => {
    const exercises = [
      makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
      makeExercise({ exercise_id: 'ex2', exercise_order: 2, exercise_name: 'Squat' }),
    ];

    const result = applyQuickFillReps(exercises, 'ex1', 1, '12');

    expect(result[0].sets[0].reps).toBe('12');
    // Second exercise untouched
    expect(result[1].sets[0].reps).toBe('');
    expect(result[1].quickFillReps).toBe('');
  });

  it('overwrites pre-filled reps with new value', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, reps: '8', saved: true, sheetRow: 2 }),
        makeSet({ set_number: 2, reps: '6', saved: true, sheetRow: 3 }),
      ],
    })];

    const result = applyQuickFillReps(exercises, 'ex1', 1, '10');

    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[1].reps).toBe('10');
    expect(result[0].sets[0].saved).toBe(false);
    expect(result[0].sets[1].saved).toBe(false);
  });
});
