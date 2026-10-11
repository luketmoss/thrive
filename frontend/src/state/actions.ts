import { batch } from '@preact/signals';
import { journalEntries, journalSaveSeq, journalSavedSince, exercises, labels, templates, workouts, sets, loading, activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode, showToast, syncLog, withingsSyncLog, syncRequests, syncAsk, demoSyncPressedAt, dailyHealth, bodyMeasurements, dailySummary } from './store';
import type { HealthTabState, WarmupExerciseInfo } from './store';
import { templateWarmupsToRestore } from '../components/workout/template-warmups';
import type { JournalEntry } from '../api/types';
import { fetchJournal } from '../api/journal-api';
import { isNoteLocked } from '../panels/journal/drafts';
import { fetchSyncRequests, appendSyncRequests, type SyncRequestVendor } from '../api/sync-requests-api';
import { demoSyncNowScenario } from '../api/sync-now-demo';
import { fetchSyncLog, fetchWithingsSyncLog } from '../api/sync-log-api';
import { fetchDailyHealth, fetchBodyMeasurements, fetchDailySummary } from '../api/health-api';
import { SyncLogNotSetUpError } from '../api/sync-log-errors';
import { enqueueSet, initPendingCount, shiftQueueAfterDelete, dropQueuedAppend } from '../api/sync-queue';
import { isDemo } from '../api/demo-data';
import { throttled } from './page-visible';
import { fetchExercises, createExercise, updateExercise as updateExerciseApi, deleteExercise as deleteExerciseApi } from '../api/exercises-api';
import { fetchLabels, createLabel as createLabelApi, updateLabel as updateLabelApi, deleteLabel as deleteLabelApi, appendLabels } from '../api/labels-api';
import { fetchTemplateRows, groupTemplateRows, createTemplate as createTemplateApi, updateTemplate as updateTemplateApi, deleteTemplate as deleteTemplateApi, updateExerciseNameInTemplates } from '../api/templates-api';
import { fetchWorkouts, fetchSets, createWorkout as createWorkoutApi, updateWorkout as updateWorkoutApi, deleteWorkoutRows, appendSet as appendSetApi, appendSets as appendSetsApi, updateSet as updateSetApi, deleteSetRow, updateExerciseNameInSets, findWorkoutRow, WorkoutRowMismatchError, builderExercisesToSets, carryPlannedSetValues, replaceWorkoutSets as replaceWorkoutSetsApi } from '../api/workouts-api';
import type { WorkoutPatch } from '../api/workouts-api';
import { toLocalDateStr, formatPlannedDate } from '../components/activities/activities-helpers';
import { colorKeyFromName } from '../api/label-colors';
import type { TemplateExerciseInput } from '../api/templates-api';
import type { ExerciseWithRow, LabelWithRow, TemplateRowWithRow, Workout, WorkoutWithRow, WorkoutType, WorkoutSet, SetWithRow, BuilderExercise, Effort } from '../api/types';
import { ReauthFailedError } from '../auth/reauth';
import { SheetsApiError } from '../api/sheets';

function isReauthFailure(err: unknown): boolean {
  return err instanceof ReauthFailedError;
}

const WORKOUT_OUT_OF_SYNC_MESSAGE = "Couldn't save — this workout is out of sync. Reload and try again.";

/**
 * Resolve a newly-created workout's true sheetRow instead of guessing
 * `workouts.value.length + 2` — that guess is wrong whenever the local list
 * doesn't exactly mirror the sheet (e.g. right after a delete elsewhere in
 * the session). Falls back to the guess in demo mode, where there is no
 * real sheet to re-fetch from.
 */
async function resolveNewWorkoutRow(workout: Workout, token: string): Promise<WorkoutWithRow> {
  if (isDemo()) {
    return { ...workout, sheetRow: workouts.value.length + 2 };
  }
  const found = await findWorkoutRow(workout.id, token);
  return found ?? { ...workout, sheetRow: workouts.value.length + 2 };
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
  workoutsRefresh.markStarted(); // the initial read counts toward the 60 s guard (#249)
  libraryRefresh.markStarted(); // ...and toward the library loader's own clock (#252)
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

    // Restore active workout if one exists (survives page refresh)
    const active = workoutData.find((w) => w.status === 'active');
    if (active) {
      activeWorkoutId.value = active.id;
      activeWorkoutSets.value = setData.filter((s) => s.workout_id === active.id);
    }

    initPendingCount();
    loading.value = false;
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to load data:', err);
    showToast('Failed to load data', 'error');
    loading.value = false;
  }
}

// ── Background refresh on visibility (#249) ──────────────────────────

/**
 * Re-read Workouts and Sets with no spinner and swap them in together. All or
 * nothing: a failure leaves both untouched. If either signal was replaced
 * locally while the read was in flight, the result is discarded whole.
 * The edit-route / offline-queue guard lives in app.tsx.
 */
