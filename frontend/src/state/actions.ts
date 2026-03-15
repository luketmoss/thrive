import { exercises, templates, workouts, sets, loading, activeWorkoutId, activeWorkoutSets, showToast } from './store';
import { fetchExercises, createExercise, updateExercise as updateExerciseApi, deleteExercise as deleteExerciseApi } from '../api/exercises-api';
import { fetchTemplateRows, groupTemplateRows, createTemplate as createTemplateApi, updateTemplate as updateTemplateApi, deleteTemplate as deleteTemplateApi } from '../api/templates-api';
import { fetchWorkouts, fetchSets, createWorkout as createWorkoutApi, updateWorkout as updateWorkoutApi, deleteWorkoutRows, appendSet as appendSetApi, appendSets as appendSetsApi, updateSet as updateSetApi, deleteSetRow } from '../api/workouts-api';
import type { TemplateExerciseInput } from '../api/templates-api';
import type { ExerciseWithRow, TemplateRowWithRow, WorkoutType, WorkoutSet, SetWithRow } from '../api/types';
import { ReauthFailedError } from '../auth/reauth';

function isReauthFailure(err: unknown): boolean {
  return err instanceof ReauthFailedError;
}

/** Parse a set range like "4-5" → 5 (upper bound), "3" → 3, "" → 3 (default). */
export function parseSetCount(setsStr: string): number {
  if (!setsStr.trim()) return 3;
  const parts = setsStr.split('-').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
  return parts.length > 0 ? Math.max(...parts) : 3;
}

// ── Initial Data Load ────────────────────────────────────────────────

export async function loadInitialData(token: string): Promise<void> {
  loading.value = true;
  try {
    const [exerciseData, templateRowData, workoutData, setData] = await Promise.all([
      fetchExercises(token),
      fetchTemplateRows(token),
      fetchWorkouts(token),
      fetchSets(token),
    ]);
    exercises.value = exerciseData;
    templates.value = groupTemplateRows(templateRowData);
    workouts.value = workoutData;
    sets.value = setData;
    loading.value = false;
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to load data:', err);
    showToast('Failed to load data', 'error');
    loading.value = false;
  }
}

// ── Templates ────────────────────────────────────────────────────────

export async function loadTemplates(token: string): Promise<void> {
  try {
    const rows = await fetchTemplateRows(token);
    templates.value = groupTemplateRows(rows);
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to load templates', 'error');
    throw err;
  }
}

