import { describe, it, expect } from 'vitest';
import { applyChangeSection, applyMoveUp, applyMoveDown, ALL_SECTIONS } from './section-management';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';

function makeSet(overrides: Partial<TrackerSet> = {}): TrackerSet {
  return {
    set_number: 1,
    planned_reps: '',
    weight: '135',
    reps: '8',
    effort: 'Medium',
    notes: '',
    saved: true,
    sheetRow: 10,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<TrackerExercise> = {}): TrackerExercise {
  return {
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    sets: [makeSet({ set_number: 1 }), makeSet({ set_number: 2 })],
    quickFillWeight: '',
    quickFillReps: '',
    ...overrides,
  };
}

describe('ALL_SECTIONS', () => {
  it('contains all 7 expected section names', () => {
    expect(ALL_SECTIONS).toHaveLength(7);
    expect(ALL_SECTIONS).toContain('warmup');
    expect(ALL_SECTIONS).toContain('primary');
    expect(ALL_SECTIONS).toContain('SS1');
    expect(ALL_SECTIONS).toContain('SS2');
    expect(ALL_SECTIONS).toContain('SS3');
    expect(ALL_SECTIONS).toContain('burnout');
    expect(ALL_SECTIONS).toContain('cooldown');
  });
});

describe('applyChangeSection', () => {
  describe('AC1: non-warmup to non-warmup section change', () => {
    it('updates section without touching sets', () => {
      const exercises = [makeExercise({ section: 'primary' })];
      const { exercises: result, removedSets } = applyChangeSection(exercises, 'ex1', 1, 'SS1');

      expect(result[0].section).toBe('SS1');
      expect(result[0].sets).toHaveLength(2);
      expect(removedSets).toHaveLength(0);
    });

    it('preserves set data when changing between non-warmup sections', () => {
      const exercises = [makeExercise({ section: 'burnout' })];
      const { exercises: result } = applyChangeSection(exercises, 'ex1', 1, 'cooldown');

      expect(result[0].section).toBe('cooldown');
      expect(result[0].sets[0].weight).toBe('135');
      expect(result[0].sets[0].reps).toBe('8');
    });

    it('does not affect other exercises', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1, section: 'primary' }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2, section: 'primary', exercise_name: 'Squat' }),
      ];
      const { exercises: result } = applyChangeSection(exercises, 'ex1', 1, 'SS2');

      expect(result[0].section).toBe('SS2');
      expect(result[1].section).toBe('primary');
    });
  });

  describe('AC2: switching to warmup clears sets', () => {
    it('removes all sets and returns them as removedSets', () => {
      const sets = [
        makeSet({ set_number: 1, sheetRow: 10 }),
        makeSet({ set_number: 2, sheetRow: 11 }),
        makeSet({ set_number: 3, sheetRow: 12 }),
      ];
      const exercises = [makeExercise({ sets })];
      const { exercises: result, removedSets } = applyChangeSection(exercises, 'ex1', 1, 'warmup');

      expect(result[0].section).toBe('warmup');
      expect(result[0].sets).toHaveLength(0);
      expect(removedSets).toHaveLength(3);
      expect(removedSets[0].sheetRow).toBe(10);
      expect(removedSets[2].sheetRow).toBe(12);
    });

    it('returns zero removedSets when exercise had no sets', () => {
      const exercises = [makeExercise({ sets: [] })];
      const { removedSets } = applyChangeSection(exercises, 'ex1', 1, 'warmup');

      expect(removedSets).toHaveLength(0);
    });
  });

  describe('AC2: switching from warmup to non-warmup adds single empty set', () => {
    it('adds one empty set when converting from warmup', () => {
      const exercises = [makeExercise({ section: 'warmup', sets: [] })];
      const { exercises: result, removedSets } = applyChangeSection(exercises, 'ex1', 1, 'primary');

      expect(result[0].section).toBe('primary');
      expect(result[0].sets).toHaveLength(1);
      expect(result[0].sets[0].set_number).toBe(1);
      expect(result[0].sets[0].weight).toBe('');
      expect(result[0].sets[0].reps).toBe('');
      expect(result[0].sets[0].saved).toBe(false);
      expect(result[0].sets[0].sheetRow).toBe(-1);
      expect(removedSets).toHaveLength(0);
    });

    it('works for all non-warmup target sections', () => {
      const nonWarmup = ['primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'];
      for (const section of nonWarmup) {
        const exercises = [makeExercise({ section: 'warmup', sets: [] })];
        const { exercises: result } = applyChangeSection(exercises, 'ex1', 1, section);
        expect(result[0].section).toBe(section);
        expect(result[0].sets).toHaveLength(1);
      }
    });
  });

  describe('AC4: section value preserved in exercises list', () => {
    it('returns the new section on the matching exercise', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1, section: 'primary' }),
      ];
      const { exercises: result } = applyChangeSection(exercises, 'ex1', 1, 'SS3');
      expect(result[0].section).toBe('SS3');
    });
  });
});