export async function refreshWorkouts(token: string): Promise<void> {
  if (isDemo() || loading.value) return;
  const startWorkouts = workouts.value;
  const startSets = sets.value;
  try {
    const [workoutData, setData] = await Promise.all([fetchWorkouts(token), fetchSets(token)]);
    if (workouts.value !== startWorkouts || sets.value !== startSets) return;
    batch(() => {
      workouts.value = workoutData;
      sets.value = setData;
    });
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.warn('Background refresh of workouts failed:', err);
  }
}

/** The shared throttle for the Workouts refresh; `loadInitialData` stamps it. */
export const workoutsRefresh = throttled(refreshWorkouts);

// ── Background refresh of Exercises, Templates and Labels (#252) ─────

/**
 * Re-read Exercises, Templates and Labels with no spinner and swap them in
 * together, so a template never points at an exercise the store lacks. All or
 * nothing: a failure leaves all three untouched. If any was replaced locally
 * while the read was in flight, the result is discarded whole. The label
 * bootstrap stays a `loadInitialData`-only migration. The edit-route /
 * offline-queue guard lives in app.tsx.
 */
export async function refreshLibraryData(token: string): Promise<void> {
  if (isDemo() || loading.value) return;
  const startExercises = exercises.value;
  const startTemplates = templates.value;
  const startLabels = labels.value;
  try {
    const [exerciseData, templateRows, labelData] = await Promise.all([
      fetchExercises(token),
      fetchTemplateRows(token),
      fetchLabels(token),
    ]);
    if (
      exercises.value !== startExercises ||
      templates.value !== startTemplates ||
      labels.value !== startLabels
    ) {
      return;
    }
    batch(() => {
      exercises.value = exerciseData;
      templates.value = groupTemplateRows(templateRows);
      labels.value = labelData;
    });
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.warn('Background refresh of exercises, templates and labels failed:', err);
  }
}

/** The library loader's own throttle (independent of Workouts'); `loadInitialData` stamps it. */
export const libraryRefresh = throttled(refreshLibraryData);

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

export async function saveWorkoutForLater(
  data: {
    type: WorkoutType; name: string; template_id?: string; exercises?: BuilderExercise[]; date?: string;
    /** #145: seconds, or '' / omitted when nobody estimated it. Never defaulted. */
    estimated_seconds?: string;
  },
  token: string,
): Promise<void> {
  try {
    const workout = await createWorkoutApi({
      type: data.type,
      name: data.name,
      template_id: data.template_id,
      date: data.date,
      status: 'planned',
      estimated_seconds: data.estimated_seconds,
    }, token);

    const withRow = await resolveNewWorkoutRow(workout, token);
    workouts.value = [withRow, ...workouts.value];

    // Write the plan's set rows. A plan is not the active workout, so the
    // active signals are left exactly as they are, in every branch (#351 AC1).
    if (data.template_id) {
      await prepopulateSetsFromTemplate(workout.id, data.template_id, token);
    } else if (data.exercises && data.exercises.length > 0) {
      await prepopulateSetsFromBuilder(workout.id, data.exercises, token);
    }

    showToast('Workout saved for later', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save workout', 'error');
    throw err;
  }
}

export async function startPlannedWorkout(
  workoutId: string,
  token: string,
): Promise<string> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    const now = new Date();
    const date = toLocalDateStr(now);
    const time = now.toTimeString().slice(0, 5);

    const updated = await updateWorkoutApi(workout, { status: 'active', date, time }, token);
    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updated : w));

    activeWorkoutId.value = workoutId;
    activeWorkoutSets.value = sets.value.filter((s) => s.workout_id === workoutId);

    // #349 AC5's rule, shared with the resume effect (#351 AC4).
    activeWarmupExercises.value = templateWarmupsToRestore(
      workout.template_id, activeWorkoutSets.value, templates.value,
    );

    return workoutId;
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to start workout', 'error');
    throw err;
  }
}

