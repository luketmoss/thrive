// #394 — after the tracker deletes a Sets row, every row below it moves up by
// one, and the tracker, the in-memory sets and the offline queue all follow
// that shift. The tracker's writes run one at a time, each reading its set's
// row from the latest list when it starts.
//
// Drives the real WorkoutTracker and the real removeSet / saveSet /
// sync-queue / workouts-api over an in-memory Sets tab whose row delete
// shifts the rows below it, as Sheets does (the `../../api/sheets` harness of
// #389's tests), with fake timers for the 1 s debounce. Only finishWorkout is
// stubbed: it writes the Workouts tab, which these tests do not look at.
//
// Saves here go through main's saveSet, which finds a set's row in
// `activeWorkoutSets` by (exercise, order, set number). A save after a MOVE
// is #389's to aim at the set's own row; these tests check the delete-shift
// side of it: the rows the tracker holds, and the rows in memory.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode, workouts, sets, toasts } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';

type Row = string[];
let sheet: { Sets: Row[] };
let deleteFailure: Error | null = null;
let deleteGate: Promise<void> | null = null;
let appendGate: Promise<void> | null = null;

const colIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  const [, colStart, rowStart, colEnd, rowEnd] = m;
  return {
    tab, colStart: colIndex(colStart), colEnd: colIndex(colEnd),
    rowStart: rowStart ? Number(rowStart) : null, rowEnd: rowEnd ? Number(rowEnd) : null,
  };
}

/** Every Sets write, in order: an update and a delete name their row, an append does not. */
const writes: { kind: 'update' | 'append' | 'delete'; row?: number; values: Row }[] = [];
let fetches = 0;

vi.mock('../../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async (range: string) => {
    fetches++;
    const { colStart, colEnd } = parseRange(range);
    return sheet.Sets.map((r) => r.slice(colStart, colEnd + 1));
  }),
  sheetsUpdate: vi.fn(async (range: string, values: (string | number)[][]) => {
    const { rowStart } = parseRange(range);
    const row = values[0].map(String);
    writes.push({ kind: 'update', row: rowStart!, values: row });
    sheet.Sets[rowStart! - 2] = row;
  }),
  sheetsAppend: vi.fn(async (_range: string, values: (string | number)[][]) => {
    if (appendGate) await appendGate;
    for (const v of values) {
      const row = v.map(String);
      writes.push({ kind: 'append', values: row });
      sheet.Sets.push(row);
    }
  }),
  // A row delete shifts every row below it up by one, as Sheets does.
  sheetsDeleteRow: vi.fn(async (_sheetId: number, rowIndex: number) => {
    if (deleteGate) await deleteGate;
    if (deleteFailure) throw deleteFailure;
    const [gone] = sheet.Sets.splice(rowIndex - 2, 1);
    writes.push({ kind: 'delete', row: rowIndex, values: gone });
  }),
  getSheetId: vi.fn(async () => 1),
}));
vi.mock('../../api/demo-data', () => ({
  isDemo: () => false, DEMO_WORKOUTS: [], DEMO_SETS: [], shiftDemoWorkouts: (w: unknown) => w,
}));
vi.mock('../../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn(), goBack: vi.fn() }));
const finishWorkout = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../state/actions', async (orig) => ({
  ...(await orig<typeof import('../../state/actions')>()),
  finishWorkout: (...args: unknown[]) => finishWorkout(...args),
}));

const { WorkoutTracker } = await import('./workout-tracker');
const { readQueue, clearQueue, enqueueSet } = await import('../../api/sync-queue');
const { fetchSets } = await import('../../api/workouts-api');

/** [workout_id, exercise_id, name, section, order, set #, weight, reps] */
type Spec = [string, string, string, string, number, number, string, string];
const toRow = ([w, id, name, section, order, n, weight, reps]: Spec): Row =>
  [w, id, name, section, String(order), String(n), '8', weight, reps, ''];

/** [workout, exercise_id, section, order, set #, weight] of a Sets row. */
const brief = (r: Row) => [r[0], r[1], r[3], Number(r[4]), Number(r[5]), r[7]];
const sheetBrief = () => sheet.Sets.map(brief);
const deletes = () => writes.filter((w) => w.kind === 'delete').map((w) => w.row);

