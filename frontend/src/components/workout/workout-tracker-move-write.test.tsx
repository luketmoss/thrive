// #392 — a Move up/down in a live workout is written to the sheet: the new
// exercise_order goes to every saved Sets row of the exercises involved, in
// one all-or-nothing batchUpdate of column E, on the tracker's one-at-a-time
// write queue (#394). #395 adds the section (column D) to the same write.
// Finish saves each unsaved set through its own row (#389) and repairs any row
// still out of order or section before the workout is marked finished. The offline queue keys a saved set by its row and follows moves.
//
// Drives the real WorkoutTracker and the real actions / sync-queue /
// workouts-api over an in-memory Sets tab (the `../../api/sheets` harness of
// #389's and #394's tests), with fake timers for the 1 s debounce. Only
// finishWorkout is stubbed: it writes the Workouts tab.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode, workouts, sets, toasts } from '../../state/store';

type Row = string[];
let sheet: { Sets: Row[] };

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

/** Every Sets row write, in order (updates, appends, deletes). */
const writes: { kind: 'update' | 'append' | 'delete'; row?: number; values: Row }[] = [];
/** Every batchUpdate, as its raw requests. */
const batches: any[][] = [];
/** Every request, in the order it started: 'update' | 'append' | 'delete' | 'batch'. */
const log: string[] = [];
let batchFailure: Error | null = null;
let batchGate: Promise<void> | null = null;
let updateGate: Promise<void> | null = null;
let updateFailure: Error | null = null;
let inFlight = 0;
let maxInFlight = 0;
const track = async <T,>(fn: () => Promise<T>): Promise<T> => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try { return await fn(); } finally { inFlight--; }
};

vi.mock('../../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async (range: string) => {
    const { colStart, colEnd } = parseRange(range);
    return sheet.Sets.map((r) => r.slice(colStart, colEnd + 1));
  }),
  sheetsUpdate: vi.fn(async (range: string, values: (string | number)[][]) => track(async () => {
    log.push('update');
    if (updateGate) await updateGate;
    if (updateFailure) throw updateFailure;
    const { rowStart } = parseRange(range);
    const row = values[0].map(String);
    writes.push({ kind: 'update', row: rowStart!, values: row });
    sheet.Sets[rowStart! - 2] = row;
  })),
  sheetsAppend: vi.fn(async (_range: string, values: (string | number)[][]) => track(async () => {
    log.push('append');
    for (const v of values) {
      const row = v.map(String);
      writes.push({ kind: 'append', values: row });
      sheet.Sets.push(row);
    }
  })),
  sheetsDeleteRow: vi.fn(async (_sheetId: number, rowIndex: number) => track(async () => {
    log.push('delete');
    const [gone] = sheet.Sets.splice(rowIndex - 2, 1);
    writes.push({ kind: 'delete', row: rowIndex, values: gone });
  })),
  // All or nothing, as Sheets' batchUpdate: a failure changes no cell.
  sheetsBatchUpdate: vi.fn(async (requests: any[]) => track(async () => {
    log.push('batch');
    if (batchGate) await batchGate;
    if (batchFailure) throw batchFailure;
    batches.push(requests);
    for (const r of requests) {
      const { start, rows } = r.updateCells;
      const value = rows[0].values[0].userEnteredValue;
      sheet.Sets[start.rowIndex - 1][start.columnIndex] = String(value.numberValue ?? value.stringValue);
    }
  })),
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

const { WorkoutTracker, ORDER_SAVE_FAILED } = await import('./workout-tracker');
const { readQueue, clearQueue, enqueueSet, flushQueue } = await import('../../api/sync-queue');
const { fetchSets } = await import('../../api/workouts-api');

/** [exercise_id, name, section, order, set #, weight, reps] */
type Spec = [string, string, string, number, number, string, string];
const toRow = ([id, name, section, order, n, weight, reps]: Spec): Row =>
  ['w1', id, name, section, String(order), String(n), '8', weight, reps, ''];

/** [exercise_id, section, order, set #, weight, reps] of a Sets row. */
const brief = (r: Row) => [r[1], r[3], Number(r[4]), Number(r[5]), r[7], r[8]];
const sheetBrief = () => sheet.Sets.map(brief);