export async function startWorkout(
  data: { type: WorkoutType; name: string; template_id?: string; copied_from?: string; exercises?: BuilderExercise[] },
  token: string,
): Promise<string> {
  // The new workout, once its row exists and it is in `workouts`.
  let started: Workout | null = null;
  try {
    const workout = await createWorkoutApi({
      type: data.type,
      name: data.name,
      template_id: data.template_id,
      copied_from: data.copied_from,
      status: 'active',
    }, token);

    const withRow = await resolveNewWorkoutRow(workout, token);
    workouts.value = [withRow, ...workouts.value];
    started = workout;

    // Pre-populate sets from template, builder exercises, or empty. Only a
    // started workout assigns the active signals from what was written (#351),
    // all three together, so the id never pairs with another workout's rows (#374).
    const written = data.template_id
      ? await prepopulateSetsFromTemplate(workout.id, data.template_id, token)
      : data.exercises && data.exercises.length > 0
        ? await prepopulateSetsFromBuilder(workout.id, data.exercises, token)
        : { rows: [], warmups: [] };
    batch(() => {
      activeWorkoutId.value = workout.id;
      activeWorkoutSets.value = written.rows;
      activeWarmupExercises.value = written.warmups;
    });

    return workout.id;
  } catch (err) {
    if (started) {
      // The row exists (status active) but its sets did not all land: make the
      // three signals what opening #/workout/<id> would derive for it (#374).
      const { id, template_id } = started;
      const ownSets = sets.value.filter((s) => s.workout_id === id);
      batch(() => {
        activeWorkoutId.value = id;
        activeWorkoutSets.value = ownSets;
        activeWarmupExercises.value = templateWarmupsToRestore(template_id, ownSets, templates.value);
      });
    }
    if (isReauthFailure(err)) throw err;
    showToast('Failed to start workout', 'error');
    throw err;
  }
}

/** What a prepopulate wrote for one workout: its set rows and its warmup list. */
interface PrepopulatedSets {
  rows: SetWithRow[];
  warmups: WarmupExerciseInfo[];
}

/**
 * Write a workout's set rows from a template and update `sets` (live and
 * demo). Never touches the active signals: the caller decides (#351).
 */
async function prepopulateSetsFromTemplate(
  workoutId: string,
  templateId: string,
  token: string,
): Promise<PrepopulatedSets> {
  const tpl = templates.value.find((t) => t.id === templateId);
  if (!tpl) return { rows: [], warmups: [] };

  const newSets: WorkoutSet[] = [];
  const warmups: WarmupExerciseInfo[] = [];

  for (const ex of tpl.exercises) {
    if (ex.section === 'warmup') {
      warmups.push({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        exercise_order: ex.order,
      });
      // Persist a single set row so warmup exercises survive across sessions
      newSets.push({
        workout_id: workoutId,
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: 'warmup',
        exercise_order: ex.order,
        set_number: 1,
        planned_reps: '',
        weight: '',
        reps: '',
        effort: '',
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
      });
    }
  }

  return { rows: await writePrepopulatedSets(workoutId, newSets, token), warmups };
}

/**
 * Write a workout's set rows from builder exercises and update `sets` (live
 * and demo). Never touches the active signals: the caller decides (#351).
 */
async function prepopulateSetsFromBuilder(
  workoutId: string,
  builderExercises: BuilderExercise[],
  token: string,
): Promise<PrepopulatedSets> {
  // A warmup is persisted as a single set row so it survives across sessions.
  const newSets = builderExercisesToSets(workoutId, builderExercises);
  const warmups = newSets
    .filter((s) => s.section === 'warmup')
    .map((s) => ({ exercise_id: s.exercise_id, exercise_name: s.exercise_name, exercise_order: s.exercise_order }));

  return { rows: await writePrepopulatedSets(workoutId, newSets, token), warmups };
}

/** Append one workout's new set rows, update `sets`, and return its rows with their `sheetRow`s. */
async function writePrepopulatedSets(
  workoutId: string,
  newSets: WorkoutSet[],
  token: string,
): Promise<SetWithRow[]> {
  if (isDemo()) {
    // In demo mode, appendSets is a no-op and fetchSets returns static data
    // that won't contain our new workout ID. Add the rows to `sets` directly.
    const baseRow = sets.value.length + 2;
    const setsWithRows: SetWithRow[] = newSets.map((s, i) => ({
      ...s,
      effort: s.effort as SetWithRow['effort'],
      sheetRow: baseRow + i,
    }));
    sets.value = [...sets.value, ...setsWithRows];
    return setsWithRows;
  }

  // Batch append to Sheets, then re-fetch to get correct sheetRow values
  await appendSetsApi(newSets, token);
  const allSets = await fetchSets(token);
  sets.value = allSets;
  return allSets.filter((s) => s.workout_id === workoutId);
}

/** `saveSet` refused a row that no longer holds the set it was given for (#389). */
export class SetRowStaleError extends Error {
  constructor(public readonly sheetRow: number) {
    super(`Sets row ${sheetRow} no longer holds this set`);
    this.name = 'SetRowStaleError';
  }
}

/**
 * Writes one set. `ownRow` is the set's own sheet row as the caller holds it
 * (#389): given a row (> 0), that row is updated and nothing is looked up by
 * order; given `-1`, the set has no row yet and one is appended. Left out,
 * the row is looked up by `(exercise_id, exercise_order, set_number)` as
 * before (Finish's loop and the edit flows, #392). The offline fallback
 * queues the same row the save was aimed at.
 *
 * A given row is checked against `activeWorkoutSets`, which every row write
 * and delete re-derives, before anything is written: it must hold this
 * workout's set of the same exercise and set number, with the same section
 * or the same order (a move changes only the order, a section change only
 * the section). A backstop: the tracker shifts its cached rows after every
 * delete (#394), so a row should never fail it. One that does is never
 * written or queued; the save is refused, the set stays unsaved, and Finish
 * saves it.
 */
