// Templates domain API — wraps Sheets REST calls with demo-mode fallback.

import type { TemplateRowWithRow, Template, Section } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, DEMO_TEMPLATE_ROWS } from './demo-data';

/** Convert a range string like "4-5" to its max value "5". Single values pass through. */
export function normalizeRangeToMax(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split('-').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
  if (parts.length === 0) return trimmed;
  return String(Math.max(...parts));
}

export interface TemplateExerciseInput {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
}

export async function fetchTemplateRows(token: string): Promise<TemplateRowWithRow[]> {
  if (isDemo()) return [...DEMO_TEMPLATE_ROWS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Templates!A2:J', t);
    return rows.map((row, i) => ({
      template_id: row[0] || '',
      template_name: row[1] || '',
      order: Number(row[2]) || 0,
      exercise_id: row[3] || '',
      exercise_name: row[4] || '',
      section: (row[5] || '') as Section | string,
      sets: normalizeRangeToMax(row[6] || ''),
      reps: normalizeRangeToMax(row[7] || ''),
      created: row[8] || '',
      updated: row[9] || '',
      sheetRow: i + 2,
    }));
  });
}

export function groupTemplateRows(rows: TemplateRowWithRow[]): Template[] {
  const map = new Map<string, Template>();
  for (const row of rows) {
    let tpl = map.get(row.template_id);
    if (!tpl) {
      tpl = { id: row.template_id, name: row.template_name, exercises: [] };
      map.set(row.template_id, tpl);
    }
    tpl.exercises.push(row);
  }
  for (const tpl of map.values()) {
    tpl.exercises.sort((a, b) => a.order - b.order);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTemplate(
  name: string,
  exercises: TemplateExerciseInput[],
  token: string,
): Promise<Template> {
  const templateId = `tpl_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const templateRows: TemplateRowWithRow[] = exercises.map((ex, i) => ({
    template_id: templateId,
    template_name: name,
    order: i + 1,
    exercise_id: ex.exercise_id,
    exercise_name: ex.exercise_name,
    section: ex.section,
    sets: ex.sets,
    reps: ex.reps,
    created: now,
    updated: now,
    sheetRow: -1, // placeholder; corrected on re-fetch
  }));

  if (!isDemo()) {
    const sheetValues = templateRows.map((r) => [
      r.template_id,
      r.template_name,
      r.order,
      r.exercise_id,
      r.exercise_name,
      r.section,
      r.sets,
      r.reps,
      r.created,
      r.updated,
    ]);
    await withReauth(token, (t) => sheetsAppend('Templates!A:J', sheetValues, t));
  }

  return { id: templateId, name, exercises: templateRows };
}

export async function updateTemplate(
  templateId: string,
  name: string,
  exercises: TemplateExerciseInput[],
  existingRows: TemplateRowWithRow[],
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    // Delete existing rows for this template (bottom-to-top to avoid row shift)
    const rowsToDelete = existingRows
      .filter((r) => r.template_id === templateId)
      .sort((a, b) => b.sheetRow - a.sheetRow);

    const sheetId = await getSheetId('Templates', t);
    for (const row of rowsToDelete) {
      await sheetsDeleteRow(sheetId, row.sheetRow, t);
    }

    // Append new rows
    const now = new Date().toISOString();
    const sheetValues = exercises.map((ex, i) => [
      templateId,
      name,
      i + 1,
      ex.exercise_id,
      ex.exercise_name,
      ex.section,
      ex.sets,
      ex.reps,
      now,
      now,
    ]);
    if (sheetValues.length > 0) {
      await sheetsAppend('Templates!A:J', sheetValues, t);
    }
  });
}

export async function updateExerciseNameInTemplates(
  exerciseId: string,
  newName: string,
  templateRows: TemplateRowWithRow[],
  token: string,
): Promise<void> {
  const affected = templateRows.filter(r => r.exercise_id === exerciseId);
  if (affected.length === 0) return;

  if (isDemo()) return;

  await withReauth(token, async (t) => {
    for (const row of affected) {
      await sheetsUpdate(
        `Templates!E${row.sheetRow}`,
        [[newName]],
        t,
      );
    }
  });
}

export async function deleteTemplate(
  templateId: string,
  existingRows: TemplateRowWithRow[],
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    const rowsToDelete = existingRows
      .filter((r) => r.template_id === templateId)
      .sort((a, b) => b.sheetRow - a.sheetRow);

    const sheetId = await getSheetId('Templates', t);
    for (const row of rowsToDelete) {
      await sheetsDeleteRow(sheetId, row.sheetRow, t);
    }
  });
}
