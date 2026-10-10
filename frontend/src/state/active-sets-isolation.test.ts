// #374: `activeWorkoutSets` only ever holds the active workout's rows. Two
// writers broke that: `flushQueue` replaced them with a queued set's OTHER
// workout's rows (so the next edit appended a duplicate set row), and a
// `startWorkout` whose set write failed left the new id paired with the
// previous workout's sets and warmups. Drives the REAL actions.ts,
// sync-queue.ts and workouts-api.ts through an in-memory `../api/sheets`, the
// harness plan-active-isolation.test.ts uses, with a `sheetsUpdate` that
// writes the row and failure switches for the Sets/Workouts writes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  workouts, sets, templates, toasts,
  activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode,
} from './store';
import type { SetWithRow, Template, BuilderExercise, WorkoutSet } from '../api/types';

type Tab = 'Workouts' | 'Sets';
let sheet: Record<Tab, string[][]>;
/** Thrown by the next `sheetsAppend` to that tab, when set. */
let appendFailure: Partial<Record<Tab, Error>> = {};
/** Thrown by every `sheetsGet` of Sets, when set. */
let setsGetFailure: Error | null = null;

const colIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  const [, colStart, rowStart, colEnd, rowEnd] = m;
  return {
    tab: tab as Tab,
    colStart: colIndex(colStart),
    colEnd: colIndex(colEnd),
    rowStart: rowStart ? Number(rowStart) : null,
    rowEnd: rowEnd ? Number(rowEnd) : null,
  };
}

vi.mock('../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async (range: string) => {
    const { tab, colStart, colEnd, rowStart, rowEnd } = parseRange(range);
    if (tab === 'Sets' && setsGetFailure) throw setsGetFailure;
    const rows = sheet[tab];
    const out: string[][] = [];
    for (let r = rowStart ?? 2; r <= (rowEnd ?? rows.length + 1); r++) {
      if (rows[r - 2]) out.push(rows[r - 2].slice(colStart, colEnd + 1));
    }
    return out;
  }),
  sheetsUpdate: vi.fn(async (range: string, values: (string | number)[][]) => {
    const { tab, colStart, rowStart } = parseRange(range);
    values.forEach((row, i) => {
      const target = sheet[tab][(rowStart ?? 2) - 2 + i];
      row.forEach((v, j) => { target[colStart + j] = String(v); });
    });
  }),
  sheetsAppend: vi.fn(async (range: string, values: (string | number)[][]) => {
    const [tab] = range.split('!') as [Tab];
    const failure = appendFailure[tab];
    if (failure) {
      delete appendFailure[tab];
      throw failure;
    }
    for (const row of values) sheet[tab].push(row.map(String));
  }),
  sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(async () => 1),
}));