/** Bench, Row, Curl: two sets each, every set on its own row (2..7), as a template start leaves them. */
const BENCH_ROW_CURL: Spec[] = [
  ['e_bench', 'Bench', 'primary', 1, 1, '100', '5'],
  ['e_bench', 'Bench', 'primary', 1, 2, '', ''],
  ['e_row', 'Row', 'primary', 2, 1, '90', '8'],
  ['e_row', 'Row', 'primary', 2, 2, '', ''],
  ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
  ['e_curl', 'Curl', 'burnout', 3, 2, '', ''],
];
const ROWBB_TWINS: Spec[] = [
  ['e_row', 'Row BB', 'primary', 1, 1, '95', '8'],
  ['e_row', 'Row BB', 'SS1', 2, 1, '', ''],
  ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
];

async function load(specs: Spec[]) {
  sheet = { Sets: specs.map(toRow) };
  const all = await fetchSets('test-token');
  sets.value = all;
  activeWorkoutSets.value = all;
}
async function mount(specs: Spec[]) {
  await load(specs);
  return render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
}
/** Leave the workout and open it again: a fresh tracker over memory as it is. */
function resume() {
  cleanup();
  return render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
}

const cards = () => [...document.querySelectorAll<HTMLElement>('.tracker-exercise-list > [data-row-key]')];
const cardHas = (i: number, text: string) => cards()[i].textContent!.includes(text);
const setRows = (card: number) => [...cards()[card].querySelectorAll<HTMLElement>('.tracker-set')];
const weightInput = (card: number, set = 0) =>
  setRows(card)[set].querySelector<HTMLInputElement>('.set-weight-input')!;
const type = (card: number, value: string, set = 0) =>
  fireEvent.input(weightInput(card, set), { target: { value } });
const moveBtn = (card: number, dir: 'up' | 'down') =>
  cards()[card].querySelector<HTMLButtonElement>(`[data-move="${dir}"]`)!;
const moveUp = (card: number) => fireEvent.click(moveBtn(card, 'up'));
const moveDown = (card: number) => fireEvent.click(moveBtn(card, 'down'));
/** [row, order] of every cell a batchUpdate wrote, checking each names column E only. */
const cellsOf = (requests: any[]) => requests.map((r) => {
  expect(Object.keys(r)).toEqual(['updateCells']);
  expect(r.updateCells.start.columnIndex).toBe(4);
  expect(r.updateCells.rows).toHaveLength(1);
  expect(r.updateCells.rows[0].values).toHaveLength(1);
  return [r.updateCells.start.rowIndex + 1, r.updateCells.rows[0].values[0].userEnteredValue.numberValue];
});
const finishBtn = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Finish')!;
const saveAndFinish = () => document.querySelector<HTMLButtonElement>('[role="dialog"] button.btn-primary')!;
async function finish() {
  fireEvent.click(finishBtn());
  fireEvent.click(saveAndFinish());
  await vi.advanceTimersByTimeAsync(200);
}
const memOrders = (list = activeWorkoutSets.value) =>
  list.map((s) => [s.sheetRow, s.exercise_id, s.exercise_order]);

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  batches.length = 0;
  log.length = 0;
  batchFailure = null;
  batchGate = null;
  updateGate = null;
  updateFailure = null;
  inFlight = 0;
  maxInFlight = 0;
  clearQueue();
  toasts.value = [];
  activeWorkoutId.value = 'w1';
  activeWarmupExercises.value = [];
  workouts.value = [];
  isEditMode.value = false;
  finishWorkout.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  isEditMode.value = false;
});

