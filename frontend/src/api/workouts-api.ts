// Workouts + Sets domain API — wraps Sheets REST calls with demo-mode fallback.

import type { Workout, WorkoutWithRow, WorkoutSet, SetWithRow, WorkoutType } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, DEMO_WORKOUTS, DEMO_SETS } from './demo-data';

// ── Workouts tab (A:J) ──────────────────────────────────────────────

export async function fetchWorkouts(token: string): Promise<WorkoutWithRow[]> {
  if (isDemo()) return [...DEMO_WORKOUTS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Workouts!A2:J', t);
    return rows.map((row, i) => ({
      id: row[0] || '',
      date: row[1] || '',
      time: row[2] || '',
      type: (row[3] || 'weight') as WorkoutType,
      name: row[4] || '',
      template_id: row[5] || '',
      notes: row[6] || '',
      duration_min: row[7] || '',
      created: row[8] || '',
      copied_from: row[9] || '',
      sheetRow: i + 2,
    }));
  });
}

export async function createWorkout(
  data: { type: WorkoutType; name: string; template_id?: string; notes?: string; duration_min?: string; copied_from?: string },
  token: string,
): Promise<Workout> {
  const id = `w_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
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
    duration_min: data.duration_min || '',
    created,
    copied_from: data.copied_from || '',
  };

  if (!isDemo()) {
    await withReauth(token, (t) =>
      sheetsAppend('Workouts!A:J', [[
        workout.id,
        workout.date,
        workout.time,
        workout.type,
        workout.name,
        workout.template_id,
        workout.notes,
        workout.duration_min,
        workout.created,
        workout.copied_from,
      ]], t),
    );
  }

  return workout;
}

export async function updateWorkout(
  sheetRow: number,
  workout: Workout,
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsUpdate(`Workouts!A${sheetRow}:J${sheetRow}`, [[
      workout.id,
      workout.date,
      workout.time,
      workout.type,
      workout.name,
      workout.template_id,
      workout.notes,
      workout.duration_min,
      workout.created,
      workout.copied_from,
    ]], t),
  );
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

// ── Sets tab (A:K) ──────────────────────────────────────────────────

export async function fetchSets(token: string): Promise<SetWithRow[]> {
  if (isDemo()) return [...DEMO_SETS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Sets!A2:K', t);
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
      notes: row[10] || '',
      sheetRow: i + 2,
    }));
  });
}

function setToRow(s: WorkoutSet): (string | number)[] {
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
    s.notes,
  ];
}

export async function appendSet(set: WorkoutSet, token: string): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsAppend('Sets!A:K', [setToRow(set)], t),
  );
}

export async function appendSets(sets: WorkoutSet[], token: string): Promise<void> {
  if (isDemo()) return;
  if (sets.length === 0) return;

  await withReauth(token, (t) =>
    sheetsAppend('Sets!A:K', sets.map(setToRow), t),
  );
}

export async function updateSet(
  sheetRow: number,
  set: WorkoutSet,
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsUpdate(`Sets!A${sheetRow}:K${sheetRow}`, [setToRow(set)], t),
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
