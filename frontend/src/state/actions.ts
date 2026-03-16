import { exercises, labels, templates, workouts, sets, loading, activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode, showToast } from './store';
import { isDemo } from '../api/demo-data';
import { fetchExercises, createExercise, updateExercise as updateExerciseApi, deleteExercise as deleteExerciseApi } from '../api/exercises-api';
import { fetchLabels, createLabel as createLabelApi, updateLabel as updateLabelApi, deleteLabel as deleteLabelApi, appendLabels } from '../api/labels-api';
import { fetchTemplateRows, groupTemplateRows, createTemplate as createTemplateApi, updateTemplate as updateTemplateApi, deleteTemplate as deleteTemplateApi, updateExerciseNameInTemplates } from '../api/templates-api';
import { fetchWorkouts, fetchSets, createWorkout as createWorkoutApi, updateWorkout as updateWorkoutApi, deleteWorkoutRows, appendSet as appendSetApi, appendSets as appendSetsApi, updateSet as updateSetApi, deleteSetRow, updateExerciseNameInSets } from '../api/workouts-api';
import { colorKeyFromName } from '../api/label-colors';
import type { TemplateExerciseInput } from '../api/templates-api';
import type { ExerciseWithRow, LabelWithRow, TemplateRowWithRow, WorkoutType, WorkoutSet, SetWithRow } from '../api/types';
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
    const [exerciseData, labelData, templateRowData, workoutData, setData] = await Promise.all([
      fetchExercises(token),
      fetchLabels(token),
      fetchTemplateRows(token),
      fetchWorkouts(token),
      fetchSets(token),
    ]);
    exercises.value = exerciseData;
    templates.value = groupTemplateRows(templateRowData);
    workouts.value = workoutData;
    sets.value = setData;

    // Bootstrap labels: if Labels sheet is empty but exercises have tags, auto-create labels
    if (labelData.length === 0 && exerciseData.length > 0) {
      const bootstrapped = await bootstrapLabels(exerciseData, token);
      labels.value = bootstrapped;
    } else {
      labels.value = labelData;
    }

    loading.value = false;
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to load data:', err);
    showToast('Failed to load data', 'error');
    loading.value = false;
  }
}