describe('AC1: a move is written to the saved rows of both exercises, at once', () => {
  it('Move up on Row: one batchUpdate of Sets!E for Row\'s and Bench\'s rows, nothing else', async () => {
    await mount(BENCH_ROW_CURL);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(batches).toHaveLength(1);
    expect(cellsOf(batches[0])).toEqual([[2, 2], [3, 2], [4, 1], [5, 1]]);
    expect(writes).toHaveLength(0); // no row updated whole, appended or deleted
    expect(sheetBrief()).toEqual([
      ['e_bench', 'primary', 2, 1, '100', '5'],
      ['e_bench', 'primary', 2, 2, '', ''],
      ['e_row', 'primary', 1, 1, '90', '8'],
      ['e_row', 'primary', 1, 2, '', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
      ['e_curl', 'burnout', 3, 2, '', ''],
    ]);
    // The in-memory rows carry the new orders.
    expect(memOrders()).toEqual([
      [2, 'e_bench', 2], [3, 'e_bench', 2], [4, 'e_row', 1], [5, 'e_row', 1], [6, 'e_curl', 3], [7, 'e_curl', 3],
    ]);
    expect(memOrders(sets.value)).toEqual(memOrders());
  });

  it('leaving and resuming shows Row, Bench, Curl, each one card holding all its sets and values', async () => {
    await mount(BENCH_ROW_CURL);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    resume();
    expect(cards()).toHaveLength(3);
    expect(cardHas(0, 'Row')).toBe(true);
    expect(cardHas(1, 'Bench')).toBe(true);
    expect(cardHas(2, 'Curl')).toBe(true);
    expect(setRows(0)).toHaveLength(2);
    expect(weightInput(0).value).toBe('90');
    expect(setRows(1)).toHaveLength(2);
    expect(weightInput(1).value).toBe('100');

    // A reload (memory rebuilt from the sheet) shows the same.
    const all = await fetchSets('test-token');
    sets.value = all;
    activeWorkoutSets.value = all;
    resume();
    expect(cards().map((c, i) => [i, cardHas(i, 'Row'), cardHas(i, 'Bench')])).toEqual([
      [0, true, false], [1, false, true], [2, false, false],
    ]);
  });

  it('a warmup with a stored row is written when moved, and when passed', async () => {
    await mount([
      ['e_cat', 'Cat-Cow', 'warmup', 1, 1, '', '10'],
      ['e_bench', 'Bench', 'primary', 2, 1, '100', '5'],
    ]);
    moveUp(1); // Bench passes the warmup
    await vi.advanceTimersByTimeAsync(0);
    expect(cellsOf(batches[0])).toEqual([[2, 2], [3, 1]]);

    moveUp(1); // the warmup moves back up
    await vi.advanceTimersByTimeAsync(0);
    expect(cellsOf(batches[1])).toEqual([[2, 1], [3, 2]]);
    expect(sheetBrief().map((r) => r[2])).toEqual([1, 2]);
  });

  it('a move from an end makes no request', async () => {
    await mount(BENCH_ROW_CURL);
    moveUp(0);
    moveDown(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual([]);
  });

  it('a swap of two exercises with no saved row makes no request; with one, only its rows', async () => {
    // Dip and Fly have no row yet (as exercises added mid-workout).
    activeWorkoutSets.value = [
      { workout_id: 'w1', exercise_id: 'e_bench', exercise_name: 'Bench', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '8', weight: '100', reps: '5', effort: '', sheetRow: 2 },
      { workout_id: 'w1', exercise_id: 'e_dip', exercise_name: 'Dip', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: -1 },
      { workout_id: 'w1', exercise_id: 'e_fly', exercise_name: 'Fly', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: -1 },
    ];
    render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
    moveUp(2); // Fly above Dip: neither has a row
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual([]);

    moveUp(1); // Fly above Bench: only Bench has a row
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(cellsOf(batches[0])).toEqual([[2, 2]]);
  });
});

describe('AC2: a duplicate\'s two copies keep their own rows and values', () => {
  it('Move up the SS1 copy, type 135, Finish: SS1 rows order 1 with 135, primary rows order 2 with 95 x 8, no append', async () => {
    await mount(ROWBB_TWINS);
    moveUp(1);
    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);

    // Resume before Finish: two Row BB cards, SS1 first, primary second.
    resume();
    expect(cards()).toHaveLength(3);
    expect(cards()[0].querySelector('.section-badge-btn')!.textContent).toBe('SS1');
    expect(weightInput(0).value).toBe('135');
    expect(cards()[1].querySelector('.section-badge-btn')!.textContent).toBe('primary');
    expect(weightInput(1).value).toBe('95');

    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(writes.filter((w) => w.kind === 'append')).toHaveLength(0);
    expect(sheetBrief()).toEqual([
      ['e_row', 'primary', 2, 1, '95', '8'],
      ['e_row', 'SS1', 1, 1, '135', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
    ]);
  });
});

describe('AC3: Finish saves by row and leaves the sheet in the order shown', () => {
  it('an unsaved set is saved to its own row, never to the row a lookup by order finds (the twin\'s)', async () => {
    await mount(ROWBB_TWINS);
    batchFailure = new TypeError('Failed to fetch');
    moveUp(1); // the move write fails: memory still has the primary copy at order 1
    await vi.advanceTimersByTimeAsync(0);
    type(0, '135'); // SS1 copy, now order 1
    batchFailure = null;
    await finish(); // before the debounce fires

    expect(finishWorkout).toHaveBeenCalledTimes(1);
    const rowWrites = writes.filter((w) => w.kind !== 'delete');
    expect(rowWrites).toHaveLength(1);
    expect(rowWrites[0]).toMatchObject({ kind: 'update', row: 3 });
    // Every row in order before Finish.
    expect(sheetBrief()).toEqual([
      ['e_row', 'primary', 2, 1, '95', '8'],
      ['e_row', 'SS1', 1, 1, '135', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
    ]);
    // The repair of the failed move ran first, then the save; nothing left after it.
    expect(log.slice(-2)).toEqual(['batch', 'update']);
  });

  it('a set with no row is appended once at Finish, with its current order', async () => {
    await mount(BENCH_ROW_CURL);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    type(1, '135', 2);
    moveUp(1);
    await finish();
    const appends = writes.filter((w) => w.kind === 'append');
    expect(appends).toHaveLength(1);
    expect(brief(appends[0].values)).toEqual(['e_row', 'primary', 1, 3, '135', '']);
    expect(sheet.Sets).toHaveLength(7);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
  });

  it('waits for a move write still in flight, and makes no second order write when nothing differs', async () => {
    await mount(BENCH_ROW_CURL);
    let release!: () => void;
    batchGate = new Promise((r) => { release = r; });
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(finishBtn());
    fireEvent.click(saveAndFinish());
    await vi.advanceTimersByTimeAsync(500);
    expect(finishWorkout).not.toHaveBeenCalled();
    release();
    batchGate = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1); // the move's; Finish found nothing to repair
  });

  it('repairs the order a failed move write left behind, before marking the workout finished', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new TypeError('Failed to fetch');
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sheetBrief()[0][2]).toBe(1); // not written
    batchFailure = null;
    let ordersAtFinish: number[] = [];
    finishWorkout.mockImplementationOnce(async () => {
      ordersAtFinish = sheetBrief().map((r) => Number(r[2]));
    });
    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(ordersAtFinish).toEqual([2, 2, 1, 1, 3, 3]);
  });

  it('a failed repair stops Finish: the toast, the form kept with notes and effort, retry works', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new Error('500');
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.value).toHaveLength(0); // a failed move write is silent (AC4)

    fireEvent.click(finishBtn());
    const dialog = document.querySelector('[role="dialog"]')!;
    fireEvent.input(dialog.querySelector('textarea')!, { target: { value: 'Felt strong' } });
    fireEvent.click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Hard')!);
    const active = document.activeElement;
    fireEvent.click(saveAndFinish());
    await vi.advanceTimersByTimeAsync(200);

    expect(finishWorkout).not.toHaveBeenCalled();
    expect(toasts.value.map((t) => t.text)).toEqual([ORDER_SAVE_FAILED]);
    expect(ORDER_SAVE_FAILED).toBe("Couldn't save the exercise order and sections. Try again.");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!.value).toBe('Felt strong');
    expect([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Hard')!
      .getAttribute('aria-pressed') ?? 'true').toBe('true');
    expect(saveAndFinish().textContent).toBe('Save & Finish');
    expect(saveAndFinish().disabled).toBe(false);
    expect(document.activeElement).toBe(active);
    // The workout stays active, with every set and the on-screen order.
    expect(activeWorkoutSets.value).toHaveLength(6);
    expect(cardHas(0, 'Row')).toBe(true);

    batchFailure = null;
    fireEvent.click(saveAndFinish());
    await vi.advanceTimersByTimeAsync(200);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(finishWorkout.mock.calls[0]).toEqual(['w1', 'Felt strong', 'Hard', 'test-token']);
    expect(sheetBrief().map((r) => r[2])).toEqual([2, 2, 1, 1, 3, 3]);
  });
});

