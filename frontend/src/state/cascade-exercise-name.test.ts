import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exercises, templates, sets, activeWorkoutSets, toasts } from './store';
import type { ExerciseWithRow, Template, SetWithRow } from '../api/types';

// Mock API modules
vi.mock('../api/exercises-api', () => ({
  fetchExercises: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn().mockResolvedValue(undefined),
  deleteExercise: vi.fn(),
}));

vi.mock('../api/templates-api', () => ({
  fetchTemplateRows: vi.fn(),
  groupTemplateRows: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  updateExerciseNameInTemplates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/workouts-api', () => ({
  fetchWorkouts: vi.fn(),
  fetchSets: vi.fn(),
  createWorkout: vi.fn(),
  updateWorkout: vi.fn(),
  deleteWorkoutRows: vi.fn(),
  appendSet: vi.fn(),
  appendSets: vi.fn(),
  updateSet: vi.fn(),
  deleteSetRow: vi.fn(),
  updateExerciseNameInSets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/labels-api', () => ({
  fetchLabels: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
  appendLabels: vi.fn(),
}));

vi.mock('../api/label-colors', () => ({
  colorKeyFromName: vi.fn().mockReturnValue('blue'),
}));

vi.mock('../auth/reauth', () => ({
  attemptReauth: vi.fn(),
  ReauthFailedError: class extends Error {},
}));

const { editExercise } = await import('./actions');
const { updateExerciseNameInTemplates } = await import('../api/templates-api');
const { updateExerciseNameInSets } = await import('../api/workouts-api');
const { updateExercise: updateExerciseApi } = await import('../api/exercises-api');

const TOKEN = 'test-token';

const mockExercises: ExerciseWithRow[] = [
  { id: 'ex_1', name: 'Bench Press', tags: 'Push, Chest', notes: '', created: '2025-01-01', sheetRow: 2 },
  { id: 'ex_2', name: 'Squat', tags: 'Legs', notes: '', created: '2025-01-01', sheetRow: 3 },
];

