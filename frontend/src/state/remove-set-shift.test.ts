// #394: removeSet follows a landed row delete in memory and in the offline
// queue (every row below it gets one less) instead of re-fetching, in live
// and demo mode alike, and a set with no row touches no row at all. Drives
// the real actions.ts / sync-queue.ts / workouts-api.ts over an in-memory
// Sets tab whose delete shifts the rows below it, as Sheets does.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sets, activeWorkoutSets, activeWorkoutId, toasts } from './store';
import type { SetWithRow } from '../api/types';

let sheet: string[][];
let demo = false;
let deleteFailure: Error | null = null;
const calls: string[] = [];

vi.mock('../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async () => {
    calls.push('get');
    return sheet.map((r) => [...r]);
  }),
  sheetsUpdate: vi.fn(async () => { calls.push('update'); }),
  sheetsAppend: vi.fn(async () => { calls.push('append'); }),
  sheetsDeleteRow: vi.fn(async (_id: number, rowIndex: number) => {
    calls.push(`delete ${rowIndex}`);
    if (deleteFailure) throw deleteFailure;
    sheet.splice(rowIndex - 2, 1);
  }),
  getSheetId: vi.fn(async () => 1),
}));
vi.mock('../api/demo-data', () => ({
  isDemo: () => demo,
  DEMO_WORKOUTS: [],
  // What a re-fetch would return in demo mode: static data, never this workout.
  DEMO_SETS: [],
  shiftDemoWorkouts: (w: unknown) => w,
}));
vi.mock('../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));

const { removeSet, saveSet, dropAndShiftRows } = await import('./actions');
const { enqueueSet, readQueue, clearQueue } = await import('../api/sync-queue');

const row = (w: string, ex: string, order: number, n: number, sheetRow: number): SetWithRow => ({
  workout_id: w, exercise_id: ex, exercise_name: ex, section: 'primary',
  exercise_order: order, set_number: n, planned_reps: '8', weight: '100', reps: '8', effort: '', sheetRow,
});

const ALL = [
  row('w1', 'e_bench', 1, 1, 2),
  row('w1', 'e_bench', 1, 2, 3),
  row('w1', 'e_row', 2, 1, 4),
  row('w2', 'e_curl', 1, 1, 5),
];

beforeEach(() => {
  sheet = ALL.map((s) => [s.workout_id, s.exercise_id]);
  demo = false;
  deleteFailure = null;
  calls.length = 0;
  clearQueue();
  toasts.value = [];
  sets.value = [...ALL];
  activeWorkoutId.value = 'w1';
  activeWorkoutSets.value = ALL.filter((s) => s.workout_id === 'w1');
});

const rows = (list: SetWithRow[]) => list.map((s) => [s.workout_id, s.exercise_id, s.set_number, s.sheetRow]);

describe('#394 AC4: removeSet shifts memory instead of re-fetching', () => {
  for (const mode of ['live', 'demo'] as const) {
    it(`${mode}: drops the row and gives every row below it one less, with no re-fetch`, async () => {
      demo = mode === 'demo';
      await removeSet(ALL[0], 'tok');

      expect(calls).toEqual(demo ? [] : ['delete 2']);
      expect(rows(sets.value)).toEqual([
        ['w1', 'e_bench', 2, 2],
        ['w1', 'e_row', 1, 3],
        ['w2', 'e_curl', 1, 4],
      ]);
      expect(rows(activeWorkoutSets.value)).toEqual([
        ['w1', 'e_bench', 2, 2],
        ['w1', 'e_row', 1, 3],
      ]);
    });
  }

  it('demo: a workout left and resumed shows exactly the sets left (resume reads `sets`)', async () => {
    demo = true;
    await removeSet(ALL[1], 'tok');
    await removeSet({ ...ALL[2], sheetRow: 3 }, 'tok');
    expect(rows(sets.value.filter((s) => s.workout_id === 'w1'))).toEqual([['w1', 'e_bench', 1, 2]]);
  });

  it('shifts the offline queue: an entry below gets one less, the removed set\'s entry is dropped', async () => {
    enqueueSet({ ...ALL[0], weight: '1' });
    enqueueSet({ ...ALL[2], weight: '2' });
    enqueueSet({ ...ALL[3], weight: '3' });
    await removeSet(ALL[0], 'tok');
    expect(readQueue().map((e) => [e.payload.exercise_id, e.payload.sheetRow])).toEqual([
      ['e_row', 3],
      ['e_curl', 4],
    ]);
  });

  it('a delete that fails shows the toast and shifts nothing', async () => {
    deleteFailure = new TypeError('Failed to fetch');
    enqueueSet({ ...ALL[2], weight: '2' });
    await expect(removeSet(ALL[0], 'tok')).rejects.toThrow();
    expect(toasts.value.map((t) => t.text)).toContain('Failed to remove set');
    expect(rows(sets.value)).toEqual(rows(ALL));
    expect(rows(activeWorkoutSets.value)).toEqual(rows(ALL.slice(0, 3)));
    expect(readQueue().map((e) => e.payload.sheetRow)).toEqual([4]);
  });

  it('a set with no row makes no request and touches no row, even one sharing its exercise, order and set number', async () => {
    // A duplicate's twin (or a moved exercise) at the same (exercise, order, set #).
    enqueueSet({ ...ALL[2], set_number: 2, sheetRow: -1, weight: '9' });
    enqueueSet({ ...ALL[2], workout_id: 'w1', exercise_id: 'e_bench', exercise_order: 1, set_number: 1, sheetRow: 2 });
    await removeSet({ ...ALL[0], sheetRow: -1 }, 'tok');
    expect(calls).toEqual([]);
    expect(rows(activeWorkoutSets.value)).toEqual(rows(ALL.slice(0, 3)));
    expect(rows(sets.value)).toEqual(rows(ALL));
    // The aimed entry stays; a queued append for the removed set is dropped.
    expect(readQueue().map((e) => [e.payload.exercise_id, e.payload.set_number, e.payload.sheetRow])).toEqual([
      ['e_row', 2, -1],
      ['e_bench', 1, 2],
    ]);
    await removeSet({ ...ALL[2], set_number: 2, sheetRow: -1 }, 'tok');
    expect(readQueue().map((e) => e.payload.sheetRow)).toEqual([2]);
  });
});

describe('#394 AC4: demo mode keeps a Build Custom workout\'s sets for a resume', () => {
  it('a demo append is kept in memory below the last row, and a later remove shifts it like any other', async () => {
    demo = true;
    sets.value = [row('w0', 'e_bench', 1, 1, 2)];
    activeWorkoutSets.value = [];
    const { sheetRow: _r, ...first } = row('w1', 'e_bench', 1, 1, 0);
    const a = await saveSet(first, 'tok');
    const b = await saveSet({ ...first, set_number: 2 }, 'tok');
    expect([a.sheetRow, b.sheetRow]).toEqual([3, 4]);
    expect(calls).toEqual([]);
    expect(rows(activeWorkoutSets.value)).toEqual([['w1', 'e_bench', 1, 3], ['w1', 'e_bench', 2, 4]]);

    await removeSet(a, 'tok');
    expect(rows(sets.value.filter((s) => s.workout_id === 'w1'))).toEqual([['w1', 'e_bench', 2, 3]]);
  });
});

describe('dropAndShiftRows', () => {
  it('leaves rows above the deleted one unchanged', () => {
    expect(rows(dropAndShiftRows(ALL, 4))).toEqual([
      ['w1', 'e_bench', 1, 2],
      ['w1', 'e_bench', 2, 3],
      ['w2', 'e_curl', 1, 4],
    ]);
  });
});