describe('applyMoveUp', () => {
  describe('AC3: reorder moves exercise up correctly', () => {
    it('swaps exercise_order with the exercise above', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1, exercise_name: 'A' }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2, exercise_name: 'B' }),
        makeExercise({ exercise_id: 'ex3', exercise_order: 3, exercise_name: 'C' }),
      ];

      const result = applyMoveUp(exercises, 'ex2', 2);

      const sorted = [...result].sort((a, b) => a.exercise_order - b.exercise_order);
      expect(sorted[0].exercise_name).toBe('B');
      expect(sorted[1].exercise_name).toBe('A');
      expect(sorted[2].exercise_name).toBe('C');
    });

    it('returns unchanged array when exercise is already first', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2 }),
      ];

      const result = applyMoveUp(exercises, 'ex1', 1);

      // exercise_order unchanged
      expect(result.find(e => e.exercise_id === 'ex1')?.exercise_order).toBe(1);
      expect(result.find(e => e.exercise_id === 'ex2')?.exercise_order).toBe(2);
    });

    it('preserves exercise data when swapping', () => {
      const set = makeSet({ set_number: 1, weight: '200', reps: '5' });
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1, sets: [set] }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2 }),
      ];

      const result = applyMoveUp(exercises, 'ex2', 2);

      const ex1 = result.find(e => e.exercise_id === 'ex1');
      expect(ex1?.sets[0].weight).toBe('200');
    });
  });
});

describe('applyMoveDown', () => {
  describe('AC3: reorder moves exercise down correctly', () => {
    it('swaps exercise_order with the exercise below', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1, exercise_name: 'A' }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2, exercise_name: 'B' }),
        makeExercise({ exercise_id: 'ex3', exercise_order: 3, exercise_name: 'C' }),
      ];

      const result = applyMoveDown(exercises, 'ex2', 2);

      const sorted = [...result].sort((a, b) => a.exercise_order - b.exercise_order);
      expect(sorted[0].exercise_name).toBe('A');
      expect(sorted[1].exercise_name).toBe('C');
      expect(sorted[2].exercise_name).toBe('B');
    });

    it('returns unchanged array when exercise is already last', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2 }),
      ];

      const result = applyMoveDown(exercises, 'ex2', 2);

      expect(result.find(e => e.exercise_id === 'ex2')?.exercise_order).toBe(2);
    });

    it('only affects the two exercises being swapped', () => {
      const exercises = [
        makeExercise({ exercise_id: 'ex1', exercise_order: 1 }),
        makeExercise({ exercise_id: 'ex2', exercise_order: 2 }),
        makeExercise({ exercise_id: 'ex3', exercise_order: 3 }),
      ];

      const result = applyMoveDown(exercises, 'ex1', 1);

      expect(result.find(e => e.exercise_id === 'ex3')?.exercise_order).toBe(3);
    });
  });
});