export async function saveSet(
  set: WorkoutSet,
  token: string,
  ownRow?: number,
): Promise<SetWithRow> {
  const findByOrder = () => activeWorkoutSets.value.find(
    (s) => s.workout_id === set.workout_id &&
           s.exercise_id === set.exercise_id &&
           s.exercise_order === set.exercise_order &&
           s.set_number === set.set_number,
  );
  const targetRow = () => (ownRow !== undefined ? ownRow : findByOrder()?.sheetRow ?? -1);

  if (ownRow !== undefined && ownRow > 0) {
    const at = activeWorkoutSets.value.find((s) => s.sheetRow === ownRow);
    const holdsThisSet = !!at &&
      at.workout_id === set.workout_id &&
      at.exercise_id === set.exercise_id &&
      at.set_number === set.set_number &&
      (at.section === set.section || at.exercise_order === set.exercise_order);
    if (!holdsThisSet) {
      showToast('Set not saved yet. It will be saved when you finish.', 'error');
      throw new SetRowStaleError(ownRow);
    }
  }

  try {
    const row = targetRow();

    if (row > 0) {
      // Update existing row
      await updateSetApi(row, set, token);
      const updated: SetWithRow = { ...set, sheetRow: row };

      activeWorkoutSets.value = activeWorkoutSets.value.map((s) =>
        s.sheetRow === row ? updated : s,
      );
      sets.value = sets.value.map((s) =>
        s.sheetRow === row ? updated : s,
      );
      return updated;
    } else {
      // Append new row
      await appendSetApi(set, token);

      if (isDemo()) {
        // In demo mode the append is a no-op and a re-fetch returns static
        // data without this row: add it in memory, one row below the last, as
        // writePrepopulatedSets does, so a resume shows it (#394 AC4).
        const lastRow = sets.value.reduce((max, s) => Math.max(max, s.sheetRow), 1);
        const added: SetWithRow = { ...set, effort: set.effort as SetWithRow['effort'], sheetRow: lastRow + 1 };
        batch(() => {
          sets.value = [...sets.value, added];
          activeWorkoutSets.value = [...activeWorkoutSets.value, added];
        });
        return added;
      }

      // Re-fetch to get correct sheetRow
      const allSets = await fetchSets(token);
      sets.value = allSets;
      const workoutSets = allSets.filter((s) => s.workout_id === set.workout_id);
      activeWorkoutSets.value = workoutSets;

      // The row just appended is the LAST match: an append lands below every
      // existing row, so an earlier match is another set's row — a
      // duplicate's twin at the same order and set number (#389).
      const matches = workoutSets.filter(
        (s) => s.exercise_id === set.exercise_id &&
               s.exercise_order === set.exercise_order &&
               s.set_number === set.set_number,
      );
      return matches[matches.length - 1] || { ...set, sheetRow: -1 };
    }
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    // Network failure (fetch rejection) or non-401 HTTP error → queue silently (AC1, AC6)
    if (err instanceof TypeError || (err instanceof SheetsApiError && err.status !== 401)) {
      enqueueSet({ ...set, sheetRow: targetRow() });
      throw err; // re-throw so caller leaves set as unsaved
    }
    showToast('Failed to save set', 'error');
    throw err;
  }
}

/**
 * Rows after Sets row `row` was deleted (#394): the row's set is gone and
 * every set below it holds one less, as in the sheet.
 */
export function dropAndShiftRows<T extends { sheetRow: number }>(rows: T[], row: number): T[] {
  return rows
    .filter((s) => s.sheetRow !== row)
    .map((s) => (s.sheetRow > row ? { ...s, sheetRow: s.sheetRow - 1 } : s));
}

/**
 * Delete a set's Sets row. Resolves once the delete has landed and `sets`,
 * `activeWorkoutSets` and the offline queue follow it; rejects (with the
 * "Failed to remove set" toast) having shifted nothing.
 */