async function mount(specs: Spec[]) {
  sheet = { Sets: specs.map(toRow) };
  const all = await fetchSets('test-token');
  sets.value = all;
  activeWorkoutSets.value = all.filter((s) => s.workout_id === 'w1');
  fetches = 0;
  return render(<WorkoutTracker workoutId="w1" workoutName="Push A" />);
}

/** The exercise cards in screen order (warmups included). */
const cards = () => [...document.querySelectorAll<HTMLElement>('.tracker-exercise-list > [data-row-key]')];
const card = (name: string, nth = 0) =>
  cards().filter((c) => c.textContent!.includes(name))[nth];
const setRows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.tracker-set')];
const removeSetBtn = (c: HTMLElement, set: number) =>
  setRows(c)[set].querySelector<HTMLButtonElement>('.set-remove-btn')!;
const weightInput = (c: HTMLElement, set = 0) =>
  setRows(c)[set].querySelector<HTMLInputElement>('.set-weight-input')!;
const saved = (c: HTMLElement, set = 0) =>
  setRows(c)[set].querySelector('.set-saved')!.getAttribute('aria-hidden') === 'false';
const type = (c: HTMLElement, value: string, set = 0) =>
  fireEvent.input(weightInput(c, set), { target: { value } });
const removeExercise = (c: HTMLElement) =>
  fireEvent.click(c.querySelector<HTMLButtonElement>('.exercise-toolbar-remove')!);
const move = (c: HTMLElement, dir: 'up' | 'down') =>
  fireEvent.click(c.querySelector<HTMLButtonElement>(`[data-move="${dir}"]`)!);
const activeRows = () =>
  activeWorkoutSets.value.map((s) => [s.exercise_id, s.section, s.exercise_order, s.set_number, s.sheetRow]);

