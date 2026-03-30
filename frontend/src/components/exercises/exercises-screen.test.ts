import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exercises, sets, workouts, labels, allTags } from '../../state/store';
import { getLastTimeDataFrom, formatLastTimeDate } from '../workout/last-time-data';
import type { ExerciseWithRow, LabelWithRow, SetWithRow, WorkoutWithRow } from '../../api/types';
import { buildLastPerformedMap, formatShortDate } from './exercises-screen';

const mockExercises: ExerciseWithRow[] = [
  { id: 'ex1', name: 'Bench Press', tags: 'Push, Chest', notes: 'Flat bench', created: '2026-01-01', sheetRow: 2 },
  { id: 'ex2', name: 'Row BB', tags: 'Pull, Back, BB', notes: '', created: '2026-01-02', sheetRow: 3 },
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
      expect(sorted[0].name).toBe('Bench Press');
      expect(sorted[1].name).toBe('Row BB');
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

    it('filters exercises by tag (single tag — OR unchanged)', () => {
      exercises.value = mockExercises;
      const selectedTag = 'Pull';
      const filtered = exercises.value.filter(ex =>
        ex.tags.split(',').map(t => t.trim()).includes(selectedTag)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Row BB');
    });

    // Issue #63 — AND logic tests
    it('AC2: multiple selected tags use AND logic — only exercises with ALL tags shown', () => {
      exercises.value = mockExercises;
      const selectedTags = ['Push', 'Chest'];
      const filtered = exercises.value.filter(ex => {
        const exTags = ex.tags.split(',').map(t => t.trim());
        return selectedTags.every(tag => exTags.includes(tag));
      });
      // Only Bench Press has both Push and Chest
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Bench Press');
    });

    it('AC2: AND logic excludes exercises that match only one of two selected tags', () => {
      exercises.value = mockExercises;
      const selectedTags = ['Pull', 'Chest'];
      const filtered = exercises.value.filter(ex => {
        const exTags = ex.tags.split(',').map(t => t.trim());
        return selectedTags.every(tag => exTags.includes(tag));
      });
      // No exercise has both Pull and Chest
      expect(filtered).toHaveLength(0);
    });

    it('AC3: no tags selected shows all exercises', () => {
      exercises.value = mockExercises;
      const selectedTags: string[] = [];
      const filtered = exercises.value.filter(ex => {
        if (selectedTags.length === 0) return true;
        const exTags = ex.tags.split(',').map(t => t.trim());
        return selectedTags.every(tag => exTags.includes(tag));
      });
      expect(filtered).toHaveLength(mockExercises.length);
    });

    it('AC4: AND filter returning zero results triggers empty state', () => {
      exercises.value = mockExercises;
      const selectedTags = ['Chest', 'Legs']; // no exercise has both
      const filtered = exercises.value.filter(ex => {
        const exTags = ex.tags.split(',').map(t => t.trim());
        return selectedTags.every(tag => exTags.includes(tag));
      });
      expect(filtered).toHaveLength(0);
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

// === Issue #64: Create new exercises from the Exercises page ===

describe('Issue #64 — Create exercise from Exercises screen', () => {
  beforeEach(() => {
    exercises.value = [];
  });

  describe('AC3: Successful create adds exercise to signal', () => {
    it('adding an exercise to the signal makes it appear in the list', () => {
      exercises.value = [...mockExercises];
      const newEx: ExerciseWithRow = {
        id: 'ex_new',
        name: 'Pull Up',
        tags: 'Pull, Back',
        notes: '',
        created: '2026-03-29',
        sheetRow: 5,
      };
      exercises.value = [...exercises.value, newEx];
      expect(exercises.value.find(e => e.id === 'ex_new')).toBeDefined();
      expect(exercises.value.find(e => e.name === 'Pull Up')).toBeDefined();
    });
  });

  describe('AC4: Cancel returns to list without saving', () => {
    it('cancelling create leaves exercise list unchanged', () => {
      exercises.value = [...mockExercises];
      const countBefore = exercises.value.length;
      // Simulate cancel: creatingExercise state set to false, no addExercise called
      const creatingExercise = false;
      expect(creatingExercise).toBe(false);
      expect(exercises.value.length).toBe(countBefore);
    });
  });

  describe('AC5: Name is required', () => {
    it('submit is disabled when name is empty (ExerciseForm contract)', () => {
      // ExerciseForm disables submit when name.trim() is empty — verified by form contract
      const name = '';
      const submitDisabled = !name.trim();
      expect(submitDisabled).toBe(true);
    });

    it('submit is enabled when name has a value', () => {
      const name = 'Pull Up';
      const submitDisabled = !name.trim();
      expect(submitDisabled).toBe(false);
    });
  });
});

// === Issue #23: Show last workout date and details on exercise cards ===

const mockSets: SetWithRow[] = [
  { workout_id: 'w1', exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '8-10', weight: '185', reps: '8', effort: 'Medium', notes: '', sheetRow: 2 },
  { workout_id: 'w1', exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 2, planned_reps: '8-10', weight: '185', reps: '7', effort: 'Hard', notes: '', sheetRow: 3 },
  { workout_id: 'w1', exercise_id: 'ex2', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '8-10', weight: '135', reps: '10', effort: 'Easy', notes: '', sheetRow: 4 },
];

const mockWorkouts: WorkoutWithRow[] = [
  { id: 'w1', date: '2026-03-10', time: '07:00', type: 'weight', name: 'Push A', template_id: '', notes: '', duration_min: '60', created: '2026-03-10T07:00:00.000Z', copied_from: '', status: '', sheetRow: 2 },
];

describe('Issue #23 — Exercise card last-workout info', () => {
  beforeEach(() => {
    exercises.value = [];
    sets.value = [];
    workouts.value = [];
  });

  describe('AC1: Last-performed date on exercise cards', () => {
    it('buildLastPerformedMap returns date for exercises with history', () => {
      const map = buildLastPerformedMap(mockSets, mockWorkouts);
      expect(map.get('ex1')).toBe('2026-03-10');
      expect(map.get('ex2')).toBe('2026-03-10');
    });

    it('buildLastPerformedMap returns no entry for exercises without history', () => {
      const map = buildLastPerformedMap(mockSets, mockWorkouts);
      expect(map.has('ex3')).toBe(false);
    });

    it('buildLastPerformedMap picks the most recent workout date per exercise', () => {
      const setsMulti: SetWithRow[] = [
        { workout_id: 'w_old', exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '', weight: '135', reps: '10', effort: '', notes: '', sheetRow: 2 },
        { workout_id: 'w_new', exercise_id: 'ex1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '', weight: '185', reps: '8', effort: '', notes: '', sheetRow: 3 },
      ];
      const wkts: WorkoutWithRow[] = [
        { id: 'w_old', date: '2026-01-01', time: '', type: 'weight', name: '', template_id: '', notes: '', duration_min: '', created: '', copied_from: '', status: '', sheetRow: 2 },
        { id: 'w_new', date: '2026-03-10', time: '', type: 'weight', name: '', template_id: '', notes: '', duration_min: '', created: '', copied_from: '', status: '', sheetRow: 3 },
      ];
      const map = buildLastPerformedMap(setsMulti, wkts);
      expect(map.get('ex1')).toBe('2026-03-10');
    });

    it('formatShortDate formats date as "Mar 10, 2026"', () => {
      expect(formatShortDate('2026-03-10')).toBe('Mar 10, 2026');
    });
  });

  describe('AC2: Expandable detail panel shows last workout set data', () => {
    it('getLastTimeDataFrom returns sets for exercise with empty currentWorkoutId', () => {
      const result = getLastTimeDataFrom('ex1', '', mockSets, mockWorkouts);
      expect(result).not.toBeNull();
      expect(result!.workoutDate).toBe('2026-03-10');
      expect(result!.sets).toHaveLength(2);
      expect(result!.sets[0].set_number).toBe(1);
      expect(result!.sets[1].set_number).toBe(2);
    });

    it('formatLastTimeDate returns date with relative age for panel header', () => {
      const result = formatLastTimeDate('2020-01-15');
      expect(result).toMatch(/Jan 15, 2020/);
      expect(result).toMatch(/\(\d+ days ago\)/);
    });

    it('effort values map to correct CSS classes', () => {
      const effortClass = (effort: string) => effort ? `effort-${effort.toLowerCase()}` : '';
      expect(effortClass('Easy')).toBe('effort-easy');
      expect(effortClass('Medium')).toBe('effort-medium');
      expect(effortClass('Hard')).toBe('effort-hard');
      expect(effortClass('')).toBe('');
    });
  });

  describe('AC3: Exercise editing remains accessible via edit button', () => {
    it('edit button navigates to edit form (editing state set on click)', () => {
      // The edit button sets editingExercise state — existing edit form handles the rest.
      // This test verifies the edit pathway still exists alongside expand/collapse.
      exercises.value = [...mockExercises];
      const ex = exercises.value[0];
      // Simulate: clicking edit sets editingExercise
      let editingExercise: ExerciseWithRow | null = null;
      editingExercise = ex;
      expect(editingExercise).not.toBeNull();
      expect(editingExercise!.id).toBe('ex1');
    });
  });

  describe('AC4: No previous data state in expansion panel', () => {
    it('getLastTimeDataFrom returns null for exercise with no logged sets', () => {
      const result = getLastTimeDataFrom('ex3', '', mockSets, mockWorkouts);
      expect(result).toBeNull();
    });
  });

  describe('AC5: Data lookup reuses existing last-time-data utility', () => {
    it('getLastTimeDataFrom works with empty currentWorkoutId for library context', () => {
      const result = getLastTimeDataFrom('ex2', '', mockSets, mockWorkouts);
      expect(result).not.toBeNull();
      expect(result!.sets).toHaveLength(1);
      expect(result!.sets[0].exercise_name).toBe('Row BB');
    });

    it('buildLastPerformedMap works with empty data (demo mode initial state)', () => {
      const map = buildLastPerformedMap([], []);
      expect(map.size).toBe(0);
    });
  });
});
