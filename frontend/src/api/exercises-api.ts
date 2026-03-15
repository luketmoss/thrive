// Exercises domain API — wraps Sheets REST calls with demo-mode fallback.

import type { Exercise, ExerciseWithRow } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, DEMO_EXERCISES } from './demo-data';

export async function fetchExercises(token: string): Promise<ExerciseWithRow[]> {
  if (isDemo()) return [...DEMO_EXERCISES];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Exercises!A2:E', t);
    return rows.map((row, i) => ({
      id: row[0] || '',
      name: row[1] || '',
      tags: row[2] || '',
      notes: row[3] || '',
      created: row[4] || '',
      sheetRow: i + 2,
    }));
  });
}

export async function createExercise(
  data: { name: string; tags: string; notes: string },
  token: string,
): Promise<Exercise> {
  const id = `ex_${crypto.randomUUID().slice(0, 8)}`;
  const created = new Date().toISOString();
  const exercise: Exercise = { id, name: data.name, tags: data.tags, notes: data.notes, created };

  if (isDemo()) return exercise;

  await withReauth(token, (t) =>
    sheetsAppend('Exercises!A:E', [[id, data.name, data.tags, data.notes, created]], t),
  );
  return exercise;
}

export async function updateExercise(
  sheetRow: number,
  exercise: Exercise,
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsUpdate(
      `Exercises!A${sheetRow}:E${sheetRow}`,
      [[exercise.id, exercise.name, exercise.tags, exercise.notes, exercise.created]],
      t,
    ),
  );
}

export async function deleteExercise(sheetRow: number, token: string): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    const sheetId = await getSheetId('Exercises', t);
    await sheetsDeleteRow(sheetId, sheetRow, t);
  });
}