/** Let every queued write and its promise chain run. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { p, open };
}

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  deleteFailure = null;
  deleteGate = null;
  appendGate = null;
  clearQueue();
  toasts.value = [];
  activeWorkoutId.value = 'w1';
  activeWarmupExercises.value = [];
  workouts.value = [];
  isEditMode.value = false;
  finishWorkout.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  isEditMode.value = false;
});

// Bench 1-3 on rows 2-4, Row 1 on row 5, all with values; another workout below.
const BENCH3_ROW: Spec[] = [
  ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
  ['w1', 'e_bench', 'Bench', 'primary', 1, 2, '145', '8'],
  ['w1', 'e_bench', 'Bench', 'primary', 1, 3, '155', '6'],
  ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
  ['w2', 'e_curl', 'Curl', 'primary', 1, 1, '30', '12'],
];

describe('#394 AC1: after Remove set, every other set keeps its own row', () => {
  it('Bench 1 then Bench 3: the second remove deletes Bench 3\'s row, never Row\'s', async () => {
    await mount(BENCH3_ROW);
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    expect(deletes()).toEqual([2]);

    // Bench set 3 is now the second Bench card row.
    fireEvent.click(removeSetBtn(card('Bench'), 1));
    await settle();
    expect(deletes()).toEqual([2, 3]);

    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 2, '145'],
      ['w1', 'e_row', 'primary', 2, 1, '95'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
    ]);
    expect(setRows(card('Bench'))).toHaveLength(1);
    expect(setRows(card('Row'))).toHaveLength(1);
    expect(writes.filter((w) => w.kind !== 'delete')).toEqual([]);

    // In memory: the rows left hold their own current rows, no re-fetch.
    expect(activeRows()).toEqual([
      ['e_bench', 'primary', 1, 2, 2],
      ['e_row', 'primary', 2, 1, 3],
    ]);
    expect(sets.value.map((s) => [s.workout_id, s.sheetRow])).toEqual([['w1', 2], ['w1', 3], ['w2', 4]]);
    expect(fetches).toBe(0);
  });

  it('typing into Row set 1 afterwards updates Row\'s own row (now 3) and appends nothing', async () => {
    await mount(BENCH3_ROW);
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    fireEvent.click(removeSetBtn(card('Bench'), 1));
    await settle();

    type(card('Row'), '100');
    await vi.advanceTimersByTimeAsync(1000);
    const after = writes.filter((w) => w.kind !== 'delete');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(after[0].values)).toEqual(['w1', 'e_row', 'primary', 2, 1, '100']);
    expect(saved(card('Row'))).toBe(true);
    expect(sheet.Sets[2]).toEqual(toRow(BENCH3_ROW[4])); // the other workout untouched

    // The tracker's cached row for Row set 1 is 3: removing it deletes row 3.
    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([2, 3, 3]);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 2, '145'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
    ]);
  });

  it('a warmup with a stored row below the delete is shifted too', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
      ['w1', 'e_bike', 'Bike', 'warmup', 3, 1, '', ''],
      ['w2', 'e_curl', 'Curl', 'primary', 1, 1, '30', '12'],
    ]);
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    removeExercise(card('Bike'));
    await settle();
    expect(deletes()).toEqual([2, 3]);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_row', 'primary', 2, 1, '95'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
    ]);
  });

  it('after a move, the shift follows the row, never the exercise order', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
      ['w1', 'e_curl', 'Curl', 'primary', 3, 1, '30', '12'],
      ['w2', 'e_curl', 'Curl', 'primary', 1, 1, '25', '12'],
    ]);
    move(card('Curl'), 'up'); // Curl now order 2, Row order 3 (unwritten in log mode)
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    fireEvent.click(removeSetBtn(card('Curl'), 0));
    await settle();
    expect(deletes()).toEqual([2, 3]); // Curl's own row after the shift
    expect(sheetBrief()).toEqual([
      ['w1', 'e_row', 'primary', 2, 1, '95'],
      ['w2', 'e_curl', 'primary', 1, 1, '25'],
    ]);
    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([2, 3, 2]);
    expect(sheetBrief()).toEqual([['w2', 'e_curl', 'primary', 1, 1, '25']]);
  });

  // #393 review, case 1: same-section twins after Remove exercise above them.
  it('same-section twins: after Remove exercise above them, each copy keeps its own row', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_curl', 'Curl', 'primary', 2, 1, '', ''],
      ['w1', 'e_curl', 'Curl', 'primary', 3, 1, '50', '10'],
    ]);
    removeExercise(card('Bench'));
    await settle();
    expect(deletes()).toEqual([2]);

    type(card('Curl', 0), '135');
    await vi.advanceTimersByTimeAsync(1000);
    const update = writes.find((w) => w.kind === 'update')!;
    expect(update.row).toBe(2);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_curl', 'primary', 2, 1, '135'],
      ['w1', 'e_curl', 'primary', 3, 1, '50'],
    ]);

    // The second copy's cached row is 3: removing its set deletes row 3 only.
    fireEvent.click(removeSetBtn(card('Curl', 1), 0));
    await settle();
    expect(deletes()).toEqual([2, 3]);
    expect(sheetBrief()).toEqual([['w1', 'e_curl', 'primary', 2, 1, '135']]);
  });

  // #393 review, case 2: cross-section twins plus a move after a delete.
  it('cross-section twins plus a move: removing a copy\'s set deletes that copy\'s own row', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_row', 'Row BB', 'primary', 2, 1, '', ''],
      ['w1', 'e_row', 'Row BB', 'SS1', 3, 1, '95', '8'],
    ]);
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    move(card('Row BB', 0), 'down'); // the primary copy now has order 3
    // The primary copy is now the second Row BB card.
    expect(card('Row BB', 1).querySelector('.section-badge-btn')!.textContent).toBe('primary');
    fireEvent.click(removeSetBtn(card('Row BB', 1), 0));
    await settle();
    expect(deletes()).toEqual([2, 2]);
    expect(sheetBrief()).toEqual([['w1', 'e_row', 'SS1', 3, 1, '95']]);
    expect(activeRows()).toEqual([['e_row', 'SS1', 3, 1, 2]]);

    fireEvent.click(removeSetBtn(card('Row BB', 0), 0));
    await settle();
    expect(deletes()).toEqual([2, 2, 2]);
    expect(sheet.Sets).toEqual([]);
  });
});

describe('#394 AC2: Copy-down, Change section to warmup and Remove exercise shift the same way', () => {
  const lastTimeWorkouts = () => {
    workouts.value = [
      { id: 'w0', date: '2026-10-01', type: 'weight', name: 'Push A' } as unknown as WorkoutWithRow,
      { id: 'w1', date: '2026-10-10', type: 'weight', name: 'Push A' } as unknown as WorkoutWithRow,
    ];
  };
  const copyDown = (c: HTMLElement) => {
    fireEvent.click(c.querySelector<HTMLButtonElement>('.last-time-toggle')!);
    fireEvent.click(c.querySelector<HTMLButtonElement>('.copy-down-btn')!);
  };

  it('copy-down onto fewer sets deletes the extra rows, then later writes hit their own rows', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_bench', 'Bench', 'primary', 1, 2, '145', '8'],
      ['w1', 'e_bench', 'Bench', 'primary', 1, 3, '155', '6'],
      ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
      ['w0', 'e_bench', 'Bench', 'primary', 1, 1, '120', '10'],
    ]);
    lastTimeWorkouts();
    copyDown(card('Bench'));
    await settle();
    expect(deletes()).toEqual([4, 3]); // bottom to top
    expect(setRows(card('Bench'))).toHaveLength(1);
    expect(weightInput(card('Bench')).value).toBe('120');

    // The kept set's copied values save to its own row (2).
    await vi.advanceTimersByTimeAsync(1000);
    const updates = writes.filter((w) => w.kind === 'update');
    expect(updates.map((u) => u.row)).toEqual([2]);
    expect(writes.filter((w) => w.kind === 'append')).toEqual([]);

    // Row set 1 moved from row 5 to row 3; w0's row from 6 to 4.
    expect(activeRows()).toEqual([
      ['e_bench', 'primary', 1, 1, 2],
      ['e_row', 'primary', 2, 1, 3],
    ]);
    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([4, 3, 3]);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 1, '120'],
      ['w0', 'e_bench', 'primary', 1, 1, '120'],
    ]);
  });

  it('applies its result to the list as it is when the deletes finish: a value typed meanwhile is kept', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_bench', 'Bench', 'primary', 1, 2, '145', '8'],
      ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
      ['w0', 'e_bench', 'Bench', 'primary', 1, 1, '120', '10'],
    ]);
    lastTimeWorkouts();
    const g = gate();
    deleteGate = g.p;
    copyDown(card('Bench'));
    await settle();
    type(card('Row'), '100'); // while Bench set 2's delete is in flight
    move(card('Row'), 'up');
    g.open();
    deleteGate = null;
    await settle();

    expect(deletes()).toEqual([3]);
    expect(cards()[0].textContent).toContain('Row'); // the move is kept
    expect(weightInput(card('Row')).value).toBe('100'); // the value is kept
    expect(setRows(card('Bench'))).toHaveLength(1);
  });

  it('Change section to warmup deletes the exercise\'s rows bottom to top, then shifts the rest', async () => {
    await mount([
      ['w1', 'e_bench', 'Bench', 'primary', 1, 1, '135', '8'],
      ['w1', 'e_bench', 'Bench', 'primary', 1, 2, '145', '8'],
      ['w1', 'e_row', 'Row', 'primary', 2, 1, '95', '10'],
      ['w2', 'e_curl', 'Curl', 'primary', 1, 1, '30', '12'],
    ]);
    const bench = card('Bench');
    fireEvent.click(bench.querySelector<HTMLButtonElement>('.section-badge-btn')!);
    fireEvent.click([...bench.querySelectorAll<HTMLButtonElement>('.section-picker-row button')].find((b) => b.textContent === 'warmup')!);
    fireEvent.click([...bench.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Switch to Warmup')!);
    await settle();
    expect(deletes()).toEqual([3, 2]);
    expect(card('Bench').classList.contains('tracker-exercise-warmup')).toBe(true);

    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([3, 2, 2]);
    expect(sheetBrief()).toEqual([['w2', 'e_curl', 'primary', 1, 1, '30']]);
  });

  it('Remove exercise deletes its rows, then later removes hit their own rows', async () => {
    await mount(BENCH3_ROW);
    removeExercise(card('Bench'));
    await settle();
    expect(deletes()).toEqual([4, 3, 2]);
    expect(card('Bench')).toBeUndefined();
    expect(activeRows()).toEqual([['e_row', 'primary', 2, 1, 2]]);

    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([4, 3, 2, 2]);
    expect(sheetBrief()).toEqual([['w2', 'e_curl', 'primary', 1, 1, '30']]);
  });

  it('a delete that fails stops the action: the deleted set stays without a row, and nothing holds a deleted row', async () => {
    await mount(BENCH3_ROW);
    // The first delete (row 4) lands; the second fails.
    const sheetsMod = await import('../../api/sheets');
    let n = 0;
    vi.mocked(sheetsMod.sheetsDeleteRow).mockImplementation(async (_id: number, rowIndex: number) => {
      n++;
      if (n === 2) throw new TypeError('Failed to fetch');
      const [gone] = sheet.Sets.splice(rowIndex - 2, 1);
      writes.push({ kind: 'delete', row: rowIndex, values: gone });
    });
    removeExercise(card('Bench'));
    await settle();
    expect(deletes()).toEqual([4]);
    expect(toasts.value.map((t) => t.text)).toContain('Failed to remove set');
    // All three sets stay on screen; set 3 lost its row and is unsaved.
    const bench = card('Bench');
    expect(setRows(bench)).toHaveLength(3);
    expect(saved(bench, 0)).toBe(true);
    expect(saved(bench, 2)).toBe(false);

    // Row set 1 moved from row 5 to 4: removing it deletes row 4.
    fireEvent.click(removeSetBtn(card('Row'), 0));
    await settle();
    expect(deletes()).toEqual([4, 4]);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 1, '135'],
      ['w1', 'e_bench', 'primary', 1, 2, '145'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
    ]);

    // Retrying deletes only the two rows still held, never the row deleted already.
    removeExercise(card('Bench'));
    await settle();
    expect(deletes()).toEqual([4, 4, 3, 2]);
    expect(sheetBrief()).toEqual([['w2', 'e_curl', 'primary', 1, 1, '30']]);
  });
});

describe('#394 AC3: the tracker\'s writes run one at a time', () => {
  it('a second tap of Remove set deletes nothing further', async () => {
    await mount(BENCH3_ROW);
    const g = gate();
    deleteGate = g.p;
    const btn = removeSetBtn(card('Bench'), 0);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await settle();
    g.open();
    deleteGate = null;
    await settle();
    expect(deletes()).toEqual([2]);
    expect(setRows(card('Bench'))).toHaveLength(2);
    expect(sheet.Sets).toHaveLength(4);
  });

  it('nothing on screen waits: the set leaves when its delete lands', async () => {
    await mount(BENCH3_ROW);
    const g = gate();
    deleteGate = g.p;
    const btn = removeSetBtn(card('Bench'), 0);
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await settle();
    expect(setRows(card('Bench'))).toHaveLength(3);
    expect(removeSetBtn(card('Bench'), 0).disabled).toBe(false);
    g.open();
    deleteGate = null;
    await settle();
    expect(setRows(card('Bench'))).toHaveLength(2);
  });

  it('a set removed while its first save is appending has the appended row deleted', async () => {
    await mount(BENCH3_ROW);
    fireEvent.click(card('Row').querySelector<HTMLButtonElement>('.add-set-btn')!);
    type(card('Row'), '100', 1);
    const g = gate();
    appendGate = g.p;
    await vi.advanceTimersByTimeAsync(1000); // the append is in flight
    fireEvent.click(removeSetBtn(card('Row'), 1));
    await settle();
    expect(deletes()).toEqual([]);
    g.open();
    appendGate = null;
    await settle();

    expect(writes.map((w) => [w.kind, w.row])).toEqual([['append', undefined], ['delete', 7]]);
    expect(sheet.Sets).toEqual(BENCH3_ROW.map(toRow)); // no orphan row
    expect(setRows(card('Row'))).toHaveLength(1);
    expect(activeRows()).toHaveLength(4);
  });

  it('a pending save that fires during a delete waits for it, then writes to the shifted row', async () => {
    await mount(BENCH3_ROW);
    type(card('Row'), '100');
    await vi.advanceTimersByTimeAsync(500);
    const g = gate();
    deleteGate = g.p;
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await vi.advanceTimersByTimeAsync(600); // the save's timer fires mid-delete
    expect(writes).toEqual([]);
    g.open();
    deleteGate = null;
    await settle();

    expect(writes.map((w) => [w.kind, w.row])).toEqual([['delete', 2], ['update', 4]]);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 2, '145'],
      ['w1', 'e_bench', 'primary', 1, 3, '155'],
      ['w1', 'e_row', 'primary', 2, 1, '100'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
    ]);
    expect(saved(card('Row'))).toBe(true);
  });

  it('Finish waits for a delete in flight before it saves anything or finishes', async () => {
    await mount(BENCH3_ROW);
    fireEvent.click(card('Row').querySelector<HTMLButtonElement>('.add-set-btn')!);
    type(card('Row'), '100', 1);
    const g = gate();
    deleteGate = g.p;
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Finish')!);
    fireEvent.click(document.querySelector('[role="dialog"] button.btn-primary')!);
    await vi.advanceTimersByTimeAsync(500);
    expect(finishWorkout).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    g.open();
    deleteGate = null;
    await vi.advanceTimersByTimeAsync(500);
    expect(writes.map((w) => [w.kind, w.row])).toEqual([['delete', 2], ['append', undefined]]);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(sheetBrief()).toEqual([
      ['w1', 'e_bench', 'primary', 1, 2, '145'],
      ['w1', 'e_bench', 'primary', 1, 3, '155'],
      ['w1', 'e_row', 'primary', 2, 1, '95'],
      ['w2', 'e_curl', 'primary', 1, 1, '30'],
      ['w1', 'e_row', 'primary', 2, 2, '100'],
    ]);
  });
});

describe('#394 AC4: the offline queue follows the same shift', () => {
  it('a queued entry below the deleted row gets one less; one for the removed set is dropped', async () => {
    await mount(BENCH3_ROW);
    const base = { exercise_name: 'x', section: 'primary', planned_reps: '8', reps: '8', effort: '' as const };
    enqueueSet({ ...base, workout_id: 'w1', exercise_id: 'e_bench', exercise_order: 1, set_number: 1, weight: '1', sheetRow: 2 });
    enqueueSet({ ...base, workout_id: 'w1', exercise_id: 'e_row', exercise_order: 2, set_number: 1, weight: '2', sheetRow: 5 });
    enqueueSet({ ...base, workout_id: 'w2', exercise_id: 'e_curl', exercise_order: 1, set_number: 1, weight: '3', sheetRow: 6 });
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    expect(readQueue().map((e) => [e.payload.exercise_id, e.payload.sheetRow])).toEqual([
      ['e_row', 4],
      ['e_curl', 5],
    ]);
  });
});

describe('#394 AC5: what does not change', () => {
  it('edit mode: Remove set and Remove exercise make no request and shift nothing', async () => {
    isEditMode.value = true;
    await mount(BENCH3_ROW);
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    removeExercise(card('Row'));
    await settle();
    expect(writes).toEqual([]);
    expect(setRows(card('Bench'))).toHaveLength(2);
    expect(card('Row')).toBeUndefined();
    expect(activeRows().map((r) => r[4])).toEqual([2, 3, 4, 5]);
  });

  it('a remove that fails keeps the set on screen with its row and shifts nothing', async () => {
    await mount(BENCH3_ROW);
    deleteFailure = new TypeError('Failed to fetch');
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    expect(toasts.value.map((t) => t.text)).toContain('Failed to remove set');
    expect(setRows(card('Bench'))).toHaveLength(3);
    expect(activeRows().map((r) => r[4])).toEqual([2, 3, 4, 5]);

    deleteFailure = null;
    fireEvent.click(removeSetBtn(card('Bench'), 0));
    await settle();
    expect(deletes()).toEqual([2]);
    expect(sheet.Sets).toHaveLength(4);
  });
});