export async function removeSet(
  set: SetWithRow,
  token: string,
): Promise<void> {
  try {
    if (set.sheetRow > 0) {
      const row = set.sheetRow;
      await deleteSetRow(row, token);
      // The delete landed: every row below it moved up by one. Follow that
      // here, as the tracker does, rather than re-fetching (#394): the same
      // rule keeps memory and the tracker in step, and in demo mode, where
      // nothing is deleted, a re-fetch would return the static data.
      batch(() => {
        sets.value = dropAndShiftRows(sets.value, row);
        activeWorkoutSets.value = dropAndShiftRows(activeWorkoutSets.value, row);
      });
      try {
        shiftQueueAfterDelete(row);
      } catch {
        // Storage unavailable: there is no queue to shift.
      }
    } else {
      // No row: no request, and no row in memory is touched. Never matched by
      // exercise, order and set number, which a duplicate's twin or a moved
      // exercise's row can share (#394). Only its queued append goes.
      try {
        dropQueuedAppend(set);
      } catch {
        // Storage unavailable: there is no queue to drop it from.
      }
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
  effort: Effort | '',
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    // Elapsed time, in the seconds the column now stores. An unfinishable
    // clock (negative elapsed) leaves the field empty rather than writing 0 —
    // no duration and a zero duration are different facts.
    const startTime = new Date(`${workout.date}T${workout.time || '00:00'}`);
    const elapsedSeconds = Math.round((Date.now() - startTime.getTime()) / 1000);

    const updated = await updateWorkoutApi(workout, {
      notes,
      status: '',
      elapsed_seconds: String(elapsedSeconds > 0 ? elapsedSeconds : ''),
      effort,
    }, token);

    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updated : w));
    activeWorkoutId.value = null;
    activeWorkoutSets.value = [];
    showToast('Workout saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to finish workout', 'error');
    throw err;
  }
}

export async function deleteWorkout(
  workoutId: string,
  token: string,
): Promise<void> {
  try {
    // Corrupted data can have more than one row sharing an id (issue #95) —
    // delete only the first matching row, not every row with this id.
    const matches = workouts.value.filter((w) => w.id === workoutId);
    if (matches.length === 0) throw new Error('Workout not found');
    const workout = matches[0];

    // If a duplicate row still shares this id, its Sets rows may be the
    // same rows the sibling duplicate needs — only remove Sets once this
    // is the last row for this id.
    const workoutSets = matches.length === 1
      ? sets.value.filter((s) => s.workout_id === workoutId)
      : [];

    await deleteWorkoutRows(workout, workoutSets, token);

    if (!isDemo()) {
      // Re-fetch so every cached sheetRow reflects the post-delete row
      // shift (Sheets moves every row below the deleted one up by one) —
      // fixes the stale sheetRow bug behind issue #95.
      const [freshWorkouts, freshSets] = await Promise.all([
        fetchWorkouts(token),
        fetchSets(token),
      ]);
      workouts.value = freshWorkouts;
      sets.value = freshSets;
      if (activeWorkoutId.value && activeWorkoutId.value !== workoutId) {
        activeWorkoutSets.value = freshSets.filter((s) => s.workout_id === activeWorkoutId.value);
      }
    } else {
      workouts.value = workouts.value.filter((w) => w.id !== workoutId);
      sets.value = sets.value.filter((s) => s.workout_id !== workoutId);
    }

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

    const withRow = await resolveNewWorkoutRow(workout, token);
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
  data: { type: WorkoutType; name: string; notes: string; elapsed_seconds: string; effort: Effort | '';
         distance_m: string; ascent_m: string; descent_m: string; avg_hr: string; date?: string;
         sub_type?: string },
  token: string,
): Promise<void> {
  try {
    const workout = await createWorkoutApi({
      type: data.type,
      name: data.name,
      notes: data.notes,
      elapsed_seconds: data.elapsed_seconds,
      effort: data.effort,
      distance_m: data.distance_m,
      ascent_m: data.ascent_m,
      descent_m: data.descent_m,
      avg_hr: data.avg_hr,
      sub_type: data.sub_type,
      date: data.date,
    }, token);

    const withRow = await resolveNewWorkoutRow(workout, token);
    workouts.value = [withRow, ...workouts.value];
    showToast('Workout saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast('Failed to save workout', 'error');
    throw err;
  }
}

export interface SimpleWorkoutData {
  name: string; notes: string; elapsed_seconds: string; effort: Effort | '';
  distance_m: string; ascent_m: string; descent_m: string; avg_hr: string;
  sub_type: string; date: string;
}

/**
 * Finishes a started planned non-weight workout in place (#360): the quick-log
 * form's values go onto the existing row, `status` clears and the active state
 * is released. Never creates a row. `estimated_seconds` stays as the plan's record.
 */
export async function finishSimpleWorkout(
  workoutId: string,
  data: SimpleWorkoutData,
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    const updated = await updateWorkoutApi(workout, { ...data, status: '' }, token);

    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updated : w));
    if (activeWorkoutId.value === workoutId) {
      activeWorkoutId.value = null;
      activeWorkoutSets.value = [];
    }
    showToast('Workout saved', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to save workout', 'error');
    throw err;
  }
}