export async function addTemplate(
  name: string,
  exerciseInputs: TemplateExerciseInput[],
  token: string,
): Promise<void> {
  try {
    const created = await createTemplateApi(name, exerciseInputs, token);
    templates.value = [...templates.value, created].sort((a, b) => a.name.localeCompare(b.name));
    showToast('Template created', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to create template', 'error');
    throw err;
  }
}

export async function editTemplate(
  templateId: string,
  name: string,
  exerciseInputs: TemplateExerciseInput[],
  existingRows: TemplateRowWithRow[],
  token: string,
): Promise<void> {
  try {
    await updateTemplateApi(templateId, name, exerciseInputs, existingRows, token);
    // Re-fetch to get correct sheetRow values
    const rows = await fetchTemplateRows(token);
    templates.value = groupTemplateRows(rows);
    showToast('Template updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to update template', 'error');
    throw err;
  }
}

export async function removeTemplate(
  templateId: string,
  existingRows: TemplateRowWithRow[],
  token: string,
): Promise<void> {
  try {
    await deleteTemplateApi(templateId, existingRows, token);
    templates.value = templates.value.filter((t) => t.id !== templateId);
    showToast('Template deleted', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to delete template', 'error');
    throw err;
  }
}

// ── Exercises ────────────────────────────────────────────────────────

export async function addExercise(
  data: { name: string; tags: string; notes: string },
  token: string,
): Promise<ExerciseWithRow> {
  try {
    const created = await createExercise(data, token);
    const withRow: ExerciseWithRow = {
      ...created,
      sheetRow: exercises.value.length + 2, // approximate; re-fetch corrects this
    };
    exercises.value = [...exercises.value, withRow];
    showToast('Exercise created', 'success');
    return withRow;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to create exercise', 'error');
    throw err;
  }
}

export async function editExercise(
  exercise: ExerciseWithRow,
  token: string,
): Promise<void> {
  try {
    await updateExerciseApi(exercise.sheetRow, exercise, token);
    exercises.value = exercises.value.map((e) => (e.id === exercise.id ? exercise : e));
    showToast('Exercise updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to update exercise', 'error');
    throw err;
  }
}

export async function removeExercise(
  exercise: ExerciseWithRow,
  token: string,
): Promise<void> {
  try {
    await deleteExerciseApi(exercise.sheetRow, token);
    // Re-fetch to get correct sheetRow values after row shift
    const fresh = await fetchExercises(token);
    exercises.value = fresh;
    showToast('Exercise deleted', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to delete exercise', 'error');
    throw err;
  }
}

// ── Workouts ─────────────────────────────────────────────────────────

export async function startWorkout(
  data: { type: WorkoutType; name: string; template_id?: string; copied_from?: string },
  token: string,
): Promise<string> {
  try {
    const workout = await createWorkoutApi({
      type: data.type,
      name: data.name,
      template_id: data.template_id,
      copied_from: data.copied_from,
    }, token);

    const withRow = { ...workout, sheetRow: workouts.value.length + 2 };
    workouts.value = [withRow, ...workouts.value];
    activeWorkoutId.value = workout.id;

    // Pre-populate sets from template if applicable
    if (data.template_id) {
      await prepopulateSetsFromTemplate(workout.id, data.template_id, token);
    } else {
      activeWorkoutSets.value = [];
    }

    return workout.id;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to start workout', 'error');
    throw err;
  }
}

async function prepopulateSetsFromTemplate(
  workoutId: string,
  templateId: string,
  token: string,
): Promise<void> {
  const tpl = templates.value.find((t) => t.id === templateId);
  if (!tpl) {
    activeWorkoutSets.value = [];
    return;
  }

  const newSets: WorkoutSet[] = [];
  for (const ex of tpl.exercises) {
    const setCount = parseSetCount(ex.sets);
    // Warmup exercises get 1 set by default if no sets specified
    const count = ex.section === 'warmup' && !ex.sets.trim() ? 1 : setCount;

    for (let s = 1; s <= count; s++) {
      newSets.push({
        workout_id: workoutId,
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: ex.section as string,
        exercise_order: ex.order,
        set_number: s,
        planned_reps: ex.reps,
        weight: '',
        reps: '',
        effort: '',
        notes: '',
      });
    }
  }

  // Batch append to Sheets
  await appendSetsApi(newSets, token);

  // Re-fetch to get correct sheetRow values
  const allSets = await fetchSets(token);
  sets.value = allSets;
  activeWorkoutSets.value = allSets.filter((s) => s.workout_id === workoutId);
}

export async function saveSet(
  set: WorkoutSet,
  token: string,
): Promise<SetWithRow> {
  try {
    // Check if this set already exists
    const existing = activeWorkoutSets.value.find(
      (s) => s.workout_id === set.workout_id &&
             s.exercise_id === set.exercise_id &&
             s.exercise_order === set.exercise_order &&
             s.set_number === set.set_number,
    );

    if (existing && existing.sheetRow > 0) {
      // Update existing row
      await updateSetApi(existing.sheetRow, set, token);
      const updated: SetWithRow = { ...set, sheetRow: existing.sheetRow };

      activeWorkoutSets.value = activeWorkoutSets.value.map((s) =>
        s.sheetRow === existing.sheetRow ? updated : s,
      );
      sets.value = sets.value.map((s) =>
        s.sheetRow === existing.sheetRow ? updated : s,
      );
      return updated;
    } else {
      // Append new row
      await appendSetApi(set, token);

      // Re-fetch to get correct sheetRow
      const allSets = await fetchSets(token);
      sets.value = allSets;
      const workoutSets = allSets.filter((s) => s.workout_id === set.workout_id);
      activeWorkoutSets.value = workoutSets;

      // Return the newly added set
      const added = workoutSets.find(
        (s) => s.exercise_id === set.exercise_id &&
               s.exercise_order === set.exercise_order &&
               s.set_number === set.set_number,
      );
      return added || { ...set, sheetRow: -1 };
    }
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save set', 'error');
    throw err;
  }
}

export async function removeSet(
  set: SetWithRow,
  token: string,
): Promise<void> {
  try {
    if (set.sheetRow > 0) {
      await deleteSetRow(set.sheetRow, token);
      // Re-fetch to get correct sheetRow values
      const allSets = await fetchSets(token);
      sets.value = allSets;
      activeWorkoutSets.value = allSets.filter((s) => s.workout_id === set.workout_id);
    } else {
      // Not yet saved — just remove from local state
      activeWorkoutSets.value = activeWorkoutSets.value.filter(
        (s) => !(s.exercise_id === set.exercise_id &&
                 s.exercise_order === set.exercise_order &&
                 s.set_number === set.set_number),
      );
    }
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to remove set', 'error');
    throw err;
  }
}

export async function finishWorkout(
  workoutId: string,
  notes: string,
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    // Calculate duration
    const startTime = new Date(`${workout.date}T${workout.time || '00:00'}`);
    const durationMin = Math.round((Date.now() - startTime.getTime()) / 60000);

    const updated = {
      ...workout,
      notes,
      duration_min: String(durationMin > 0 ? durationMin : ''),
    };

    await updateWorkoutApi(workout.sheetRow, updated, token);

    workouts.value = workouts.value.map((w) =>
      w.id === workoutId ? { ...updated, sheetRow: workout.sheetRow } : w,
    );
    activeWorkoutId.value = null;
    activeWorkoutSets.value = [];
    showToast('Workout saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to finish workout', 'error');
    throw err;
  }
}

export async function deleteWorkout(
  workoutId: string,
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    const workoutSets = sets.value.filter((s) => s.workout_id === workoutId);
    await deleteWorkoutRows(workout, workoutSets, token);

    workouts.value = workouts.value.filter((w) => w.id !== workoutId);
    sets.value = sets.value.filter((s) => s.workout_id !== workoutId);

    if (activeWorkoutId.value === workoutId) {
      activeWorkoutId.value = null;
      activeWorkoutSets.value = [];
    }

    showToast('Workout deleted', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to delete workout', 'error');
    throw err;
  }
}

export async function saveWorkoutAsTemplate(
  workoutId: string,
  templateName: string,
  token: string,
): Promise<void> {
  try {
    const workoutSets = sets.value
      .filter((s) => s.workout_id === workoutId)
      .sort((a, b) => a.exercise_order - b.exercise_order || a.set_number - b.set_number);

    if (workoutSets.length === 0) {
      showToast('No exercises to save', 'error');
      return;
    }

    // Deduplicate exercises (keep one entry per exercise_id + exercise_order)
    const seen = new Set<string>();
    const exerciseInputs: TemplateExerciseInput[] = [];
    for (const s of workoutSets) {
      const key = `${s.exercise_id}__${s.exercise_order}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Count sets for this exercise
      const setCount = workoutSets.filter(
        (ws) => ws.exercise_id === s.exercise_id && ws.exercise_order === s.exercise_order,
      ).length;

      exerciseInputs.push({
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section || 'primary',
        sets: String(setCount),
        reps: s.planned_reps || '',
        rest_seconds: '',
        group_rest_seconds: '',
      });
    }

    const created = await createTemplateApi(templateName, exerciseInputs, token);
    templates.value = [...templates.value, created].sort((a, b) => a.name.localeCompare(b.name));
    showToast('Template saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save template', 'error');
    throw err;
  }
}

export async function copyWorkout(
  sourceWorkoutId: string,
  token: string,
): Promise<string> {
  try {
    const source = workouts.value.find((w) => w.id === sourceWorkoutId);
    if (!source) throw new Error('Source workout not found');

    // Create new workout referencing the source
    const workout = await createWorkoutApi({
      type: source.type,
      name: source.name,
      template_id: source.template_id,
      copied_from: sourceWorkoutId,
    }, token);

    const withRow = { ...workout, sheetRow: workouts.value.length + 2 };
    workouts.value = [withRow, ...workouts.value];
    activeWorkoutId.value = workout.id;

    // Copy set structure from source (planned data only, no actuals)
    const sourceSets = sets.value
      .filter((s) => s.workout_id === sourceWorkoutId)
      .sort((a, b) => a.exercise_order - b.exercise_order || a.set_number - b.set_number);

    if (sourceSets.length > 0) {
      const newSets: WorkoutSet[] = sourceSets.map((s) => ({
        workout_id: workout.id,
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        set_number: s.set_number,
        planned_reps: s.planned_reps,
        weight: '',
        reps: '',
        effort: '',
        notes: '',
      }));

      await appendSetsApi(newSets, token);

      const allSets = await fetchSets(token);
      sets.value = allSets;
      activeWorkoutSets.value = allSets.filter((s) => s.workout_id === workout.id);
    } else {
      activeWorkoutSets.value = [];
    }

    return workout.id;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to copy workout', 'error');
    throw err;
  }
}

export async function startSimpleWorkout(
  data: { type: WorkoutType; name: string; notes: string; duration_min: string },
  token: string,
): Promise<void> {
  try {
    const workout = await createWorkoutApi({
      type: data.type,
      name: data.name,
      notes: data.notes,
      duration_min: data.duration_min,
    }, token);

    const withRow = { ...workout, sheetRow: workouts.value.length + 2 };
    workouts.value = [withRow, ...workouts.value];
    showToast('Workout saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save workout', 'error');
    throw err;
  }
}