/** One-time migration: create label rows for all unique tags found in exercises. */
async function bootstrapLabels(
  exerciseData: ExerciseWithRow[],
  token: string,
): Promise<LabelWithRow[]> {
  const tagSet = new Set<string>();
  for (const ex of exerciseData) {
    if (ex.tags) {
      ex.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
  }
  if (tagSet.size === 0) return [];

  const sorted = Array.from(tagSet).sort();
  const now = new Date().toISOString();
  const newLabels = sorted.map((name) => ({
    id: `lbl_${crypto.randomUUID().slice(0, 8)}`,
    name,
    color_key: colorKeyFromName(name),
    created: now,
  }));

  await appendLabels(newLabels, token);

  // Return with approximate sheetRow values
  return newLabels.map((l, i) => ({ ...l, sheetRow: i + 2 }));
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
    const oldExercise = exercises.value.find((e) => e.id === exercise.id);
    const nameChanged = oldExercise && oldExercise.name !== exercise.name;

    // Update the exercise row itself
    await updateExerciseApi(exercise.sheetRow, exercise, token);
    exercises.value = exercises.value.map((e) => (e.id === exercise.id ? exercise : e));

    // Cascade name change to Templates and Sets
    if (nameChanged) {
      let cascadeError = false;

      // Cascade to Templates
      try {
        const allTemplateRows = templates.value.flatMap((t) => t.exercises);
        await updateExerciseNameInTemplates(exercise.id, exercise.name, allTemplateRows, token);
        // Update local templates signal
        templates.value = templates.value.map((t) => ({
          ...t,
          exercises: t.exercises.map((ex) =>
            ex.exercise_id === exercise.id ? { ...ex, exercise_name: exercise.name } : ex,
          ),
        }));
      } catch {
        cascadeError = true;
      }

      // Cascade to Sets
      try {
        await updateExerciseNameInSets(exercise.id, exercise.name, sets.value, token);
        // Update local sets signal
        sets.value = sets.value.map((s) =>
          s.exercise_id === exercise.id ? { ...s, exercise_name: exercise.name } : s,
        );
        // Update activeWorkoutSets if any match
        activeWorkoutSets.value = activeWorkoutSets.value.map((s) =>
          s.exercise_id === exercise.id ? { ...s, exercise_name: exercise.name } : s,
        );
      } catch {
        cascadeError = true;
      }

      if (cascadeError) {
        showToast('Exercise renamed, but some references couldn\'t update. Try editing the name again.', 'error');
        return;
      }
    }

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
      activeWarmupExercises.value = [];
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
  const warmups: { exercise_id: string; exercise_name: string; exercise_order: number }[] = [];

  for (const ex of tpl.exercises) {
    // Warmup exercises are list-only — no set rows generated
    if (ex.section === 'warmup') {
      warmups.push({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        exercise_order: ex.order,
      });
      continue;
    }

    const setCount = parseSetCount(ex.sets);
    for (let s = 1; s <= setCount; s++) {
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

  activeWarmupExercises.value = warmups;

  if (isDemo()) {
    // In demo mode, appendSets is a no-op and fetchSets returns static data
    // that won't contain our new workout ID. Populate signals directly.
    const baseRow = sets.value.length + 2;
    const setsWithRows: SetWithRow[] = newSets.map((s, i) => ({
      ...s,
      effort: s.effort as SetWithRow['effort'],
      sheetRow: baseRow + i,
    }));
    sets.value = [...sets.value, ...setsWithRows];
    activeWorkoutSets.value = setsWithRows;
    return;
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

export function enterEditMode(workoutId: string): void {
  const workout = workouts.value.find((w) => w.id === workoutId);
  if (!workout) return;

  activeWorkoutId.value = workoutId;
  activeWorkoutSets.value = sets.value.filter((s) => s.workout_id === workoutId);
  activeWarmupExercises.value = [];
  isEditMode.value = true;
}

export function exitEditMode(): void {
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
  isEditMode.value = false;
}

export interface EditWorkoutData {
  date: string;
  name: string;
  notes: string;
}

export interface EditSetData {
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  set_number: number;
  planned_reps: string;
  weight: string;
  reps: string;
  effort: string;
  notes: string;
  sheetRow: number;
}

export async function saveWorkoutEdits(
  workoutId: string,
  metadata: EditWorkoutData,
  editedSets: EditSetData[],
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    // Update workout row (preserve duration, type, template, etc.)
    const updatedWorkout = {
      ...workout,
      date: metadata.date,
      name: metadata.name,
      notes: metadata.notes,
    };
    await updateWorkoutApi(workout.sheetRow, updatedWorkout, token);

    // Determine original sets for this workout
    const originalSets = sets.value.filter((s) => s.workout_id === workoutId);

    // Find removed sets (in original but not in edited)
    const editedKeys = new Set(
      editedSets.map((s) => `${s.exercise_id}__${s.exercise_order}__${s.set_number}`),
    );
    const removedSets = originalSets.filter(
      (s) => !editedKeys.has(`${s.exercise_id}__${s.exercise_order}__${s.set_number}`),
    );

    // Delete removed sets bottom-to-top
    const toDelete = removedSets
      .filter((s) => s.sheetRow > 0)
      .sort((a, b) => b.sheetRow - a.sheetRow);
    for (const s of toDelete) {
      await deleteSetRow(s.sheetRow, token);
    }

    // Find new sets (no sheetRow or sheetRow <= 0)
    const newSets = editedSets.filter((s) => s.sheetRow <= 0);
    if (newSets.length > 0) {
      const toAppend: WorkoutSet[] = newSets.map((s) => ({
        workout_id: workoutId,
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        set_number: s.set_number,
        planned_reps: s.planned_reps,
        weight: s.weight,
        reps: s.reps,
        effort: s.effort as SetWithRow['effort'],
        notes: s.notes,
      }));
      await appendSetsApi(toAppend, token);
    }

    // Update existing sets that may have changed
    const existingSets = editedSets.filter((s) => s.sheetRow > 0);
    for (const s of existingSets) {
      await updateSetApi(s.sheetRow, {
        workout_id: workoutId,
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        set_number: s.set_number,
        planned_reps: s.planned_reps,
        weight: s.weight,
        reps: s.reps,
        effort: s.effort as SetWithRow['effort'],
        notes: s.notes,
      }, token);
    }

    // Re-fetch sets to get correct sheetRow values
    if (!isDemo()) {
      const allSets = await fetchSets(token);
      sets.value = allSets;
    } else {
      // In demo mode, update local signals directly
      const nonWorkoutSets = sets.value.filter((s) => s.workout_id !== workoutId);
      const updatedSets: SetWithRow[] = editedSets.map((s, i) => ({
        workout_id: workoutId,
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        set_number: s.set_number,
        planned_reps: s.planned_reps,
        weight: s.weight,
        reps: s.reps,
        effort: s.effort as SetWithRow['effort'],
        notes: s.notes,
        sheetRow: s.sheetRow > 0 ? s.sheetRow : 1000 + i,
      }));
      sets.value = [...nonWorkoutSets, ...updatedSets];
    }

    // Update workout in local signal
    workouts.value = workouts.value.map((w) =>
      w.id === workoutId ? { ...updatedWorkout, sheetRow: workout.sheetRow } : w,
    );

    // Clear edit mode
    exitEditMode();
    showToast('Workout updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save changes', 'error');
    throw err;
  }
}

export async function saveSimpleWorkoutEdits(
  workoutId: string,
  metadata: EditWorkoutData,
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    const updatedWorkout = {
      ...workout,
      date: metadata.date,
      name: metadata.name,
      notes: metadata.notes,
    };
    await updateWorkoutApi(workout.sheetRow, updatedWorkout, token);

    workouts.value = workouts.value.map((w) =>
      w.id === workoutId ? { ...updatedWorkout, sheetRow: workout.sheetRow } : w,
    );

    showToast('Workout updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save changes', 'error');
    throw err;
  }
}

// ── Labels ──────────────────────────────────────────────────────────

export async function addLabel(
  data: { name: string; color_key: string },
  token: string,
): Promise<LabelWithRow> {
  try {
    const created = await createLabelApi(data, token);
    const withRow: LabelWithRow = {
      ...created,
      sheetRow: labels.value.length + 2,
    };
    labels.value = [...labels.value, withRow];
    showToast('Label created', 'success');
    return withRow;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to create label', 'error');
    throw err;
  }
}

export async function renameLabel(
  label: LabelWithRow,
  newName: string,
  token: string,
): Promise<void> {
  try {
    const oldName = label.name;

    // Update all exercises that have this tag
    const affected = exercises.value.filter(ex =>
      ex.tags.split(',').map(t => t.trim()).filter(Boolean).includes(oldName),
    );

    for (const ex of affected) {
      const tags = ex.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updated = tags.map(t => t === oldName ? newName : t).join(', ');
      const updatedEx: ExerciseWithRow = { ...ex, tags: updated };
      await updateExerciseApi(ex.sheetRow, updatedEx, token);
      exercises.value = exercises.value.map(e => e.id === ex.id ? updatedEx : e);
    }

    // Update the label itself
    const updatedLabel: LabelWithRow = { ...label, name: newName };
    await updateLabelApi(label.sheetRow, updatedLabel, token);
    labels.value = labels.value.map(l => l.id === label.id ? updatedLabel : l);

    showToast(`Renamed '${oldName}' to '${newName}' across ${affected.length} exercises`, 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to rename label', 'error');
    throw err;
  }
}

export async function updateLabelColor(
  label: LabelWithRow,
  newColorKey: string,
  token: string,
): Promise<void> {
  try {
    const updatedLabel: LabelWithRow = { ...label, color_key: newColorKey };
    await updateLabelApi(label.sheetRow, updatedLabel, token);
    labels.value = labels.value.map(l => l.id === label.id ? updatedLabel : l);
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to update label color', 'error');
    throw err;
  }
}

export async function removeLabel(
  label: LabelWithRow,
  token: string,
): Promise<number> {
  try {
    const labelName = label.name;

    // Remove from all exercises that have this tag
    const affected = exercises.value.filter(ex =>
      ex.tags.split(',').map(t => t.trim()).filter(Boolean).includes(labelName),
    );

    for (const ex of affected) {
      const tags = ex.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updated = tags.filter(t => t !== labelName).join(', ');
      const updatedEx: ExerciseWithRow = { ...ex, tags: updated };
      await updateExerciseApi(ex.sheetRow, updatedEx, token);
      exercises.value = exercises.value.map(e => e.id === ex.id ? updatedEx : e);
    }

    // Delete the label row
    await deleteLabelApi(label.sheetRow, token);

    // Re-fetch labels to get correct sheetRow values after row shift
    const fresh = await fetchLabels(token);
    labels.value = fresh;

    showToast(`Deleted '${labelName}' from ${affected.length} exercises`, 'success');
    return affected.length;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to delete label', 'error');
    throw err;
  }
}