export function enterEditMode(workoutId: string): void {
  const workout = workouts.value.find((w) => w.id === workoutId);
  if (!workout) return;

  activeWorkoutId.value = workoutId;
  activeWorkoutSets.value = sets.value.filter((s) => s.workout_id === workoutId);
  isEditMode.value = true;

  // Restore warmup exercises from template (warmups are list-only, not stored as set rows)
  if (workout.template_id) {
    const tpl = templates.value.find((t) => t.id === workout.template_id);
    if (tpl) {
      const existingExerciseIds = new Set(
        activeWorkoutSets.value.map((s) => s.exercise_id),
      );
      activeWarmupExercises.value = tpl.exercises
        .filter((ex) => ex.section === 'warmup')
        .filter((ex) => !existingExerciseIds.has(ex.exercise_id))
        .map((ex) => ({
          exercise_id: ex.exercise_id,
          exercise_name: ex.exercise_name,
          exercise_order: ex.order,
        }));
    } else {
      activeWarmupExercises.value = [];
    }
  } else {
    activeWarmupExercises.value = [];
  }
}

export function exitEditMode(): void {
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
  isEditMode.value = false;
}

/**
 * The workout fields an edit form changed, as stored: seconds, integer meters,
 * bpm. Forms convert from what was typed at their boundary (`edit-patch.ts`).
 *
 * A field is present only when its input differs from what it was pre-filled
 * with (#172). An absent field is left exactly as the sheet holds it; `''` is
 * a deliberate clearing. The pre-fills are lossy (whole minutes, tenths of a
 * mile), so re-sending an untouched field would round a synced value and stop
 * it tracking COROS.
 */
export type EditWorkoutData = Partial<Pick<Workout,
  'date' | 'name' | 'notes' | 'elapsed_seconds' | 'effort'
  | 'distance_m' | 'ascent_m' | 'descent_m' | 'avg_hr' | 'sub_type'>>;

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

    // Only the changed fields; every other column stays as the sheet holds it.
    const updatedWorkout = await updateWorkoutApi(workout, metadata, token);

    // A stored set is identified by its row, not by exercise/order/set: a
    // reorder changes exercise_order without making the row a different set
    // (#177). Only this workout's own rows can be kept; an edited set carrying
    // any other row is written as new rather than over someone else's row.
    const originalSets = sets.value.filter((s) => s.workout_id === workoutId);
    const ownRows = new Set(originalSets.map((s) => s.sheetRow).filter((r) => r > 0));
    const existingSets = editedSets.filter((s) => ownRows.has(s.sheetRow));
    const newSets = editedSets.filter((s) => !ownRows.has(s.sheetRow));
    const keptRows = new Set(existingSets.map((s) => s.sheetRow));
    const removedSets = originalSets.filter((s) => s.sheetRow > 0 && !keptRows.has(s.sheetRow));

    // Update kept rows first, while every cached sheetRow still points at its
    // own row. Deleting first shifted each row below up by one, so the
    // updates landed a row low per deletion: stale copies above, and the next
    // workout's first sets overwritten below (#177).
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
      }, token);
    }

    // Then delete removed rows bottom-to-top, so each delete leaves the rows
    // still to be deleted where they were.
    const toDelete = [...removedSets].sort((a, b) => b.sheetRow - a.sheetRow);
    for (const s of toDelete) {
      await deleteSetRow(s.sheetRow, token);
    }

    // New sets append at the end, so they never touch an existing row.
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
      }));
      await appendSetsApi(toAppend, token);
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
        sheetRow: ownRows.has(s.sheetRow) ? s.sheetRow : 1000 + i,
      }));
      sets.value = [...nonWorkoutSets, ...updatedSets];
    }

    // Update workout in local signal
    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updatedWorkout : w));

    // Clear edit mode
    exitEditMode();
    showToast('Workout updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to save changes', 'error');
    throw err;
  }
}

const PLANNED_SETS_FAILED_MESSAGE = "Couldn't save the exercises. Try again.";

/**
 * Saves the planned-workout editor in place (#349): the same `Workouts` row
 * and the same id, so `created`, `time`, `template_id`, `copied_from`,
 * `notes` and every sync column stay as the sheet holds them.
 *
 * The row patch goes first, so a row mismatch writes nothing at all. Then
 * the sets are made the planner's structure in one atomic write. If that
 * fails, the only partial state is "name/date/estimate saved, exercises
 * not", which the toast says, and Save simply runs again: the patch is then
 * empty or the same, and the reconcile starts from a fresh read.
 *
 * Unlike `saveWorkoutEdits` it never calls `exitEditMode` and never touches
 * the active workout's signals: a plan is not the workout being tracked.
 *
 * @param patch only the fields the user changed, from `name`, `date` and
 *   `estimated_seconds`. Empty when only the exercises changed.
 */
