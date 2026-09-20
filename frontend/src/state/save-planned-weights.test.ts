import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workouts, sets, activeWorkoutSets, toasts } from './store';
import type { BuilderExercise, SetWithRow, WorkoutSet } from '../api/types';

// Mock API modules — the save path must hand prescribed weights to appendSets.
vi.mock('../api/exercises-api', () => ({
  fetchExercises: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

vi.mock('../api/templates-api', () => ({
  fetchTemplateRows: vi.fn(),
  groupTemplateRows: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  updateExerciseNameInTemplates: vi.fn(),
}));

vi.mock('../api/workouts-api', () => ({
  fetchWorkouts: vi.fn(),
  fetchSets: vi.fn().mockResolvedValue([]),
  createWorkout: vi.fn(),
  updateWorkout: vi.fn(),
  deleteWorkoutRows: vi.fn(),
  appendSet: vi.fn(),
  appendSets: vi.fn().mockResolvedValue(undefined),
  updateSet: vi.fn(),
  deleteSetRow: vi.fn(),
  updateExerciseNameInSets: vi.fn(),
  findWorkoutRow: vi.fn().mockResolvedValue(null),
  WorkoutRowMismatchError: class extends Error {},
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

const { saveWorkoutForLater } = await import('./actions');
const { createWorkout, appendSets } = await import('../api/workouts-api');
const { plannedWeightsFor } = await import('../components/activities/planned-weights');

const TOKEN = 'test-token';

function savedSets(): WorkoutSet[] {
  return vi.mocked(appendSets).mock.calls[0][0];
}

function weightsOf(rows: WorkoutSet[], exerciseId: string, section: string): string[] {
  return rows
    .filter((s) => s.exercise_id === exerciseId && s.section === section)
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => s.weight);
}

// A planned workout as an agent scheduled it: ramped squat, bodyweight push-ups.
const scheduled: SetWithRow[] = [
  { workout_id: 'w_old', exercise_id: 'ex_squat', exercise_name: 'Squat BB', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '', effort: '', sheetRow: 2 },
  ...['95', '115', '135'].map((weight, i) => ({
    workout_id: 'w_old', exercise_id: 'ex_squat', exercise_name: 'Squat BB', section: 'primary', exercise_order: 2,
    set_number: i + 1, planned_reps: '5', weight, reps: '', effort: '' as const, sheetRow: 3 + i,
  })),
  ...[1, 2].map((n) => ({
    workout_id: 'w_old', exercise_id: 'ex_pushup', exercise_name: 'Push Ups - Close Grip', section: 'SS1', exercise_order: 3,
    set_number: n, planned_reps: '12', weight: '0', reps: '', effort: '' as const, sheetRow: 5 + n,
  })),
  { workout_id: 'w_old', exercise_id: 'ex_curl', exercise_name: 'Curl DB', section: 'SS2', exercise_order: 4, set_number: 1, planned_reps: '12', weight: '', reps: '', effort: '', sheetRow: 8 },
];

/** Mirrors PlannedWorkoutEditor.handleSave's mapping from planner rows. */
function toBuilder(rows: { id: string; name: string; section: string; sets: number; reps: string }[]): BuilderExercise[] {
  return rows.map((r) => ({
    exercise_id: r.id,
    exercise_name: r.name,
    section: r.section,
    sets: r.sets,
    planned_reps: r.reps,
    weights: plannedWeightsFor(scheduled, r.id, r.section, r.sets),
  }));
}

describe('Planned workout save keeps prescribed loads (#118 AC5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workouts.value = [];
    sets.value = [];
    activeWorkoutSets.value = [];
    toasts.value = [];
    vi.mocked(createWorkout).mockResolvedValue({
      id: 'w_new', date: '2026-09-20', time: '', type: 'weight', name: 'Legs A', template_id: '', notes: '',
      elapsed_seconds: '', created: '', copied_from: '', status: 'planned', moving_seconds: '', effort: '',
      distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
      sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '',
    });
  });

  it('re-writes every prescribed weight when the structure is unchanged', async () => {
    await saveWorkoutForLater({
      type: 'weight', name: 'Legs A', date: '2026-09-20',
      exercises: toBuilder([
        { id: 'ex_squat', name: 'Squat BB', section: 'warmup', sets: 1, reps: '' },
        { id: 'ex_squat', name: 'Squat BB', section: 'primary', sets: 3, reps: '5' },
        { id: 'ex_pushup', name: 'Push Ups - Close Grip', section: 'SS1', sets: 2, reps: '12' },
        { id: 'ex_curl', name: 'Curl DB', section: 'SS2', sets: 1, reps: '12' },
      ]),
    }, TOKEN);

    const rows = savedSets();
    expect(weightsOf(rows, 'ex_squat', 'primary')).toEqual(['95', '115', '135']);
    expect(weightsOf(rows, 'ex_pushup', 'SS1')).toEqual(['0', '0']);
    expect(weightsOf(rows, 'ex_squat', 'warmup')).toEqual(['']);
    expect(weightsOf(rows, 'ex_curl', 'SS2')).toEqual(['']);
    expect(rows.every((s) => s.reps === '' && s.effort === '')).toBe(true);
  });

  it('keeps loads on surviving sets and leaves an added set blank', async () => {
    await saveWorkoutForLater({
      type: 'weight', name: 'Legs A', date: '2026-09-20',
      exercises: toBuilder([
        { id: 'ex_squat', name: 'Squat BB', section: 'primary', sets: 4, reps: '5' },
      ]),
    }, TOKEN);

    expect(weightsOf(savedSets(), 'ex_squat', 'primary')).toEqual(['95', '115', '135', '']);
  });

  it('writes blank weights for a builder exercise with no weights, as before', async () => {
    await saveWorkoutForLater({
      type: 'weight', name: 'Fresh', date: '2026-09-20',
      exercises: [{ exercise_id: 'ex_row', exercise_name: 'Row BB', section: 'primary', sets: 3, planned_reps: '6' }],
    }, TOKEN);

    expect(weightsOf(savedSets(), 'ex_row', 'primary')).toEqual(['', '', '']);
  });
});