describe('AC3 with #395: a section that differs on the sheet does not leave Finish stuck', () => {
  it('a failed move write, then an edit: Finish repairs order and section first, so the own-row save is accepted', async () => {
    await mount(BENCH_ROW_CURL);
    // The sheet's section for Row differs from the card's (a section write that
    // never landed): the own-row check could match on order alone.
    sheet.Sets.forEach((r) => { if (r[1] === 'e_row') r[3] = 'SS2'; });
    activeWorkoutSets.value = activeWorkoutSets.value.map((s) =>
      s.exercise_id === 'e_row' ? { ...s, section: 'SS2' } : s);
    batchFailure = new TypeError('Failed to fetch');
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    batchFailure = null;
    type(0, '135'); // Row, now first
    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(toasts.value).toHaveLength(0);
    expect(writes.filter((w) => w.kind === 'update').map((w) => w.row)).toEqual([4]);
    expect(writes.filter((w) => w.kind === 'append')).toHaveLength(0);
    expect(sheetBrief().map((r) => r[2])).toEqual([2, 2, 1, 1, 3, 3]);
    // #395: the section is repaired with the order, in the same write.
    expect(sheetBrief().map((r) => r[1])).toEqual(['primary', 'primary', 'primary', 'primary', 'burnout', 'burnout']);
  });
});

