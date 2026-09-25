// Workouts + Sets domain API — wraps Sheets REST calls with demo-mode fallback.

import type { Workout, WorkoutWithRow, WorkoutSet, SetWithRow, WorkoutType, Effort } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, DEMO_WORKOUTS, DEMO_SETS } from './demo-data';
import { toLocalDateStr } from '../components/activities/activities-helpers';

/**
 * Thrown when a workout write targets a sheetRow that no longer holds that
 * workout's id — the cached row index went stale (e.g. a row shift from a
 * delete elsewhere in the same session). Writing anyway would silently
 * clobber a different workout's row (see issue #95).
 */
export class WorkoutRowMismatchError extends Error {
  constructor(public workoutId: string) {
    super(`Workout row for id "${workoutId}" could not be verified — it may be out of sync`);
    this.name = 'WorkoutRowMismatchError';
  }
}

// ── Workouts tab (A:AA) ──────────────────────────────────────────────

export async function fetchWorkouts(token: string): Promise<WorkoutWithRow[]> {
  if (isDemo()) return [...DEMO_WORKOUTS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Workouts!A2:AA', t);
    return rows.map((row, i) => rowToWorkout(row, i + 2));
  });
}

/**
 * Reads a `Workouts!A:AA` row. The Sheets API drops trailing empty cells, so a
 * short row is normal and every missing cell reads as `''`.
 */
export function rowToWorkout(row: string[], sheetRow: number): WorkoutWithRow {
  return {
    id: row[0] || '',
    date: row[1] || '',
    time: row[2] || '',
    type: (row[3] || 'weight') as WorkoutType,
    name: row[4] || '',
    template_id: row[5] || '',
    notes: row[6] || '',
    elapsed_seconds: row[7] || '',
    created: row[8] || '',
    copied_from: row[9] || '',
    status: row[10] || '',
    moving_seconds: row[11] || '',
    effort: (row[12] || '') as Workout['effort'],
    distance_m: row[13] || '',
    ascent_m: row[14] || '',
    descent_m: row[15] || '',
    avg_hr: row[16] || '',
    // #128 R-Z. A row written before the migration has no cells here at
    // all, so `|| ''` is what keeps them blank rather than undefined.
    sub_type: row[17] || '',
    source: row[18] || '',
    source_activity_id: row[19] || '',
    raw_ref: row[20] || '',
    fit_ref: row[21] || '',
    fit_fetched_at: row[22] || '',
    synced_at: row[23] || '',
    started_at_utc: row[24] || '',
    calories: row[25] || '',
    // #145 AA. Blank on every row planned before it existed, and on every
    // row nobody estimated.
    estimated_seconds: row[26] || '',
    sheetRow,
  };
}

/**
 * Look up a single workout's current sheetRow by id. Used right after
 * creating a workout so callers don't have to guess `workouts.value.length + 2`
 * — that guess is only correct while the local list exactly mirrors the
 * sheet, which a prior delete in the same session can silently break (see
 * issue #95).
 */
export async function findWorkoutRow(workoutId: string, token: string): Promise<WorkoutWithRow | null> {
  const all = await fetchWorkouts(token);
  return all.find((w) => w.id === workoutId) ?? null;
}

/**
 * Builds a `Workouts!A:AA` row. Both the create and the edit path go through
 * here: `sheetsAppend`/`sheetsUpdate` write every value handed to them
 * regardless of the range, so two builders that had to agree — and didn't —
 * is exactly how #100 nearly resurrected a deleted column.
 */
export function workoutToRow(w: Workout): (string | number)[] {
  return [
    w.id,
    w.date,
    w.time,
    w.type,
    w.name,
    w.template_id,
    w.notes,
    w.elapsed_seconds,
    w.created,
    w.copied_from,
    w.status,
    w.moving_seconds,
    w.effort,
    w.distance_m,
    w.ascent_m,
    w.descent_m,
    w.avg_hr,
    w.sub_type,
    w.source,
    w.source_activity_id,
    w.raw_ref,
    w.fit_ref,
    w.fit_fetched_at,
    w.synced_at,
    w.started_at_utc,
    w.calories,
    w.estimated_seconds,
  ];
}

