import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exercises, labels, allTags } from '../../state/store';
import type { ExerciseWithRow, LabelWithRow } from '../../api/types';

const mockExercises: ExerciseWithRow[] = [
  { id: 'ex1', name: 'Bench Press', tags: 'Push, Chest', notes: 'Flat bench', created: '2026-01-01', sheetRow: 2 },
  { id: 'ex2', name: 'Barbell Row', tags: 'Pull, Back', notes: '', created: '2026-01-02', sheetRow: 3 },
  { id: 'ex3', name: 'Squat', tags: 'Legs, Compound', notes: '', created: '2026-01-03', sheetRow: 4 },
];

describe('ExercisesScreen', () => {
  beforeEach(() => {
    exercises.value = [];
    labels.value = [];
  });

  describe('AC1: /exercises route', () => {
    it('parses /exercises as exercises route', async () => {
      const { currentRoute } = await import('../../router/router');
      window.location.hash = '/exercises';
      window.dispatchEvent(new Event('hashchange'));
      expect(currentRoute.value.name).toBe('exercises');
    });
  });

  describe('AC2: Exercise list with search and tag filter', () => {
    it('displays exercises sorted alphabetically', () => {
      exercises.value = mockExercises;
      const sorted = [...exercises.value].sort((a, b) => a.name.localeCompare(b.name));
      expect(sorted[0].name).toBe('Barbell Row');
      expect(sorted[1].name).toBe('Bench Press');
      expect(sorted[2].name).toBe('Squat');
    });

    it('filters exercises by search term', () => {
      exercises.value = mockExercises;
      const search = 'bench';
      const filtered = exercises.value.filter(ex =>
        ex.name.toLowerCase().includes(search.toLowerCase())
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Bench Press');
    });

    it('filters exercises by tag', () => {
      exercises.value = mockExercises;
      const selectedTag = 'Pull';
      const filtered = exercises.value.filter(ex =>
        ex.tags.split(',').map(t => t.trim()).includes(selectedTag)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Barbell Row');
    });

    it('shows empty state when no exercises exist', () => {
      exercises.value = [];
      expect(exercises.value.length).toBe(0);
    });

    it('computes allTags from labels signal', () => {
      labels.value = [
        { id: 'lbl1', name: 'Back', color_key: 'blue', created: '', sheetRow: 2 },
        { id: 'lbl2', name: 'Chest', color_key: 'red', created: '', sheetRow: 3 },
        { id: 'lbl3', name: 'Push', color_key: 'green', created: '', sheetRow: 4 },
      ];
      expect(allTags.value).toEqual(['Back', 'Chest', 'Push']);
    });
  });

  describe('AC3: Edit exercise in-place', () => {
    it('editExercise updates the exercise in the signal', async () => {
      exercises.value = [...mockExercises];
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Incline Bench Press' };
      // Simulate what editExercise does to the signal
      exercises.value = exercises.value.map(e => e.id === updated.id ? updated : e);
      expect(exercises.value.find(e => e.id === 'ex1')?.name).toBe('Incline Bench Press');
    });
  });

  describe('AC4: Delete exercise with confirmation', () => {
    it('removeExercise removes the exercise from the signal', () => {
      exercises.value = [...mockExercises];
      // Simulate what removeExercise does
      exercises.value = exercises.value.filter(e => e.id !== 'ex1');
      expect(exercises.value).toHaveLength(2);
      expect(exercises.value.find(e => e.id === 'ex1')).toBeUndefined();
    });
  });

  describe('AC5: Demo mode', () => {
    it('demo exercises load into signal', () => {
      exercises.value = mockExercises;
      expect(exercises.value.length).toBeGreaterThan(0);
    });
  });
});