describe('AC4: a move write that fails or is overtaken repairs itself', () => {
  it('a failed move write is silent, and the next move writes every row still out of order', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new TypeError('Failed to fetch');
    moveUp(1); // Row, Bench, Curl: fails
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.value).toHaveLength(0);
    expect(cardHas(0, 'Row')).toBe(true);

    batchFailure = null;
    moveUp(2); // Row, Curl, Bench
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(cellsOf(batches[0])).toEqual([[2, 3], [3, 3], [4, 1], [5, 1], [6, 2], [7, 2]]);
  });

  it('five quick presses: buttons stay enabled, writes run one at a time, the last leaves the final order', async () => {
    await mount(BENCH_ROW_CURL);
    let release!: () => void;
    batchGate = new Promise((r) => { release = r; });
    for (const [card, dir] of [[0, 'down'], [1, 'down'], [2, 'up'], [1, 'down'], [2, 'up']] as const) {
      const btn = moveBtn(card, dir);
      expect(btn.disabled).toBe(false);
      expect(btn.getAttribute('aria-disabled')).not.toBe('true');
      fireEvent.click(btn);
    }
    const onScreen = cards().map((_, i) => ['Bench', 'Row', 'Curl'].find((n) => cardHas(i, n)));
    release();
    batchGate = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(maxInFlight).toBe(1);
    const orderOf = (id: string) => [...new Set(sheet.Sets.filter((r) => r[1] === id).map((r) => Number(r[4])))];
    expect(onScreen).toEqual(['Row', 'Bench', 'Curl']);
    expect(orderOf('e_row')).toEqual([1]);
    expect(orderOf('e_bench')).toEqual([2]);
    expect(orderOf('e_curl')).toEqual([3]);
  });

  it('a set save in flight when the move is pressed carries the old order; the move write, after it, leaves the new one', async () => {
    await mount(BENCH_ROW_CURL);
    let release!: () => void;
    updateGate = new Promise((r) => { release = r; });
    type(1, '135'); // Row set 1
    await vi.advanceTimersByTimeAsync(1000); // the save is in flight, with order 2
    expect(log).toEqual(['update']);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['update']); // the move write waits for it
    release();
    updateGate = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['update', 'batch']);
    expect(sheetBrief().slice(0, 4)).toEqual([
      ['e_bench', 'primary', 2, 1, '100', '5'],
      ['e_bench', 'primary', 2, 2, '', ''],
      ['e_row', 'primary', 1, 1, '135', '8'],
      ['e_row', 'primary', 1, 2, '', ''],
    ]);
  });

  it('a flushed queued save with the old order is repaired by the next move', async () => {
    await mount(BENCH_ROW_CURL);
    // Queued before the move with order 2, by another path, never remapped.
    enqueueSet({ ...activeWorkoutSets.value[2], weight: '135' });
    const stale = readQueue()[0];
    moveUp(1);
    await vi.advanceTimersByTimeAsync(0);
    // The queue followed the move.
    expect(readQueue()[0].payload.exercise_order).toBe(1);
    // Simulate an entry the remap could not see (stored by an older build).
    localStorage.setItem('gw_sync_queue', JSON.stringify([stale]));
    await flushQueue('test-token');
    expect(sheetBrief()[2]).toEqual(['e_row', 'primary', 2, 1, '135', '8']);
    moveUp(2); // Curl above Bench: this write also covers Row's row the flush put back to 2
    await vi.advanceTimersByTimeAsync(0);
    expect(sheet.Sets.filter((r) => r[1] === 'e_row').map((r) => Number(r[4]))).toEqual([1, 1]);
  });
});