const mockTemplates: Template[] = [
  {
    id: 'tpl_1',
    name: 'Push Day',
    exercises: [
      { template_id: 'tpl_1', template_name: 'Push Day', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', sets: '4', reps: '6', created: '', updated: '', sheetRow: 2 },
      { template_id: 'tpl_1', template_name: 'Push Day', order: 2, exercise_id: 'ex_2', exercise_name: 'Squat', section: 'primary', sets: '3', reps: '8', created: '', updated: '', sheetRow: 3 },
    ],
  },
  {
    id: 'tpl_2',
    name: 'Full Body',
    exercises: [
      { template_id: 'tpl_2', template_name: 'Full Body', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'SS1', sets: '3', reps: '10', created: '', updated: '', sheetRow: 4 },
    ],
  },
];

const mockSets: SetWithRow[] = [
  { workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '6', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 2 },
  { workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 2, planned_reps: '6', weight: '185', reps: '5', effort: 'Hard', notes: '', sheetRow: 3 },
  { workout_id: 'w_2', exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '6', weight: '175', reps: '6', effort: 'Medium', notes: '', sheetRow: 4 },
  { workout_id: 'w_1', exercise_id: 'ex_2', exercise_name: 'Squat', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '8', weight: '225', reps: '8', effort: 'Medium', notes: '', sheetRow: 5 },
  { workout_id: 'w_2', exercise_id: 'ex_1', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 2, planned_reps: '6', weight: '175', reps: '5', effort: 'Hard', notes: '', sheetRow: 6 },
];

describe('Cascade exercise name changes (#17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exercises.value = [...mockExercises];
    templates.value = JSON.parse(JSON.stringify(mockTemplates));
    sets.value = [...mockSets];
    activeWorkoutSets.value = [];
    toasts.value = [];
  });

  describe('AC1: Name change cascades to Templates sheet', () => {
    it('updates exercise_name in all matching template rows', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      // API was called with the 2 template rows that match ex_1
      expect(updateExerciseNameInTemplates).toHaveBeenCalledWith(
        'ex_1',
        'Flat Bench Press',
        expect.any(Array),
        TOKEN,
      );

      // Local templates signal reflects the new name
      const tpl1Ex1 = templates.value[0].exercises.find(e => e.exercise_id === 'ex_1');
      expect(tpl1Ex1?.exercise_name).toBe('Flat Bench Press');
      const tpl2Ex1 = templates.value[1].exercises.find(e => e.exercise_id === 'ex_1');
      expect(tpl2Ex1?.exercise_name).toBe('Flat Bench Press');
    });

    it('does not change template rows for other exercises', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      const squat = templates.value[0].exercises.find(e => e.exercise_id === 'ex_2');
      expect(squat?.exercise_name).toBe('Squat');
    });
  });

  describe('AC2: Name change cascades to Sets sheet', () => {
    it('updates exercise_name in all matching set rows', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      // API was called
      expect(updateExerciseNameInSets).toHaveBeenCalledWith(
        'ex_1',
        'Flat Bench Press',
        expect.any(Array),
        TOKEN,
      );

      // Local sets signal reflects the new name for all ex_1 rows
      const ex1Sets = sets.value.filter(s => s.exercise_id === 'ex_1');
      expect(ex1Sets).toHaveLength(4);
      for (const s of ex1Sets) {
        expect(s.exercise_name).toBe('Flat Bench Press');
      }
    });

    it('does not change set rows for other exercises', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      const squatSets = sets.value.filter(s => s.exercise_id === 'ex_2');
      expect(squatSets[0].exercise_name).toBe('Squat');
    });

    it('updates activeWorkoutSets if they match the exercise', async () => {
      activeWorkoutSets.value = [mockSets[0], mockSets[1]];
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      for (const s of activeWorkoutSets.value) {
        expect(s.exercise_name).toBe('Flat Bench Press');
      }
    });
  });

  describe('AC3: No cascade when name is unchanged', () => {
    it('does not call cascade APIs when only tags change', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], tags: 'Push, Chest, Compound' };
      await editExercise(updated, TOKEN);

      expect(updateExerciseApi).toHaveBeenCalled();
      expect(updateExerciseNameInTemplates).not.toHaveBeenCalled();
      expect(updateExerciseNameInSets).not.toHaveBeenCalled();
    });
  });

  describe('AC4: Cascade with zero matching rows', () => {
    it('handles exercise that has never been used in templates or sets', async () => {
      const newEx: ExerciseWithRow = { id: 'ex_new', name: 'Cable Fly', tags: '', notes: '', created: '', sheetRow: 10 };
      exercises.value = [...exercises.value, newEx];

      const updated: ExerciseWithRow = { ...newEx, name: 'Cable Chest Fly' };
      await editExercise(updated, TOKEN);

      // Exercise updated
      expect(exercises.value.find(e => e.id === 'ex_new')?.name).toBe('Cable Chest Fly');
      // Cascade called but with no matching rows (graceful)
      expect(updateExerciseNameInTemplates).toHaveBeenCalled();
      expect(updateExerciseNameInSets).toHaveBeenCalled();
      // No errors
      const errorToasts = toasts.value.filter(t => t.type === 'error');
      expect(errorToasts).toHaveLength(0);
    });
  });

  describe('AC5: Feedback and form state during cascade', () => {
    it('shows single success toast after successful cascade', async () => {
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      const successToasts = toasts.value.filter(t => t.type === 'success');
      expect(successToasts).toHaveLength(1);
      expect(successToasts[0].text).toBe('Exercise updated');
    });

    it('shows actionable error toast when cascade partially fails', async () => {
      vi.mocked(updateExerciseNameInSets).mockRejectedValueOnce(new Error('API error'));

      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      await editExercise(updated, TOKEN);

      const errorToasts = toasts.value.filter(t => t.type === 'error');
      expect(errorToasts).toHaveLength(1);
      expect(errorToasts[0].text).toContain('some references couldn\'t update');
    });

    it('editExercise awaits the full cascade (returns promise)', async () => {
      // Verify editExercise returns a promise that resolves after cascade
      const updated: ExerciseWithRow = { ...mockExercises[0], name: 'Flat Bench Press' };
      const promise = editExercise(updated, TOKEN);
      expect(promise).toBeInstanceOf(Promise);
      await promise;

      // After awaiting, both cascade calls have completed
      expect(updateExerciseNameInTemplates).toHaveBeenCalled();
      expect(updateExerciseNameInSets).toHaveBeenCalled();
    });
  });
});