export async function savePlannedWorkoutEdits(
  workoutId: string,
  patch: Pick<WorkoutPatch, 'name' | 'date' | 'estimated_seconds'>,
  exercises: BuilderExercise[],
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');
    const updated = await updateWorkoutApi(workout, patch, token);
    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updated : w));
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to save changes', 'error');
    throw err;
  }

  try {
    const desired = builderExercisesToSets(workoutId, exercises);
    if (isDemo()) {
      // No sheet to read: carry from the store. The rows move to the end of
      // the list (screens sort by order and set number), keeping their
      // sheetRows where they can so every sheetRow stays unique.
      const own = sets.value.filter((s) => s.workout_id === workoutId);
      const rows = carryPlannedSetValues(own, desired, exercises);
      const others = sets.value.filter((s) => s.workout_id !== workoutId);
      const baseRow = Math.max(1, ...sets.value.map((s) => s.sheetRow)) + 1;
      sets.value = [...others, ...rows.map((s, i) => ({ ...s, sheetRow: own[i]?.sheetRow ?? baseRow + i }))];
    } else {
      await replaceWorkoutSetsApi(workoutId, desired, token, exercises);
      // Inside this try on purpose: if the refetch fails the store still
      // shows the old exercises, and a retry is harmless (an unchanged plan
      // writes nothing).
      sets.value = await fetchSets(token);
    }
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    showToast(PLANNED_SETS_FAILED_MESSAGE, 'error');
    throw err;
  }

  showToast('Workout updated', 'success');
}

export async function saveSimpleWorkoutEdits(
  workoutId: string,
  metadata: EditWorkoutData,
  token: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');

    // Only the changed fields; every other column stays as the sheet holds it.
    const updatedWorkout = await updateWorkoutApi(workout, metadata, token);

    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updatedWorkout : w));

    showToast('Workout updated', 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast('Failed to save changes', 'error');
    throw err;
  }
}

/**
 * Moves a workout to `date` in place (#347): the same row and id, only `date`
 * written, through `updateWorkout`'s patch write. Its sets, template, estimate,
 * notes and `created` stay as the sheet holds them. Nothing is written when the
 * date is unchanged.
 *
 * @param today the Day view's today, so the toast says "Moved to today" for it
 *   and "Rescheduled to <formatPlannedDate>" for any other date.
 */