describe('AC5: the offline queue identifies a saved set by its row', () => {
  it('queued sets follow a move, rows and appends alike, and the flush never puts the old order back', async () => {
    await mount(ROWBB_TWINS);
    // Offline: the primary copy's edit (row 2) and the SS1 copy's added set 2 (no row) are queued.
    updateFailure = new TypeError('Failed to fetch');
    type(0, '100');
    await vi.advanceTimersByTimeAsync(1000);
    updateFailure = null;
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    const appendSpy = vi.spyOn(await import('../../api/sheets'), 'sheetsAppend');
    appendSpy.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(readQueue().map((e) => [e.key, e.payload.exercise_order])).toEqual([
      ['w1|row:2', 1],
      ['w1|e_row|2|2', 2],
    ]);

    batchFailure = new TypeError('Failed to fetch'); // still offline
    moveUp(1); // SS1 copy to order 1, primary to 2
    await vi.advanceTimersByTimeAsync(0);
    expect(readQueue().map((e) => [e.key, e.payload.section, e.payload.exercise_order])).toEqual([
      ['w1|row:2', 'primary', 2],
      ['w1|e_row|1|2', 'SS1', 1],
    ]);
    expect(JSON.stringify(readQueue())).not.toMatch(/rowKey/i);

    batchFailure = null;
    await flushQueue('test-token');
    expect(readQueue()).toHaveLength(0);
    expect(brief(sheet.Sets[0])).toEqual(['e_row', 'primary', 2, 1, '100', '8']);
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'SS1', 1, 2, '135', '']);
  });
});