vi.mock('../api/demo-data', () => ({
  isDemo: () => false,
  DEMO_WORKOUTS: [],
  DEMO_SETS: [],
  shiftDemoWorkouts: (w: unknown) => w,
}));
vi.mock('../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));

const { saveSet, startWorkout } = await import('./actions');
const { flushQueue, readQueue, clearQueue, enqueueSet } = await import('../api/sync-queue');

const TOKEN = 'test-token';

const PUSH: Template = {
  id: 'tpl_push',
  name: 'Upper Push A',
  exercises: [
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_bp', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 3 },
  ],
};
const PUSH_WARMUPS = [{ exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', exercise_order: 1 }];

const WARMUP_EX: BuilderExercise = { exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', section: 'warmup', sets: 1, planned_reps: '' };
const MAIN_EX: BuilderExercise = { exercise_id: 'ex_bp', exercise_name: 'Bench Press BB', section: 'primary', sets: 3, planned_reps: '8' };

function makeSet(workoutId: string, overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    workout_id: workoutId,
    exercise_id: 'ex_sq',
    exercise_name: 'Squat',
    section: 'primary',
    exercise_order: 1,
    set_number: 1,
    planned_reps: '5',
    weight: '100',
    reps: '5',
    effort: 'Hard',
    ...overrides,
  };
}

const sheetRowsFor = (workoutId: string) => sheet.Sets.filter((r) => r[0] === workoutId);

beforeEach(() => {
  sheet = { Workouts: [], Sets: [] };
  appendFailure = {};
  setsGetFailure = null;
  clearQueue();
  workouts.value = [];
  sets.value = [];
  templates.value = [PUSH];
  toasts.value = [];
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
  isEditMode.value = false;
});

describe('#374 flushQueue', () => {
  it('repro: A\'s queued set flushed from B\'s tracker, then B\'s set edited, leaves one B row', async () => {
    // A is active; its set save fails on the network and is queued with no row.
    activeWorkoutId.value = 'w_a';
    appendFailure.Sets = new TypeError('Failed to fetch');
    await expect(saveSet(makeSet('w_a'), TOKEN)).rejects.toThrow(TypeError);
    expect(readQueue().map((e) => e.payload.sheetRow)).toEqual([-1]);

    // B becomes active and saves a set.
    activeWorkoutId.value = 'w_b';
    activeWorkoutSets.value = [];
    await saveSet(makeSet('w_b', { exercise_id: 'ex_bp', exercise_name: 'Bench' }), TOKEN);

    await flushQueue(TOKEN);

    expect(activeWorkoutSets.value.map((s) => s.workout_id)).toEqual(['w_b']);

    // Editing B's set updates its row in place.
    await saveSet(makeSet('w_b', { exercise_id: 'ex_bp', exercise_name: 'Bench', weight: '110' }), TOKEN);
    expect(sheetRowsFor('w_b').map((r) => r[7])).toEqual(['110']);
  });

  describe('AC1: flushing another workout\'s queued set leaves the active workout\'s sets alone', () => {
    async function setUpB(): Promise<SetWithRow> {
      // A has one row on the sheet already (row 2); B is active with one saved set (row 3).
      sheet.Sets.push(['w_a', 'ex_dl', 'Deadlift', 'primary', '2', '1', '5', '200', '5', 'Hard']);
      sets.value = [{ ...makeSet('w_a', { exercise_id: 'ex_dl', exercise_name: 'Deadlift', exercise_order: 2, weight: '200' }), sheetRow: 2 }];
      activeWorkoutId.value = 'w_b';
      return saveSet(makeSet('w_b', { exercise_id: 'ex_bp', exercise_name: 'Bench' }), TOKEN);
    }

    it('with a queued A set that has no sheet row, and one that has', async () => {
      const bSaved = await setUpB();
      expect(bSaved.sheetRow).toBe(3);
      const bBefore = activeWorkoutSets.value;

      enqueueSet({ ...makeSet('w_a', { exercise_id: 'ex_dl', exercise_name: 'Deadlift', exercise_order: 2, weight: '210' }), sheetRow: 2 });
      enqueueSet({ ...makeSet('w_a', { weight: '150' }), sheetRow: -1 });

      const result = await flushQueue(TOKEN);
      expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });

      // A's sets are written and `sets` reflects them.
      expect(sheetRowsFor('w_a').map((r) => r[7])).toEqual(['210', '150']);
      const aInSets = sets.value.filter((s) => s.workout_id === 'w_a');
      expect(aInSets.map((s) => [s.weight, s.sheetRow])).toEqual([['210', 2], ['150', 4]]);

      // B's rows only, with their current sheetRow from the fresh fetch.
      expect(activeWorkoutSets.value).toEqual(bBefore);
      expect(activeWorkoutSets.value.map((s) => [s.workout_id, s.sheetRow])).toEqual([['w_b', 3]]);

      // Editing B's saved set updates its existing row.
      await saveSet(makeSet('w_b', { exercise_id: 'ex_bp', exercise_name: 'Bench', weight: '120' }), TOKEN);
      expect(sheetRowsFor('w_b').map((r) => r[7])).toEqual(['120']);
    });

    it('with only a queued A set that has a sheet row, B\'s in-memory sets are not touched', async () => {
      await setUpB();
      const bBefore = activeWorkoutSets.value;
      enqueueSet({ ...makeSet('w_a', { exercise_id: 'ex_dl', exercise_name: 'Deadlift', exercise_order: 2, weight: '210' }), sheetRow: 2 });

      await flushQueue(TOKEN);

      expect(activeWorkoutSets.value).toBe(bBefore);
      expect(sets.value.find((s) => s.sheetRow === 2)?.weight).toBe('210');
    });
  });

  describe('AC2: flushing the active workout\'s own queued set still updates it in memory', () => {
    it('a queued B set with no sheet row is appended and appears with its new sheetRow', async () => {
      activeWorkoutId.value = 'w_b';
      enqueueSet({ ...makeSet('w_b'), sheetRow: -1 });

      await flushQueue(TOKEN);

      expect(activeWorkoutSets.value.map((s) => [s.workout_id, s.weight, s.sheetRow])).toEqual([['w_b', '100', 2]]);
      expect(sets.value).toEqual(activeWorkoutSets.value);
    });

    it('a queued B set with a sheet row is updated in place in both signals', async () => {
      activeWorkoutId.value = 'w_b';
      await saveSet(makeSet('w_b'), TOKEN);
      enqueueSet({ ...makeSet('w_b', { weight: '130' }), sheetRow: 2 });

      await flushQueue(TOKEN);

      expect(activeWorkoutSets.value.map((s) => [s.weight, s.sheetRow])).toEqual([['130', 2]]);
      expect(sets.value.map((s) => [s.weight, s.sheetRow])).toEqual([['130', 2]]);
      expect(sheetRowsFor('w_b').map((r) => r[7])).toEqual(['130']);
    });
  });

  describe('AC3: a flush with no active workout touches only `sets`', () => {
    it('appends the set, refreshes `sets`, and leaves activeWorkoutSets []', async () => {
      enqueueSet({ ...makeSet('w_a'), sheetRow: -1 });

      await flushQueue(TOKEN);

      expect(sets.value.map((s) => [s.workout_id, s.sheetRow])).toEqual([['w_a', 2]]);
      expect(activeWorkoutSets.value).toEqual([]);
    });
  });
});

describe('#374 AC4: a start whose set write fails leaves the active signals agreeing', () => {
  const A_SETS: SetWithRow[] = [{ ...makeSet('w_a'), sheetRow: 2 }];
  const A_WARMUPS = [{ exercise_id: 'ex_hip', exercise_name: 'Hip Circles', exercise_order: 0 }];

  beforeEach(() => {
    sheet.Sets.push(['w_a', 'ex_sq', 'Squat', 'primary', '1', '1', '5', '100', '5', 'Hard']);
    sets.value = [...A_SETS];
    activeWorkoutId.value = 'w_a';
    activeWorkoutSets.value = A_SETS;
    activeWarmupExercises.value = A_WARMUPS;
  });

  const STARTS: [string, { template_id?: string; exercises?: BuilderExercise[] }, typeof PUSH_WARMUPS][] = [
    ['a template', { template_id: 'tpl_push' }, PUSH_WARMUPS],
    ['builder exercises', { exercises: [WARMUP_EX, MAIN_EX] }, []],
  ];

  const FAILURES: [string, () => void][] = [
    ['the Sets append', () => { appendFailure.Sets = new Error('append failed'); }],
    ['the re-fetch after it', () => { setsGetFailure = new Error('fetch failed'); }],
  ];

  describe.each(FAILURES)('when %s throws', (_label, arrange) => {
    it.each(STARTS)('from %s: the three signals describe the new workout', async (_l, start, warmups) => {
      arrange();

      await expect(startWorkout({ type: 'weight', name: 'New', ...start }, TOKEN)).rejects.toThrow();

      expect(toasts.value.map((t) => t.text)).toContain('Failed to start workout');
      const newWorkout = workouts.value[0];
      expect(newWorkout.status).toBe('active');
      expect(newWorkout.id).not.toBe('w_a');

      // What opening /workout/<new id> would derive.
      expect(activeWorkoutId.value).toBe(newWorkout.id);
      expect(activeWorkoutSets.value).toEqual(sets.value.filter((s) => s.workout_id === newWorkout.id));
      expect(activeWorkoutSets.value.every((s) => s.workout_id === newWorkout.id)).toBe(true);
      expect(activeWarmupExercises.value).toEqual(warmups);
    });
  });

  it('when creating the workout row itself fails, nothing in the three signals changes', async () => {
    appendFailure.Workouts = new Error('create failed');

    await expect(startWorkout({ type: 'weight', name: 'New', template_id: 'tpl_push' }, TOKEN)).rejects.toThrow('create failed');

    expect(toasts.value.map((t) => t.text)).toContain('Failed to start workout');
    expect(activeWorkoutId.value).toBe('w_a');
    expect(activeWorkoutSets.value).toBe(A_SETS);
    expect(activeWarmupExercises.value).toBe(A_WARMUPS);
  });
});
