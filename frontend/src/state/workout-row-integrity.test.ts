// Regression tests for issue #95: stale sheetRow tracking on workouts could
// cause a write to land on a different workout's row, producing two rows
// with the same id — and deleting one of those duplicates removed both from
// the UI. These tests drive the REAL actions.ts + workouts-api.ts through a
// mocked `../api/sheets` that simulates a two-tab Google Sheet in memory, so
// the row-shift-on-delete and row-mismatch-on-write behavior is exercised
// exactly as it runs against the real Sheets API.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workouts, sets, activeWorkoutId, toasts } from './store';
import type { WorkoutWithRow, SetWithRow } from '../api/types';

const WORKOUTS_SHEET_ID = 1;
const SETS_SHEET_ID = 2;

interface FakeSheet {
  Workouts: string[][];
  Sets: string[][];
}

let sheet: FakeSheet;

/** Column letters -> zero-based index: A = 0, Z = 25, AA = 26 (#145). */
const colIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  const [, colStart, rowStartStr, colEnd, rowEndStr] = m;
  return {
    tab: tab as keyof FakeSheet,
    colStart: colIndex(colStart),
    colEnd: colIndex(colEnd),
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
        result.push(rowData.slice(colStart, colEnd + 1));
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

vi.mock('../api/demo-data', () => ({
  isDemo: vi.fn().mockReturnValue(false),
  DEMO_WORKOUTS: [],
  DEMO_SETS: [],
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

const {
  deleteWorkout,
  saveWorkoutForLater,
  copyWorkout,
  finishWorkout,
  startPlannedWorkout,
} = await import('./actions');

const TOKEN = 'test-token';

function workoutRow(w: { id: string; date: string; time: string; type: string; name: string; status?: string; estimated_seconds?: string }): string[] {
  // A:AA — eleven original columns, the six nullable attributes (#101),
  // the nine sync provenance columns (#128) and the estimate (#145).
  return [
    w.id, w.date, w.time, w.type, w.name, '', '', '', '', '', w.status || '',
    '', '', '', '', '', '',
    '', '', '', '', '', '', '', '', '',
    w.estimated_seconds || '',
  ];
}

function setRow(s: { workout_id: string; exercise_id: string; exercise_name: string }): string[] {
  // A:J — the Notes column was removed in #100.
  return [s.workout_id, s.exercise_id, s.exercise_name, 'primary', '1', '1', '', '', '', ''];
}

function workoutsFromSheet(): WorkoutWithRow[] {
  return sheet.Workouts.map((row, i) => ({
    id: row[0], date: row[1], time: row[2], type: row[3] as any, name: row[4],
    template_id: row[5], notes: row[6], elapsed_seconds: row[7], created: row[8],
    copied_from: row[9], status: row[10],
    moving_seconds: row[11] || '', effort: (row[12] || '') as WorkoutWithRow['effort'],
    distance_m: row[13] || '', ascent_m: row[14] || '',
    descent_m: row[15] || '', avg_hr: row[16] || '',
    sub_type: row[17] || '', source: row[18] || '', source_activity_id: row[19] || '',
    raw_ref: row[20] || '', fit_ref: row[21] || '', fit_fetched_at: row[22] || '',
    synced_at: row[23] || '', started_at_utc: row[24] || '', calories: row[25] || '', estimated_seconds: row[26] || '',
    sheetRow: i + 2,
  }));
}

function setsFromSheet(): SetWithRow[] {
  return sheet.Sets.map((row, i) => ({
    workout_id: row[0], exercise_id: row[1], exercise_name: row[2], section: row[3],
    exercise_order: Number(row[4]), set_number: Number(row[5]), planned_reps: row[6],
    weight: row[7], reps: row[8], effort: row[9] as any, sheetRow: i + 2,
  }));
}

beforeEach(() => {
  sheet = { Workouts: [], Sets: [] };
  workouts.value = [];
  sets.value = [];
  activeWorkoutId.value = null;
  toasts.value = [];
});

describe('AC1: deleteWorkout keeps cached sheetRow correct after the row shift', () => {
  it('corrects the sheetRow of every workout below the deleted row', async () => {
    sheet.Workouts = [
      workoutRow({ id: 'w_a', date: '2026-08-24', time: '09:00', type: 'weight', name: 'A' }),
      workoutRow({ id: 'w_b', date: '2026-08-31', time: '09:00', type: 'weight', name: 'B' }),
      workoutRow({ id: 'w_c', date: '2026-09-07', time: '09:00', type: 'weight', name: 'C' }),
    ];
    workouts.value = workoutsFromSheet();

    await deleteWorkout('w_a', TOKEN);

    const b = workouts.value.find((w) => w.id === 'w_b')!;
    const c = workouts.value.find((w) => w.id === 'w_c')!;
    expect(b.sheetRow).toBe(2);
    expect(c.sheetRow).toBe(3);
    expect(sheet.Workouts.length).toBe(2);
  });
});

describe('AC2: a workout write never targets another workout\'s row', () => {
  it('aborts finishWorkout without writing when the cached row no longer matches', async () => {
    sheet.Workouts = [
      workoutRow({ id: 'w_real', date: '2026-09-01', time: '09:00', type: 'weight', name: 'Real', status: 'active' }),
    ];
    // Simulate staleness: the app's cache thinks 'w_ghost' lives at row 2,
    // but row 2 actually belongs to 'w_real'.
    const staleWorkout: WorkoutWithRow = {
      id: 'w_ghost', date: '2026-09-01', time: '09:00', type: 'weight', name: 'Ghost',
      template_id: '', notes: '', elapsed_seconds: '', created: '', copied_from: '', status: 'active',
      moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
      sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '',
      sheetRow: 2,
    };
    workouts.value = [staleWorkout];
    activeWorkoutId.value = 'w_ghost';

    await expect(finishWorkout('w_ghost', 'notes', '', TOKEN)).rejects.toThrow();

    // Row 2 must still belong to w_real, untouched
    expect(sheet.Workouts[0][0]).toBe('w_real');
    expect(sheet.Workouts[0][4]).toBe('Real');

    // The in-progress workout is not silently discarded
    expect(activeWorkoutId.value).toBe('w_ghost');
    expect(workouts.value.find((w) => w.id === 'w_ghost')).toBeTruthy();

    const lastToast = toasts.value[toasts.value.length - 1];
    expect(lastToast.type).toBe('error');
    expect(lastToast.text).toMatch(/out of sync/i);
  });

  it('aborts startPlannedWorkout the same way', async () => {
    sheet.Workouts = [
      workoutRow({ id: 'w_real', date: '2026-09-01', time: '09:00', type: 'weight', name: 'Real' }),
    ];
    const staleWorkout: WorkoutWithRow = {
      id: 'w_planned', date: '', time: '', type: 'weight', name: 'Planned',
      template_id: '', notes: '', elapsed_seconds: '', created: '', copied_from: '', status: 'planned',
      moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
      sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '',
      sheetRow: 2,
    };
    workouts.value = [staleWorkout];

    await expect(startPlannedWorkout('w_planned', TOKEN)).rejects.toThrow();
    expect(sheet.Workouts[0][0]).toBe('w_real');
    expect(activeWorkoutId.value).not.toBe('w_planned');
  });
});

describe('AC3: copying a workout after a delete creates exactly one new entry', () => {
  it('does not corrupt the sheet with a duplicate id', async () => {
    sheet.Workouts = [
      workoutRow({ id: 'w_junk', date: '2026-08-25', time: '09:00', type: 'weight', name: 'Junk' }),
      workoutRow({ id: 'w_week1', date: '2026-08-31', time: '09:00', type: 'weight', name: 'Week 1' }),
    ];
    workouts.value = workoutsFromSheet();
    sets.value = [];

    // Delete the older, unrelated workout — this used to leave a stale
    // sheetRow cached for 'Week 1'.
    await deleteWorkout('w_junk', TOKEN);

    // Copy 'Week 1' down for the new week
    const copyId = await copyWorkout('w_week1', TOKEN);

    // Finish the original — this is the write that used to clobber the copy's row
    await finishWorkout('w_week1', '', '', TOKEN);

    const ids = sheet.Workouts.map((row) => row[0]);
    expect(new Set(ids).size).toBe(ids.length); // no id appears twice
    expect(ids).toContain('w_week1');
    expect(ids).toContain(copyId);
    expect(sheet.Workouts.length).toBe(2);
  });
});

describe('AC4: deleting one of two same-id rows removes only one', () => {
  it('removes exactly one row and leaves the other intact with its sets', async () => {
    // Pre-existing corrupted data: two rows share the same id.
    sheet.Workouts = [
      workoutRow({ id: 'w_dup', date: '2026-08-31', time: '09:00', type: 'weight', name: 'Week 1' }),
      workoutRow({ id: 'w_dup', date: '2026-08-31', time: '10:00', type: 'weight', name: 'Week 1' }),
    ];
    sheet.Sets = [
      setRow({ workout_id: 'w_dup', exercise_id: 'ex_1', exercise_name: 'Bench Press' }),
    ];
    workouts.value = workoutsFromSheet();
    sets.value = setsFromSheet();

    await deleteWorkout('w_dup', TOKEN);

    expect(sheet.Workouts.length).toBe(1);
    expect(workouts.value.length).toBe(1);
    expect(workouts.value[0].id).toBe('w_dup');

    // The surviving duplicate's sets must not have been wiped out
    expect(sheet.Sets.length).toBe(1);
    expect(sets.value.length).toBe(1);

    const lastToast = toasts.value[toasts.value.length - 1];
    expect(lastToast.type).toBe('success');
    expect(lastToast.text).toBe('Workout deleted');
  });
});

// #145: the estimate lives in AA, is written by saveWorkoutForLater, and is
// never turned into elapsed time.
describe('#145: a planned workout estimate', () => {
  it('saveWorkoutForLater writes the estimate to AA and leaves H blank', async () => {
    await saveWorkoutForLater({ type: 'weight', name: 'Pull A', date: '2099-12-31', estimated_seconds: '2820' }, TOKEN);
    const row = sheet.Workouts[0];
    expect(row).toHaveLength(27);
    expect(row[26]).toBe('2820');
    expect(row[7]).toBe('');
    expect(row[10]).toBe('planned');
  });

  it('saveWorkoutForLater with no estimate writes a blank AA, never 0', async () => {
    await saveWorkoutForLater({ type: 'weight', name: 'Pull A', date: '2099-12-31' }, TOKEN);
    expect(sheet.Workouts[0][26]).toBe('');
  });

  it('starting a plan keeps AA and leaves elapsed blank (AC4)', async () => {
    sheet.Workouts = [
      workoutRow({ id: 'w_p', date: '2099-12-31', time: '', type: 'weight', name: 'Pull A', status: 'planned', estimated_seconds: '2820' }),
    ];
    workouts.value = workoutsFromSheet();

    await startPlannedWorkout('w_p', TOKEN);

    const row = sheet.Workouts[0];
    expect(row[10]).toBe('active');
    expect(row[7]).toBe('');
    expect(row[26]).toBe('2820');
    expect(workouts.value[0].elapsed_seconds).toBe('');
    expect(workouts.value[0].estimated_seconds).toBe('2820');
  });

  it('finishing it records elapsed from the clock, never from the estimate', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 20 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    sheet.Workouts = [
      workoutRow({ id: 'w_p', date, time, type: 'weight', name: 'Pull A', status: 'active', estimated_seconds: '2820' }),
    ];
    workouts.value = workoutsFromSheet();
    activeWorkoutId.value = 'w_p';

    await finishWorkout('w_p', '', '', TOKEN);

    const row = sheet.Workouts[0];
    const elapsed = Number(row[7]);
    expect(elapsed).toBeGreaterThan(19 * 60);
    expect(elapsed).toBeLessThan(22 * 60);
    expect(row[7]).not.toBe('2820');
    expect(row[26]).toBe('2820');
  });
});