describe('AC6: what does not change', () => {
  it('edit mode: a move makes no write', async () => {
    isEditMode.value = true;
    await mount(BENCH_ROW_CURL);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual([]);
  });

  it('log mode with no move: Finish makes no order write', async () => {
    await mount(BENCH_ROW_CURL);
    type(1, '135');
    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(0);
    expect(log).toEqual(['update']);
  });

  it('no request carries the row key', async () => {
    await mount(ROWBB_TWINS);
    moveUp(1);
    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);
    await finish();
    expect(JSON.stringify(batches)).not.toMatch(/rowKey|row-/);
    for (const w of writes) expect(w.values).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// #395 — a section change in a live workout is written to the saved rows.
// ---------------------------------------------------------------------------

const changeSection = (card: number, section: string) => {
  fireEvent.click(cards()[card].querySelector('.section-badge-btn')!);
  fireEvent.click([...cards()[card].querySelectorAll<HTMLButtonElement>('.section-picker-row button')]
    .find((b) => b.textContent === section)!);
};
const badge = (card: number) => cards()[card].querySelector('.section-badge-btn')!.textContent;
/** [row, column index, value] of every cell a batchUpdate wrote. */
const cellValues = (requests: any[]) => requests.map((r) => {
  expect(Object.keys(r)).toEqual(['updateCells']);
  expect(r.updateCells.rows).toHaveLength(1);
  expect(r.updateCells.rows[0].values).toHaveLength(1);
  const value = r.updateCells.rows[0].values[0].userEnteredValue;
  return [r.updateCells.start.rowIndex + 1, r.updateCells.start.columnIndex, value.numberValue ?? value.stringValue];
});
const sectionsOf = (id: string) => sheet.Sets.filter((r) => r[1] === id).map((r) => r[3]);
const memSections = (list = activeWorkoutSets.value) => list.map((s) => [s.sheetRow, s.section]);

describe('#395 AC1: a section change is written to the saved rows of that exercise, at once', () => {
  it('Primary to SS1 on Row: one batchUpdate of Sets!D for Row\'s rows, nothing else', async () => {
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);

    expect(batches).toHaveLength(1);
    expect(cellValues(batches[0])).toEqual([[4, 3, 'SS1'], [5, 3, 'SS1']]);
    expect(writes).toHaveLength(0); // no row updated whole, appended or deleted
    expect(sheetBrief()).toEqual([
      ['e_bench', 'primary', 1, 1, '100', '5'],
      ['e_bench', 'primary', 1, 2, '', ''],
      ['e_row', 'SS1', 2, 1, '90', '8'],
      ['e_row', 'SS1', 2, 2, '', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
      ['e_curl', 'burnout', 3, 2, '', ''],
    ]);
    // The in-memory rows carry the new section.
    expect(memSections()).toEqual([
      [2, 'primary'], [3, 'primary'], [4, 'SS1'], [5, 'SS1'], [6, 'burnout'], [7, 'burnout'],
    ]);
    expect(memSections(sets.value)).toEqual(memSections());
  });

  it('leaving and resuming, or reloading from the sheet, shows Row in SS1', async () => {
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    resume();
    expect(badge(1)).toBe('SS1');
    expect(cards()).toHaveLength(3);

    const all = await fetchSets('test-token');
    sets.value = all;
    activeWorkoutSets.value = all;
    resume();
    expect(cards().map((_, i) => badge(i))).toEqual(['primary', 'SS1', 'burnout']);
  });

  it('a duplicate of the exercise keeps its own section: rows are matched by row', async () => {
    await mount(ROWBB_TWINS);
    changeSection(1, 'SS2'); // the SS1 copy
    await vi.advanceTimersByTimeAsync(0);
    expect(cellValues(batches[0])).toEqual([[3, 3, 'SS2']]);
    expect(sheetBrief()).toEqual([
      ['e_row', 'primary', 1, 1, '95', '8'],
      ['e_row', 'SS2', 2, 1, '', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
    ]);
  });

  it('the change is instant: the badge shows it before the write finishes, with no toast', async () => {
    await mount(BENCH_ROW_CURL);
    let release!: () => void;
    batchGate = new Promise((r) => { release = r; });
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(badge(1)).toBe('SS1');
    expect(batches).toHaveLength(0); // still in flight
    expect(toasts.value).toHaveLength(0);
    release();
    batchGate = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(sectionsOf('e_row')).toEqual(['SS1', 'SS1']);
  });
});

describe('#395 AC2: only what differs is written; warmup and edit mode are unchanged', () => {
  it('an exercise with no saved row makes no request', async () => {
    activeWorkoutSets.value = [
      { workout_id: 'w1', exercise_id: 'e_bench', exercise_name: 'Bench', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '8', weight: '100', reps: '5', effort: '', sheetRow: 2 },
      { workout_id: 'w1', exercise_id: 'e_dip', exercise_name: 'Dip', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: -1 },
    ];
    render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(badge(1)).toBe('SS1');
    expect(log).toEqual([]);
  });

  it('changed to another section and back before the write runs: nothing differs, no request', async () => {
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'SS1');
    changeSection(1, 'primary');
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual([]);
    expect(sectionsOf('e_row')).toEqual(['primary', 'primary']);
  });

  it('a change to warmup deletes the exercise\'s rows as before and writes no section', async () => {
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'warmup');
    fireEvent.click([...cards()[1].querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Switch to Warmup')!);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['delete', 'delete']);
    expect(batches).toHaveLength(0);
  });

  it('a change from warmup writes nothing until a value is typed, then that row is adopted with the new section', async () => {
    await mount([
      ['e_cat', 'Cat-Cow', 'warmup', 1, 1, '', '10'],
      ['e_bench', 'Bench', 'primary', 2, 1, '100', '5'],
    ]);
    changeSection(0, 'primary');
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual([]);

    type(0, '20');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes.filter((w) => w.kind === 'update').map((w) => [w.row, w.values[3]])).toEqual([[2, 'primary']]);
    expect(writes.filter((w) => w.kind === 'append')).toHaveLength(0);
    expect(sheet.Sets).toHaveLength(2);
  });

  it('edit mode: a section change makes no write', async () => {
    isEditMode.value = true;
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(badge(1)).toBe('SS1');
    expect(log).toEqual([]);
  });
});

describe('#395 AC3: the offline queue follows the section', () => {
  it('queued sets of the exercise, with a row and without, take the new section; other exercises\' do not', async () => {
    await mount(BENCH_ROW_CURL);
    // Offline: Row set 1 (row 4) edited, a third Row set added (no row), Curl set 1 (row 6) edited.
    updateFailure = new TypeError('Failed to fetch');
    type(1, '100');
    await vi.advanceTimersByTimeAsync(1000);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    const appendSpy = vi.spyOn(await import('../../api/sheets'), 'sheetsAppend');
    appendSpy.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    type(1, '135', 2);
    await vi.advanceTimersByTimeAsync(1000);
    type(2, '20');
    await vi.advanceTimersByTimeAsync(1000);
    updateFailure = null;
    expect(readQueue().map((e) => [e.key, e.payload.section])).toEqual([
      ['w1|row:4', 'primary'],
      ['w1|e_row|2|3', 'primary'],
      ['w1|row:6', 'burnout'],
    ]);

    batchFailure = new TypeError('Failed to fetch'); // still offline
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(readQueue().map((e) => [e.key, e.payload.section, e.payload.exercise_order])).toEqual([
      ['w1|row:4', 'SS1', 2],
      ['w1|e_row|2|3', 'SS1', 2],
      ['w1|row:6', 'burnout', 3],
    ]);
    expect(JSON.stringify(readQueue())).not.toMatch(/rowKey/i);

    // Back online: the flush never puts the old section back, nor appends a row with it.
    batchFailure = null;
    await flushQueue('test-token');
    expect(readQueue()).toHaveLength(0);
    expect(brief(sheet.Sets[2])).toEqual(['e_row', 'SS1', 2, 1, '100', '8']);
    expect(brief(sheet.Sets[6])).toEqual(['e_row', 'SS1', 2, 3, '135', '']);
    expect(brief(sheet.Sets[4])).toEqual(['e_curl', 'burnout', 3, 1, '20', '']);

    // Finish settles the row the failed write left (Row set 2) and saves nothing twice.
    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(sectionsOf('e_row')).toEqual(['SS1', 'SS1', 'SS1']);
    expect(sheet.Sets).toHaveLength(7); // the 6 rows + the one queued append, once
  });
});

describe('#395 AC4: a section write that fails repairs itself, and Finish settles any that is left', () => {
  it('a failed write is silent, keeps the section on screen, and the next write covers every differing row', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new TypeError('Failed to fetch');
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.value).toHaveLength(0);
    expect(badge(1)).toBe('SS1');
    expect(sectionsOf('e_row')).toEqual(['primary', 'primary']); // not written

    batchFailure = null;
    moveUp(2); // Curl above Bench: any write repairs Row's rows too
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(sectionsOf('e_row')).toEqual(['SS1', 'SS1']);
    expect(cellValues(batches[0]).filter((c) => c[1] === 3)).toEqual([[4, 3, 'SS1'], [5, 3, 'SS1']]);
  });

  it('Finish writes a section a failed write left, before the workout is marked finished', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new TypeError('Failed to fetch');
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    batchFailure = null;
    let sectionsAtFinish: string[] = [];
    finishWorkout.mockImplementationOnce(async () => { sectionsAtFinish = sectionsOf('e_row'); });
    await finish();
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(sectionsAtFinish).toEqual(['SS1', 'SS1']);
    expect(toasts.value).toHaveLength(0);
  });

  it('a failed repair at Finish stops it with the new toast; the form stays and a retry works', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new Error('500');
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.value).toHaveLength(0);

    await finish();
    expect(finishWorkout).not.toHaveBeenCalled();
    expect(toasts.value.map((t) => t.text)).toEqual([ORDER_SAVE_FAILED]);
    expect(ORDER_SAVE_FAILED).toBe("Couldn't save the exercise order and sections. Try again.");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(badge(1)).toBe('SS1');

    batchFailure = null;
    fireEvent.click(saveAndFinish());
    await vi.advanceTimersByTimeAsync(200);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(sectionsOf('e_row')).toEqual(['SS1', 'SS1']);
  });

  it('a set saved after the change carries the new section', async () => {
    await mount(BENCH_ROW_CURL);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes.filter((w) => w.kind === 'update').map((w) => [w.row, w.values[3]])).toEqual([[4, 'SS1']]);
  });

  it('a save in flight with the old section, then the change: the write after it leaves the new section', async () => {
    await mount(BENCH_ROW_CURL);
    let release!: () => void;
    updateGate = new Promise((r) => { release = r; });
    type(1, '135'); // Row set 1
    await vi.advanceTimersByTimeAsync(1000); // the save is in flight, with Primary
    expect(log).toEqual(['update']);
    changeSection(1, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['update']); // the section write waits for it
    release();
    updateGate = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['update', 'batch']);
    expect(sectionsOf('e_row')).toEqual(['SS1', 'SS1']);
    expect(brief(sheet.Sets[2])).toEqual(['e_row', 'SS1', 2, 1, '135', '8']);
  });
});

