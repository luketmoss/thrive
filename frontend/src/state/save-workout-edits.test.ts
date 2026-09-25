// Regression tests for #177: saving a weight workout from edit mode deleted
// its warmup set rows, and wrote the sets it kept one row too low for every
// row it deleted above them. These drive the REAL actions.ts + workouts-api.ts,
// with the edited sets built the way the tracker builds them, through a mocked
// `../api/sheets` that simulates the sheet in memory. That fake sheet deletes
// rows the way the real Sets tab does, so the row shift is exercised too.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workouts, sets, activeWorkoutId, toasts } from './store';
import type { WorkoutWithRow } from '../api/types';

const WORKOUTS_SHEET_ID = 1;
const SETS_SHEET_ID = 2;

interface FakeSheet {
  Workouts: (string | number)[][];
  Sets: (string | number)[][];
}

let sheet: FakeSheet;

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  const [, colStart, rowStartStr, colEnd, rowEndStr] = m;
  return {
    tab: tab as keyof FakeSheet,
    colStart: colStart.charCodeAt(0) - 65,
    colEnd: colEnd.charCodeAt(0) - 65,
    rowStart: rowStartStr ? Number(rowStartStr) : null,
    rowEnd: rowEndStr ? Number(rowEndStr) : null,
  };
}

vi.mock('../api/sheets', () => {
  class SheetsApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(`Sheets API ${status}: ${message}`);
      this.status = status;
      this.name = 'SheetsApiError';
    }
  }

  return {
    SheetsApiError,
    withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<any>) => fn(token)),
    sheetsGet: vi.fn(async (range: string) => {
      const { tab, colStart, colEnd, rowStart, rowEnd } = parseRange(range);
      const rows = sheet[tab];
      const start = rowStart ?? 2;
      const end = rowEnd ?? rows.length + 1;
      const result: string[][] = [];
      for (let r = start; r <= end; r++) {
        const rowData = rows[r - 2];
        if (!rowData) continue;
        result.push(rowData.slice(colStart, colEnd + 1).map(String));
      }
      return result;
    }),
    sheetsUpdate: vi.fn(async (range: string, values: any[][]) => {
      const { tab, colStart, rowStart } = parseRange(range);
      const rows = sheet[tab];
      const rowIdx = (rowStart as number) - 2;
      if (!rows[rowIdx]) rows[rowIdx] = [];
      values[0].forEach((v, i) => {
        rows[rowIdx][colStart + i] = v;
      });
    }),
    sheetsAppend: vi.fn(async (range: string, values: any[][]) => {
      const [tab] = range.split('!') as [keyof FakeSheet];
      for (const row of values) sheet[tab].push([...row]);
    }),
    sheetsDeleteRow: vi.fn(async (sheetId: number, rowIndex: number) => {
      const tab: keyof FakeSheet = sheetId === WORKOUTS_SHEET_ID ? 'Workouts' : 'Sets';
      sheet[tab].splice(rowIndex - 2, 1);
    }),
    getSheetId: vi.fn(async (name: string) => (name === 'Workouts' ? WORKOUTS_SHEET_ID : SETS_SHEET_ID)),
  };
});

// The real demo fixtures (w_demo001: 20 set rows, 2 of them warmup, with
// w_demo004's rows stored below), but talking to the fake sheet, not demo mode.
vi.mock('../api/demo-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/demo-data')>()),
  isDemo: vi.fn().mockReturnValue(false),
}));

