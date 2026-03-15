import { describe, it, expect } from 'vitest';
import { applyCopyDown } from './copy-down';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { SetWithRow } from '../../api/types';

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

function makeLastTimeSet(overrides: Partial<SetWithRow> = {}): SetWithRow {
  return {
    workout_id: 'prev-w1',
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
    sheetRow: 100,
    ...overrides,
  };
}

describe('applyCopyDown', () => {
  // AC1: Copy down populates current sets from last-time data
  it('copies weight, reps, effort from last-time sets', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, planned_reps: '8-10' }),
        makeSet({ set_number: 2, planned_reps: '8-10' }),
        makeSet({ set_number: 3, planned_reps: '6-8' }),
      ],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, weight: '135', reps: '10', effort: 'Medium' }),
      makeLastTimeSet({ set_number: 2, weight: '140', reps: '8', effort: 'Hard' }),
      makeLastTimeSet({ set_number: 3, weight: '145', reps: '6', effort: 'Hard' }),
    ];

    const { exercises: result, removedSets } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    expect(result[0].sets).toHaveLength(3);
    expect(result[0].sets[0].weight).toBe('135');
    expect(result[0].sets[0].reps).toBe('10');
    expect(result[0].sets[0].effort).toBe('Medium');
    expect(result[0].sets[1].weight).toBe('140');
    expect(result[0].sets[1].reps).toBe('8');
    expect(result[0].sets[1].effort).toBe('Hard');
    expect(result[0].sets[2].weight).toBe('145');
    expect(result[0].sets[2].reps).toBe('6');
    expect(removedSets).toHaveLength(0);
  });

  // AC1: planned_reps preserved
  it('preserves planned_reps from current sets', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, planned_reps: '8-10' }),
        makeSet({ set_number: 2, planned_reps: '6-8' }),
      ],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, planned_reps: '12-15' }),
      makeLastTimeSet({ set_number: 2, planned_reps: '12-15' }),
    ];

    const { exercises: result } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    // planned_reps should come from current, not last-time
    expect(result[0].sets[0].planned_reps).toBe('8-10');
    expect(result[0].sets[1].planned_reps).toBe('6-8');
  });

  // AC1: All copied sets marked unsaved
  it('marks all copied sets as unsaved', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, saved: true, sheetRow: 5 }),
        makeSet({ set_number: 2, saved: true, sheetRow: 6 }),
      ],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1 }),
      makeLastTimeSet({ set_number: 2 }),
    ];

    const { exercises: result } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    expect(result[0].sets[0].saved).toBe(false);
    expect(result[0].sets[1].saved).toBe(false);
    // sheetRow preserved for existing sets (needed for update vs append)
    expect(result[0].sets[0].sheetRow).toBe(5);
    expect(result[0].sets[1].sheetRow).toBe(6);
  });

  // AC2: More sets in last-time → creates additional sets
  it('creates additional sets when last-time has more', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, planned_reps: '8-10' }),
        makeSet({ set_number: 2, planned_reps: '8-10' }),
      ],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, weight: '135', reps: '10', effort: 'Easy' }),
      makeLastTimeSet({ set_number: 2, weight: '135', reps: '10', effort: 'Medium' }),
      makeLastTimeSet({ set_number: 3, weight: '140', reps: '8', effort: 'Hard' }),
      makeLastTimeSet({ set_number: 4, weight: '140', reps: '6', effort: 'Hard' }),
    ];

    const { exercises: result, removedSets } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    expect(result[0].sets).toHaveLength(4);
    // New sets should have last-time data
    expect(result[0].sets[2].weight).toBe('140');
    expect(result[0].sets[2].reps).toBe('8');
    expect(result[0].sets[2].effort).toBe('Hard');
    expect(result[0].sets[3].weight).toBe('140');
    // New sets have no planned_reps (no current set to inherit from)
    expect(result[0].sets[2].planned_reps).toBe('');
    expect(result[0].sets[3].planned_reps).toBe('');
    // New sets have sheetRow = -1 (not yet saved)
    expect(result[0].sets[2].sheetRow).toBe(-1);
    expect(result[0].sets[3].sheetRow).toBe(-1);
    expect(removedSets).toHaveLength(0);
  });

  // AC3: Fewer sets in last-time → excess sets returned for removal
  it('returns excess sets for removal when last-time has fewer', () => {
    const exercises = [makeExercise({
      sets: [
        makeSet({ set_number: 1, saved: true, sheetRow: 5 }),
        makeSet({ set_number: 2, saved: true, sheetRow: 6 }),
        makeSet({ set_number: 3, saved: true, sheetRow: 7 }),
        makeSet({ set_number: 4, saved: false, sheetRow: -1 }),
      ],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, weight: '135', reps: '10', effort: 'Medium' }),
      makeLastTimeSet({ set_number: 2, weight: '140', reps: '8', effort: 'Hard' }),
    ];

    const { exercises: result, removedSets } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    expect(result[0].sets).toHaveLength(2);
    expect(removedSets).toHaveLength(2);
    // Removed sets include the saved one (for API cleanup) and unsaved one
    expect(removedSets[0].sheetRow).toBe(7);
    expect(removedSets[1].sheetRow).toBe(-1);
  });

  // AC4: Only affects matching exercise
  it('only affects the matching exercise', () => {
    const exercises = [
      makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
      makeExercise({ exercise_id: 'ex2', exercise_order: 2, exercise_name: 'Squat' }),
    ];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, weight: '200', reps: '5', effort: 'Hard' }),
    ];

    const { exercises: result } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    // ex1 updated
    expect(result[0].sets[0].weight).toBe('200');
    // ex2 untouched
    expect(result[1].sets[0].weight).toBe('');
    expect(result[1].sets).toHaveLength(3);
  });

  // AC1: notes not copied from last-time
  it('does not copy notes from last-time sets', () => {
    const exercises = [makeExercise({
      sets: [makeSet({ set_number: 1, notes: 'my note' })],
    })];

    const lastTime = [
      makeLastTimeSet({ set_number: 1, notes: 'old note from last time' }),
    ];

    const { exercises: result } = applyCopyDown(exercises, 'ex1', 1, lastTime);

    expect(result[0].sets[0].notes).toBe('');
  });
});