describe('#395 AC5: a section change and a move together land together', () => {
  it('both writes failed offline: the next write sets order and section in one request, and the own-row save is accepted', async () => {
    await mount(BENCH_ROW_CURL);
    batchFailure = new TypeError('Failed to fetch');
    moveUp(1); // Row first
    changeSection(0, 'SS1');
    await vi.advanceTimersByTimeAsync(0);
    batchFailure = null;
    type(0, '135'); // Row set 1, before the debounce fires
    await finish();

    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(toasts.value).toHaveLength(0);
    expect(batches).toHaveLength(1);
    expect(cellValues(batches[0]).filter((c) => c[0] === 4).map((c) => [c[1], c[2]])).toEqual([[3, 'SS1'], [4, 1]]);
    expect(writes.filter((w) => w.kind === 'update').map((w) => w.row)).toEqual([4]);
    expect(writes.filter((w) => w.kind === 'append')).toHaveLength(0);
    expect(sheetBrief()).toEqual([
      ['e_bench', 'primary', 2, 1, '100', '5'],
      ['e_bench', 'primary', 2, 2, '', ''],
      ['e_row', 'SS1', 1, 1, '135', '8'],
      ['e_row', 'SS1', 1, 2, '', ''],
      ['e_curl', 'burnout', 3, 1, '', ''],
      ['e_curl', 'burnout', 3, 2, '', ''],
    ]);
  });
});