vi.mock('../api/exercises-api', () => ({
  fetchExercises: vi.fn(), createExercise: vi.fn(), updateExercise: vi.fn(), deleteExercise: vi.fn(),
}));
vi.mock('../api/templates-api', () => ({
  fetchTemplateRows: vi.fn(), groupTemplateRows: vi.fn(), createTemplate: vi.fn(),
  updateTemplate: vi.fn(), deleteTemplate: vi.fn(), updateExerciseNameInTemplates: vi.fn(),
}));
vi.mock('../api/labels-api', () => ({
  fetchLabels: vi.fn(), createLabel: vi.fn(), updateLabel: vi.fn(), deleteLabel: vi.fn(), appendLabels: vi.fn(),
}));
vi.mock('../api/label-colors', () => ({ colorKeyFromName: vi.fn().mockReturnValue('blue') }));
vi.mock('../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));

const { saveWorkoutEdits } = await import('./actions');
const { DEMO_SETS, DEMO_WORKOUTS, isDemo } = await import('../api/demo-data');
const { setToRow, workoutToRow } = await import('../api/workouts-api');
const { buildExerciseList } = await import('../components/workout/build-exercise-list');
const { collectEditedSets } = await import('../components/workout/edited-sets');
const { applyChangeSection, applyMoveDown } = await import('../components/workout/section-management');
const { workoutToEditInputs, editInputsToPatch } = await import('../components/shared/edit-patch');

const TOKEN = 'test-token';
const WORKOUT_ID = 'w_demo001';

/** Every sheet cell as a string: RAW writes store numbers, reads return text. */
const text = (rows: (string | number)[][]) => rows.map((r) => r.map(String));

/** The edit screen's exercise list for the workout, as the tracker builds it. */
function editScreen() {
  return buildExerciseList(sets.value.filter((s) => s.workout_id === WORKOUT_ID));
}

function workout(): WorkoutWithRow {
  return workouts.value.find((w) => w.id === WORKOUT_ID)!;
}

/** The patch for an edit that changes only the notes, as the tracker builds it. */
function notesOnlyPatch(notes: string) {
  const initial = workoutToEditInputs(workout());
  return editInputsToPatch(initial, { ...initial, notes });
}

function rowsOf(workoutId: string) {
  return text(sheet.Sets).filter((r) => r[0] === workoutId);
}

beforeEach(() => {
  vi.mocked(isDemo).mockReturnValue(false);
  // The fixtures are stored in sheet order, starting at row 2.
  DEMO_SETS.forEach((s, i) => expect(s.sheetRow).toBe(i + 2));
  sheet = {
    Workouts: [workoutToRow(DEMO_WORKOUTS.find((w) => w.id === WORKOUT_ID)!)],
    Sets: DEMO_SETS.map(setToRow),
  };
  workouts.value = [{ ...DEMO_WORKOUTS.find((w) => w.id === WORKOUT_ID)!, sheetRow: 2 }];
  sets.value = DEMO_SETS.map((s) => ({ ...s }));
  activeWorkoutId.value = WORKOUT_ID;
  toasts.value = [];
});

describe('AC1: a notes-only save keeps every set, warmups included', () => {
  it('sends every set on the edit screen, the warmups among them', () => {
    const edited = collectEditedSets(editScreen());
    expect(edited).toHaveLength(20);
    expect(edited.filter((s) => s.section === 'warmup')).toHaveLength(2);
  });

  it('keeps all 20 of w_demo001\'s set rows, each unchanged in its own row', async () => {
    const before = text(sheet.Sets);

    await saveWorkoutEdits(WORKOUT_ID, notesOnlyPatch('Edited notes'), collectEditedSets(editScreen()), TOKEN);

    expect(text(sheet.Sets)).toEqual(before);
    const stored = sets.value.filter((s) => s.workout_id === WORKOUT_ID);
    expect(stored).toHaveLength(20);
    expect(stored.filter((s) => s.section === 'warmup').map((s) => s.exercise_name))
      .toEqual(['Push Ups', 'Bench Press BB']);
  });

  it('keeps the warmups in demo mode too', async () => {
    vi.mocked(isDemo).mockReturnValue(true);

    await saveWorkoutEdits(WORKOUT_ID, notesOnlyPatch('Edited notes'), collectEditedSets(editScreen()), TOKEN);

    const stored = sets.value.filter((s) => s.workout_id === WORKOUT_ID);
    expect(stored).toHaveLength(20);
    expect(stored.filter((s) => s.section === 'warmup')).toHaveLength(2);
  });
});

describe('AC2: deliberate deletions still delete exactly what was removed', () => {
  it('deletes a removed set and a removed warmup exercise, and nothing else', async () => {
    const before = text(sheet.Sets);
    // Remove the Push Ups warmup exercise (row 2) and Incline Press set 2 (row 9).
    const list = editScreen()
      .filter((ex) => ex.exercise_id !== 'ex_demo_pushup')
      .map((ex) => (ex.exercise_id === 'ex_demo002'
        ? { ...ex, sets: ex.sets.filter((s) => s.set_number !== 2) }
        : ex));

    await saveWorkoutEdits(WORKOUT_ID, {}, collectEditedSets(list), TOKEN);

    const expected = before.filter((_, i) => i + 2 !== 2 && i + 2 !== 9);
    expect(text(sheet.Sets)).toEqual(expected);
    expect(sets.value.filter((s) => s.workout_id === WORKOUT_ID)).toHaveLength(18);
  });
});

describe('AC3: kept sets are written to their own rows when rows are deleted', () => {
  it('lands an edited set in its own row below a deletion, leaving no duplicates and the next workout untouched', async () => {
    const nextWorkoutBefore = rowsOf('w_demo004');
    // Delete both warmups (rows 2-3, above everything else) and change the
    // weight of Bench Press set 1 (row 4, just below them).
    const list = editScreen()
      .filter((ex) => ex.section !== 'warmup')
      .map((ex) => (ex.exercise_id === 'ex_demo001'
        ? { ...ex, sets: ex.sets.map((s) => (s.set_number === 1 ? { ...s, weight: '190' } : s)) }
        : ex));

    await saveWorkoutEdits(WORKOUT_ID, {}, collectEditedSets(list), TOKEN);

    const mine = rowsOf(WORKOUT_ID);
    expect(mine).toHaveLength(18);
    const keys = mine.map((r) => `${r[1]}|${r[4]}|${r[5]}`);
    expect(new Set(keys).size).toBe(keys.length);
    const bench1 = mine.filter((r) => r[1] === 'ex_demo001' && r[4] === '3' && r[5] === '1');
    expect(bench1).toHaveLength(1);
    expect(bench1[0][7]).toBe('190');
    expect(rowsOf('w_demo004')).toEqual(nextWorkoutBefore);
    // Every workout's rows are still one contiguous block.
    const ids = text(sheet.Sets).map((r) => r[0]);
    const starts = ids.filter((id, i) => i === 0 || ids[i - 1] !== id);
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe('AC4: stored rows are matched by row, not by exercise/order/set key', () => {
  it('updates reordered sets in place with their new order', async () => {
    const before = text(sheet.Sets);
    // Move Incline Press (order 4, rows 8-10) below Cable Fly (order 5, rows 11-13).
    const list = applyMoveDown(editScreen(), 'ex_demo002', 4);

    await saveWorkoutEdits(WORKOUT_ID, {}, collectEditedSets(list), TOKEN);

    const after = text(sheet.Sets);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      const row = i + 2;
      const expected = [...before[i]];
      if (row >= 8 && row <= 10) expected[4] = '5';
      if (row >= 11 && row <= 13) expected[4] = '4';
      expect(after[i]).toEqual(expected);
    }
  });

  it('leaves one row for a warmup changed to a working section', async () => {
    const { exercises: list } = applyChangeSection(editScreen(), 'ex_demo_pushup', 1, 'primary');

    await saveWorkoutEdits(WORKOUT_ID, {}, collectEditedSets(list), TOKEN);

    const pushUps = rowsOf(WORKOUT_ID).filter((r) => r[1] === 'ex_demo_pushup');
    expect(pushUps).toHaveLength(1);
    expect(pushUps[0][3]).toBe('primary');
    expect(rowsOf(WORKOUT_ID)).toHaveLength(20);
    expect(rowsOf('w_demo004')).toEqual(
      text(DEMO_SETS.filter((s) => s.workout_id === 'w_demo004').map(setToRow)),
    );
  });
});

describe('AC5: the workout row still changes only its edited fields (#172)', () => {
  it('sends only the notes and leaves every other Workouts column as stored', async () => {
    const before = text(sheet.Workouts)[0];
    const patch = notesOnlyPatch('Edited notes');
    expect(patch).toEqual({ notes: 'Edited notes' });

    await saveWorkoutEdits(WORKOUT_ID, patch, collectEditedSets(editScreen()), TOKEN);

    const after = text(sheet.Workouts)[0];
    const NOTES = 6; // Workouts!G
    expect(after[NOTES]).toBe('Edited notes');
    expect(after.filter((_, i) => i !== NOTES)).toEqual(before.filter((_, i) => i !== NOTES));
  });
});