export async function rescheduleWorkout(
  workoutId: string,
  date: string,
  token: string,
  today: string,
): Promise<void> {
  try {
    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) throw new Error('Workout not found');
    if (workout.date === date) return;

    const updated = await updateWorkoutApi(workout, { date }, token);
    workouts.value = workouts.value.map((w) => (w.id === workoutId ? updated : w));

    showToast(date === today ? 'Moved to today' : `Rescheduled to ${formatPlannedDate(date, today)}`, 'success');
  } catch (err) {
    if (isReauthFailure(err)) throw err;
    if (err instanceof WorkoutRowMismatchError) {
      showToast(WORKOUT_OUT_OF_SYNC_MESSAGE, 'error');
      throw err;
    }
    showToast(date === today ? 'Failed to move workout' : 'Failed to reschedule workout', 'error');
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

// ── COROS SyncLog (#157) ─────────────────────────────────────────────

/**
 * Read SyncLog for the Settings screen's "Last synced" line. A revisit keeps
 * the rows on screen while it re-reads, so the line does not flicker back to
 * "Checking…". A failure is shown in place, never as a toast: this line is a
 * monitor, and its failure is itself the thing to show.
 */
export async function loadSyncLog(token: string): Promise<void> {
  if (syncLog.value.state !== 'loaded') syncLog.value = { state: 'loading' };
  try {
    const entries = await fetchSyncLog(token);
    syncLog.value = { state: 'loaded', entries };
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to read SyncLog:', err);
    syncLog.value = { state: 'error' };
  }
}

/**
 * Read WithingsSyncLog for the Settings screen's "Withings last synced" row
 * (#200, #210). Independent of `loadSyncLog`: a failure here never touches
 * `syncLog`, and vice versa. A missing tab (before #200's migration has run)
 * reads as "not set up yet", not as a failed read.
 */
export async function loadWithingsSyncLog(token: string): Promise<void> {
  if (withingsSyncLog.value.state !== 'loaded') withingsSyncLog.value = { state: 'loading' };
  try {
    const entries = await fetchWithingsSyncLog(token);
    withingsSyncLog.value = { state: 'loaded', entries };
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    if (err instanceof SyncLogNotSetUpError) {
      withingsSyncLog.value = { state: 'not-set-up' };
      return;
    }
    console.error('Failed to read WithingsSyncLog:', err);
    withingsSyncLog.value = { state: 'error' };
  }
}

// ── Sync now (#315) ──────────────────────────────────────────────────

/** Re-read the request rows. A failed read keeps what is on screen: the next poll tries again. */
export async function loadSyncRequests(token: string): Promise<void> {
  try {
    syncRequests.value = await fetchSyncRequests(token);
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to read SyncRequests:', err);
  }
}

/**
 * Ask for a sync for `vendors` (the ones with no open request). Demo mode
 * starts the simulated request and writes nothing. A failed append is shown
 * in words (`syncAsk: 'failed'`), never as a toast.
 */
export async function requestSyncNow(
  token: string,
  email: string,
  vendors: readonly SyncRequestVendor[],
): Promise<void> {
  if (vendors.length === 0 || syncAsk.value === 'asking') return;
  if (isDemo()) {
    if (demoSyncNowScenario() === 'append-failed') { syncAsk.value = 'failed'; return; }
    syncAsk.value = 'idle';
    demoSyncPressedAt.value = Date.now();
    return;
  }
  syncAsk.value = 'asking';
  try {
    await appendSyncRequests(vendors, email, token);
  } catch (err) {
    if (isReauthFailure(err)) { syncAsk.value = 'idle'; return; }
    console.error('Failed to append SyncRequests:', err);
    syncAsk.value = 'failed';
    return;
  }
  syncAsk.value = 'idle';
  await loadSyncRequests(token);
}

// ── Health data (#236) ───────────────────────────────────────────────

/** Loads one health tab into its signal, keeping loaded rows visible while it re-reads. */
async function loadHealthTab<T>(
  target: { value: HealthTabState<T> },
  fetchTab: (token: string) => Promise<T[]>,
  token: string,
  name: string,
): Promise<void> {
  if (target.value.state !== 'loaded') target.value = { state: 'loading' };
  try {
    const rows = await fetchTab(token);
    target.value = { state: 'loaded', rows };
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error(`Failed to read ${name}:`, err);
    target.value = { state: 'error' };
  }
}

/**
 * Read DailyHealth, BodyMeasurements and DailySummary, each whole and in
 * parallel. Each tab stands alone: a failure sets only that tab's signal to
 * `error`, and a missing tab loads as empty. Ranges are then selected from
 * these copies in memory, so moving between days or Trends ranges never
 * re-reads the sheet. Consumers decide when to call it.
 */
let healthInFlight: Promise<void> | null = null;

export function loadHealth(token: string): Promise<void> {
  // One load at a time (#239 AC5): a call while one runs joins it rather than
  // starting a second, whether it comes from the throttle or from Try again.
  if (healthInFlight) return healthInFlight;
  healthInFlight = Promise.all([
    loadHealthTab(dailyHealth, fetchDailyHealth, token, 'DailyHealth'),
    loadHealthTab(bodyMeasurements, fetchBodyMeasurements, token, 'BodyMeasurements'),
    loadHealthTab(dailySummary, fetchDailySummary, token, 'DailySummary'),
  ]).then(() => undefined).finally(() => { healthInFlight = null; });
  return healthInFlight;
}

/**
 * The Day screen's health load (#237 AC5): on show and on the page becoming
 * visible, never while one is in flight or within 60 s of the last start.
 * Each load is three Sheets reads against a quota of 60 a minute.
 */
export const healthRefresh = throttled(loadHealth, { minIntervalMs: 60_000 });

// ── Journal (#240) ───────────────────────────────────────────────────

/**
 * Read every Journal row into `journalEntries`. One load at a time: a call
 * while one runs joins it. A date the user has an unsaved edit on, has focused,
 * or saved since this read began keeps its local entry, so a refresh never
 * overwrites what the user is writing or has just written. A failed refresh
 * keeps loaded entries.
 */
let journalInFlight: Promise<void> | null = null;

async function readJournal(token: string): Promise<void> {
  if (journalEntries.value.state !== 'loaded') journalEntries.value = { state: 'loading' };
  const startSeq = journalSaveSeq();
  try {
    const rows = await fetchJournal(token);
    let entries: JournalEntry[] = rows.map(({ date, note, created, updated }) => ({ date, note, created, updated }));
    const cur = journalEntries.value;
    if (cur.state === 'loaded') {
      const keep = (d: string) => isNoteLocked(d) || journalSavedSince(d, startSeq);
      entries = entries.filter((e) => !keep(e.date));
      for (const e of cur.entries) if (keep(e.date)) entries.push(e);
    }
    journalEntries.value = { state: 'loaded', entries };
  } catch (err) {
    if (isReauthFailure(err)) return; // auth-provider handles this
    console.error('Failed to read Journal:', err);
    if (journalEntries.value.state !== 'loaded') journalEntries.value = { state: 'error' };
  }
}

export function loadJournal(token: string): Promise<void> {
  if (journalInFlight) return journalInFlight;
  journalInFlight = readJournal(token).finally(() => { journalInFlight = null; });
  return journalInFlight;
}

/** The Day screen's journal load: on show and on visible, at most once a minute. */
export const journalRefresh = throttled(loadJournal, { minIntervalMs: 60_000 });
