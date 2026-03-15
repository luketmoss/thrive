import { describe, it, expect } from 'vitest';
import { isWarmupExercise } from './warmup';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';

function makeSet(overrides: Partial<TrackerSet> = {}): TrackerSet {
  return {
    set_number: 1,
    planned_reps: '',
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
    exercise_name: 'Push Ups',
    section: 'warmup',
    exercise_order: 1,
    sets: [],
    quickFillWeight: '',
    quickFillReps: '',
    ...overrides,
  };
}

describe('isWarmupExercise', () => {
  // AC1: warmup exercises are identified by section
  it('returns true for section "warmup"', () => {
    expect(isWarmupExercise(makeExercise({ section: 'warmup' }))).toBe(true);
  });

  // AC2: non-warmup sections return false
  it('returns false for section "primary"', () => {
    expect(isWarmupExercise(makeExercise({ section: 'primary' }))).toBe(false);
  });

  it('returns false for superset sections', () => {
    expect(isWarmupExercise(makeExercise({ section: 'SS1' }))).toBe(false);
    expect(isWarmupExercise(makeExercise({ section: 'SS2' }))).toBe(false);
  });

  it('returns false for burnout section', () => {
    expect(isWarmupExercise(makeExercise({ section: 'burnout' }))).toBe(false);
  });

  it('returns false for cooldown section', () => {
    expect(isWarmupExercise(makeExercise({ section: 'cooldown' }))).toBe(false);
  });
});

describe('warmup filtering for save', () => {
  // AC3: warmup exercises should be filtered out before saving
  it('filters warmup exercises from save list', () => {
    const exercises: TrackerExercise[] = [
      makeExercise({ exercise_id: 'ex1', section: 'warmup', exercise_order: 1 }),
      makeExercise({
        exercise_id: 'ex2',
        section: 'primary',
        exercise_order: 2,
        exercise_name: 'Bench Press',
        sets: [makeSet({ set_number: 1, weight: '135', reps: '10' })],
      }),
      makeExercise({ exercise_id: 'ex3', section: 'warmup', exercise_order: 3 }),
      makeExercise({
        exercise_id: 'ex4',
        section: 'SS1',
        exercise_order: 4,
        exercise_name: 'Cable Fly',
        sets: [makeSet({ set_number: 1, weight: '30', reps: '12' })],
      }),
    ];

    const saveable = exercises.filter((ex) => !isWarmupExercise(ex));
    expect(saveable).toHaveLength(2);
    expect(saveable[0].exercise_name).toBe('Bench Press');
    expect(saveable[1].exercise_name).toBe('Cable Fly');
  });
});