export async function createWorkout(
  data: { type: WorkoutType; name: string; template_id?: string; notes?: string; elapsed_seconds?: string; effort?: Effort | '';
    distance_m?: string; ascent_m?: string; descent_m?: string; avg_hr?: string;
    copied_from?: string; date?: string; status?: string; sub_type?: string; estimated_seconds?: string },
  token: string,
): Promise<Workout> {
  const id = `w_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const date = data.date || toLocalDateStr(now);
  const time = now.toTimeString().slice(0, 5);
  const created = now.toISOString();

  const workout: Workout = {
    id,
    date,
    time,
    type: data.type,
    name: data.name,
    template_id: data.template_id || '',
    notes: data.notes || '',
    elapsed_seconds: data.elapsed_seconds || '',
    created,
    copied_from: data.copied_from || '',
    status: data.status || '',
    // #101: nullable activity attributes. Populated by #102 (effort) and
    // #103 (cardio); they ship empty and must never be defaulted.
    moving_seconds: '',
    effort: data.effort || '',
    distance_m: data.distance_m || '',
    ascent_m: data.ascent_m || '',
    descent_m: data.descent_m || '',
    avg_hr: data.avg_hr || '',
    // #129: venue/terrain, chosen by the user. '' means unspecified.
    sub_type: data.sub_type || '',
    // #128: sync provenance. Nothing in the app writes these — a hand-logged
    // workout is exactly the row with a blank `source`.
    source: '',
    source_activity_id: '',
    raw_ref: '',
    fit_ref: '',
    fit_fetched_at: '',
    synced_at: '',
    started_at_utc: '',
    calories: '',
    // #145: only a plan carries one, and only when the user typed it.
    estimated_seconds: data.estimated_seconds || '',
  };

  if (!isDemo()) {
    await withReauth(token, (t) =>
      sheetsAppend('Workouts!A:AA', [workoutToRow(workout)], t),
    );
  }

  return workout;
}

/**
 * The fields a write changes. Anything absent is left as the sheet holds it.
 * `id` is how the row is found, so it is never part of a patch.
 */
export type WorkoutPatch = Partial<Omit<Workout, 'id'>>;

/**
 * Writes `patch` over the row as the sheet holds it **now**, not over the
 * app's cached copy (#172).
 *
 * The cached copy can be hours old. Writing it back whole reverts every column
 * the COROS sync wrote since the app loaded: an enrichment's `moving_seconds`,
 * `avg_hr` and `calories`, the `source_activity_id`/`raw_ref`/`synced_at`
 * link, a synced row's `fit_ref`. On a synced row the sync then reads that
 * revert as a user edit and stops updating the field. So the row is read
 * fresh, only the patched fields change, and the whole row goes back.
 * Apps Script's `updateWorkout` does the same.
 *
 * The fresh read is also the #95 check: a row that no longer holds this
 * workout's id is refused instead of written.
 *
 * An empty patch writes nothing and returns `workout` unchanged.
 *
 * @returns the row as written, for the caller to put back in the store.
 */
export async function updateWorkout(
  workout: WorkoutWithRow,
  patch: WorkoutPatch,
  token: string,
): Promise<WorkoutWithRow> {
  const { sheetRow } = workout;
  if (Object.keys(patch).length === 0) return workout;
  if (isDemo()) return { ...workout, ...patch, id: workout.id, sheetRow };

  return withReauth(token, async (t) => {
    const range = `Workouts!A${sheetRow}:AA${sheetRow}`;
    const current = await sheetsGet(range, t);
    if (!current[0] || (current[0][0] || '') !== workout.id) {
      throw new WorkoutRowMismatchError(workout.id);
    }

    const written: WorkoutWithRow = { ...rowToWorkout(current[0], sheetRow), ...patch, id: workout.id, sheetRow };
    await sheetsUpdate(range, [workoutToRow(written)], t);
    return written;
  });
}

export async function deleteWorkoutRows(
  workout: WorkoutWithRow,
  workoutSets: SetWithRow[],
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    // Delete sets bottom-to-top to avoid row shift
    const setsToDelete = workoutSets
      .filter((s) => s.workout_id === workout.id)
      .sort((a, b) => b.sheetRow - a.sheetRow);

    if (setsToDelete.length > 0) {
      const setsSheetId = await getSheetId('Sets', t);
      for (const s of setsToDelete) {
        await sheetsDeleteRow(setsSheetId, s.sheetRow, t);
      }
    }

    // Delete the workout row
    const workoutsSheetId = await getSheetId('Workouts', t);
    await sheetsDeleteRow(workoutsSheetId, workout.sheetRow, t);
  });
}

// ── Sets tab (A:J) ──────────────────────────────────────────────────

export async function fetchSets(token: string): Promise<SetWithRow[]> {
  if (isDemo()) return [...DEMO_SETS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Sets!A2:J', t);
    return rows.map((row, i) => ({
      workout_id: row[0] || '',
      exercise_id: row[1] || '',
      exercise_name: row[2] || '',
      section: row[3] || '',
      exercise_order: Number(row[4]) || 0,
      set_number: Number(row[5]) || 0,
      planned_reps: row[6] || '',
      weight: row[7] || '',
      reps: row[8] || '',
      effort: (row[9] || '') as SetWithRow['effort'],
      sheetRow: i + 2,
    }));
  });
}

/**
 * Builds a `Sets!A:J` row. Reads named fields, so a payload carrying extra
 * properties — an offline-queue entry serialized under the old shape, say —
 * contributes no stray trailing cell.
 */
export function setToRow(s: WorkoutSet): (string | number)[] {
  return [
    s.workout_id,
    s.exercise_id,
    s.exercise_name,
    s.section,
    s.exercise_order,
    s.set_number,
    s.planned_reps,
    s.weight,
    s.reps,
    s.effort,
  ];
}

export async function appendSet(set: WorkoutSet, token: string): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsAppend('Sets!A:J', [setToRow(set)], t),
  );
}

export async function appendSets(sets: WorkoutSet[], token: string): Promise<void> {
  if (isDemo()) return;
  if (sets.length === 0) return;

  await withReauth(token, (t) =>
    sheetsAppend('Sets!A:J', sets.map(setToRow), t),
  );
}

export async function updateSet(
  sheetRow: number,
  set: WorkoutSet,
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsUpdate(`Sets!A${sheetRow}:J${sheetRow}`, [setToRow(set)], t),
  );
}

export async function updateExerciseNameInSets(
  exerciseId: string,
  newName: string,
  allSets: SetWithRow[],
  token: string,
): Promise<void> {
  const affected = allSets.filter(s => s.exercise_id === exerciseId);
  if (affected.length === 0) return;

  if (isDemo()) return;

  await withReauth(token, async (t) => {
    for (const s of affected) {
      await sheetsUpdate(
        `Sets!C${s.sheetRow}`,
        [[newName]],
        t,
      );
    }
  });
}

export async function deleteSetRow(sheetRow: number, token: string): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    const sheetId = await getSheetId('Sets', t);
    await sheetsDeleteRow(sheetId, sheetRow, t);
  });
}
