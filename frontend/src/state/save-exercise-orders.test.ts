// #392: the order write. `updateSetOrders` sends one batchUpdate of
// `updateCells` on Sets column E only; `saveExerciseOrders` then updates
// `sets` and `activeWorkoutSets` by row, live and demo (where nothing is
// sent), and changes nothing in memory when the write fails.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sets, activeWorkoutSets, toasts } from './store';
import type { SetWithRow } from '../api/types';

let demo = false;
let failure: Error | null = null;
const batchCalls: object[][] = [];
const calls: string[] = [];

vi.mock('../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async () => { calls.push('get'); return []; }),
  sheetsUpdate: vi.fn(async () => { calls.push('update'); }),
  sheetsAppend: vi.fn(async () => { calls.push('append'); }),
  sheetsDeleteRow: vi.fn(async () => { calls.push('delete'); }),
  sheetsBatchUpdate: vi.fn(async (requests: object[]) => {
    calls.push('batch');
    if (failure) throw failure;
    batchCalls.push(requests);
  }),
  getSheetId: vi.fn(async () => { calls.push('sheetId'); return 77; }),
}));
vi.mock('../api/demo-data', () => ({
  isDemo: () => demo, DEMO_WORKOUTS: [], DEMO_SETS: [], shiftDemoWorkouts: (w: unknown) => w,
}));
vi.mock('../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));

const { saveExerciseOrders } = await import('./actions');
const { setOrderRequests, updateSetOrders } = await import('../api/workouts-api');

const row = (w: string, ex: string, order: number, sheetRow: number): SetWithRow => ({
  workout_id: w, exercise_id: ex, exercise_name: ex, section: 'primary',
  exercise_order: order, set_number: 1, planned_reps: '8', weight: '100', reps: '8', effort: '', sheetRow,
});
const ALL = [row('w0', 'e_old', 1, 2), row('w1', 'e_bench', 1, 3), row('w1', 'e_row', 2, 4), row('w1', 'e_curl', 3, 5)];

beforeEach(() => {
  demo = false;
  failure = null;
  batchCalls.length = 0;
  calls.length = 0;
  toasts.value = [];
  sets.value = ALL;
  activeWorkoutSets.value = ALL.filter((s) => s.workout_id === 'w1');
});

describe('setOrderRequests', () => {
  it('one updateCells per row on column E, as a number, naming no other cell', () => {
    expect(setOrderRequests([{ sheetRow: 4, exercise_order: 1 }, { sheetRow: 3, exercise_order: 2 }], 77)).toEqual([
      { updateCells: { rows: [{ values: [{ userEnteredValue: { numberValue: 1 } }] }], fields: 'userEnteredValue', start: { sheetId: 77, rowIndex: 3, columnIndex: 4 } } },
      { updateCells: { rows: [{ values: [{ userEnteredValue: { numberValue: 2 } }] }], fields: 'userEnteredValue', start: { sheetId: 77, rowIndex: 2, columnIndex: 4 } } },
    ]);
  });
});

describe('updateSetOrders', () => {
  it('sends one batchUpdate, with the Sets sheet id; nothing read, appended or deleted', async () => {
    await updateSetOrders([{ sheetRow: 4, exercise_order: 1 }, { sheetRow: 3, exercise_order: 2 }], 'tok');
    expect(calls).toEqual(['sheetId', 'batch']);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
  });

  it('makes no request with nothing to write, or in demo mode', async () => {
    await updateSetOrders([], 'tok');
    demo = true;
    await updateSetOrders([{ sheetRow: 4, exercise_order: 1 }], 'tok');
    expect(calls).toEqual([]);
  });
});

describe('saveExerciseOrders', () => {
  const orders = (list: SetWithRow[]) => list.map((s) => [s.sheetRow, s.exercise_order]);

  it('writes, then updates sets and activeWorkoutSets by row, for this workout only', async () => {
    await saveExerciseOrders('w1', [{ sheetRow: 3, exercise_order: 2 }, { sheetRow: 4, exercise_order: 1 }, { sheetRow: 2, exercise_order: 9 }], 'tok');
    expect(calls).toEqual(['sheetId', 'batch']);
    expect(orders(sets.value)).toEqual([[2, 1], [3, 2], [4, 1], [5, 3]]);
    expect(orders(activeWorkoutSets.value)).toEqual([[3, 2], [4, 1], [5, 3]]);
  });

  it('demo mode: no request, memory updated, so a resume shows the new order', async () => {
    demo = true;
    await saveExerciseOrders('w1', [{ sheetRow: 3, exercise_order: 2 }, { sheetRow: 4, exercise_order: 1 }], 'tok');
    expect(calls).toEqual([]);
    expect(orders(activeWorkoutSets.value)).toEqual([[3, 2], [4, 1], [5, 3]]);
  });

  it('a failed write rejects with no toast and changes nothing in memory', async () => {
    failure = new TypeError('Failed to fetch');
    await expect(saveExerciseOrders('w1', [{ sheetRow: 3, exercise_order: 2 }], 'tok')).rejects.toThrow('Failed to fetch');
    expect(toasts.value).toEqual([]);
    expect(orders(activeWorkoutSets.value)).toEqual([[3, 1], [4, 2], [5, 3]]);
  });

  it('nothing to write: no request', async () => {
    await saveExerciseOrders('w1', [], 'tok');
    expect(calls).toEqual([]);
  });
});
