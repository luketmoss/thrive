// #389 — a set's debounced auto-save targets the set's OWN sheet row, with
// the exercise's order, section and name as they are when the save fires,
// however the list was moved in between. Drives the real WorkoutTracker and
// the real saveSet / sync-queue / workouts-api over an in-memory Sets tab
// (the `../../api/sheets` harness of active-sets-isolation.test.ts), with
// fake timers for the 1 s debounce. Only finishWorkout is stubbed: it writes
// the Workouts tab, which these tests do not look at.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode, workouts, sets } from '../../state/store';

type Row = string[];
let sheet: { Sets: Row[] };
let updateFailure: Error | null = null;
/** Thrown by the next Sets append, when set. */
let appendFailure: Error | null = null;

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

/** Every Sets write, in order: an update names its row, an append does not. */
const writes: { kind: 'update' | 'append' | 'delete'; row?: number; values: Row }[] = [];

vi.mock('../../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async (range: string) => {
    const { colStart, colEnd } = parseRange(range);
    return sheet.Sets.map((r) => r.slice(colStart, colEnd + 1));
  }),
  sheetsUpdate: vi.fn(async (range: string, values: (string | number)[][]) => {
    if (updateFailure) throw updateFailure;
    const { rowStart } = parseRange(range);
    const row = values[0].map(String);
    writes.push({ kind: 'update', row: rowStart!, values: row });
    sheet.Sets[rowStart! - 2] = row;
  }),
  sheetsAppend: vi.fn(async (_range: string, values: (string | number)[][]) => {
    if (appendFailure) {
      const err = appendFailure;
      appendFailure = null;
      throw err;
    }
    for (const v of values) {
      const row = v.map(String);
      writes.push({ kind: 'append', values: row });
      sheet.Sets.push(row);
    }
  }),
  // A row delete shifts every row below it up by one, as Sheets does.
  sheetsDeleteRow: vi.fn(async (_sheetId: number, rowIndex: number) => {
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
const { readQueue, clearQueue, flushQueue } = await import('../../api/sync-queue');
const { fetchSets } = await import('../../api/workouts-api');

/** [exercise_id, name, section, order, set #, weight, reps] */
type Spec = [string, string, string, number, number, string, string];
const toRow = ([id, name, section, order, n, weight, reps]: Spec): Row =>
  ['w1', id, name, section, String(order), String(n), '8', weight, reps, ''];

const BENCH_ROW_CURL: Spec[] = [
  ['e_bench', 'Bench', 'primary', 1, 1, '', ''],
  ['e_row', 'Row', 'primary', 2, 1, '', ''],
  ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
];
const ROWBB_TWINS: Spec[] = [
  ['e_row', 'Row BB', 'primary', 1, 1, '95', '8'],
  ['e_row', 'Row BB', 'SS1', 2, 1, '', ''],
  ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
];

async function mount(specs: Spec[]) {
  sheet = { Sets: specs.map(toRow) };
  const all = await fetchSets('test-token');
  sets.value = all;
  activeWorkoutSets.value = all;
  return render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
}

const cards = () => [...document.querySelectorAll<HTMLElement>('.tracker-exercise-list > [data-row-key]')];
const setRows = (card: number) => [...cards()[card].querySelectorAll<HTMLElement>('.tracker-set')];
const weightInput = (card: number, set = 0) =>
  setRows(card)[set].querySelector<HTMLInputElement>('.set-weight-input')!;
const saved = (card: number, set = 0) =>
  setRows(card)[set].querySelector('.set-saved')!.getAttribute('aria-hidden') === 'false';
const type = (card: number, value: string, set = 0) =>
  fireEvent.input(weightInput(card, set), { target: { value } });
const moveUp = (card: number) =>
  fireEvent.click(cards()[card].querySelector<HTMLButtonElement>('[data-move="up"]')!);
/** [exercise_id, section, order, set #, weight] of a Sets row. */
const brief = (r: Row) => [r[1], r[3], Number(r[4]), Number(r[5]), r[7]];

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  updateFailure = null;
  appendFailure = null;
  clearQueue();
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

describe('#389 AC1: a save pending during a move lands once, on the moved row', () => {
  it('updates Row\'s own row with its new order, marks the moved card, and Finish does not save it again', async () => {
    await mount(BENCH_ROW_CURL);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    expect(cards()[0].textContent).toContain('Row');
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe('update');
    expect(writes[0].row).toBe(3);
    expect(brief(writes[0].values)).toEqual(['e_row', 'primary', 1, 1, '135']);
    expect(saved(0)).toBe(true); // Row, now first
    expect(saved(1)).toBe(true); // Bench untouched

    // Finish: the set is saved, so the unsaved-sets loop writes nothing.
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Finish')!);
    fireEvent.click(document.querySelector('[role="dialog"] button.btn-primary')!);
    await vi.advanceTimersByTimeAsync(200);
    expect(finishWorkout).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(sheet.Sets.filter((r) => r[1] === 'e_row')).toHaveLength(1);
  });
});

describe('#389 AC2: a duplicate\'s twin is never written or marked', () => {
  it('writes the SS1 copy\'s own row and leaves the primary copy alone', async () => {
    await mount(ROWBB_TWINS);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(writes[0].values)).toEqual(['e_row', 'SS1', 1, 1, '135']);
    expect(cards()[0].querySelector('.section-badge-btn')!.textContent).toBe('SS1');
    expect(saved(0)).toBe(true);
    // The primary copy keeps its row, values and saved state.
    expect(sheet.Sets[0]).toEqual(toRow(ROWBB_TWINS[0]));
    expect(saved(1)).toBe(true);
    expect(weightInput(1).value).toBe('95');

    // Its sheetRow is still its own: an edit to it writes row 2, not row 3.
    type(1, '100');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[1]).toMatchObject({ kind: 'update', row: 2 });
    expect(brief(writes[1].values)).toEqual(['e_row', 'primary', 2, 1, '100']);
  });
});

describe('#389 AC3: a set with no row yet is appended once and keeps that row', () => {
  it('Add set, type, move: one append with the current order, and the set holds that row', async () => {
    await mount(BENCH_ROW_CURL);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe('append');
    expect(brief(writes[0].values)).toEqual(['e_row', 'primary', 1, 2, '135']);
    expect(saved(0, 1)).toBe(true);

    type(0, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets).toHaveLength(4);
  });

  it('with a duplicate, the appended set is never given the twin\'s matching row', async () => {
    // The primary copy's set 2 sits at (e_row, order 1, set 2) in the sheet:
    // exactly the key the SS1 copy's new set 2 is appended under after its move.
    await mount([
      ['e_row', 'Row BB', 'primary', 1, 1, '95', '8'],
      ['e_row', 'Row BB', 'primary', 1, 2, '95', '8'],
      ['e_row', 'Row BB', 'SS1', 2, 1, '', ''],
    ]);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe('append');
    expect(brief(writes[0].values)).toEqual(['e_row', 'SS1', 1, 2, '135']);

    // A later edit of that set lands on the appended row (5), not the twin's (3).
    type(0, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets[1]).toEqual(toRow(['e_row', 'Row BB', 'primary', 1, 2, '95', '8']));
  });
});

describe('#389 AC4: saving a set after a move updates its own row', () => {
  it('no duplicate row when the edit comes after the move', async () => {
    await mount(BENCH_ROW_CURL);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(2000);
    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(writes[0].values)).toEqual(['e_row', 'primary', 1, 1, '135']);
    expect(sheet.Sets).toHaveLength(3);
  });

  it('the SS1 copy does not overwrite its primary twin', async () => {
    await mount(ROWBB_TWINS);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(2000);
    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(writes[0].values)).toEqual(['e_row', 'SS1', 1, 1, '135']);
    expect(sheet.Sets[0]).toEqual(toRow(ROWBB_TWINS[0]));
  });
});

describe('#389 AC5: what does not change', () => {
  it('a network failure queues the save for the row it was aimed at, with no row key', async () => {
    await mount(BENCH_ROW_CURL);
    updateFailure = new TypeError('Failed to fetch');
    type(1, '135');
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(1000);

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.sheetRow).toBe(3);
    expect(queue[0].payload.exercise_order).toBe(1);
    expect(Object.keys(queue[0].payload).some((k) => /rowkey/i.test(k))).toBe(false);
    expect(JSON.stringify(queue)).not.toMatch(/rowKey/i);
    expect(saved(0)).toBe(false);
  });

  it('no payload written to the sheet carries the row key', async () => {
    await mount(BENCH_ROW_CURL);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(300);
    moveUp(1);
    await vi.advanceTimersByTimeAsync(1000);
    for (const w of writes) expect(w.values).toHaveLength(10);
  });

  it('with no move: one save per burst of edits, after the 1 s debounce', async () => {
    await mount(BENCH_ROW_CURL);
    type(1, '1');
    await vi.advanceTimersByTimeAsync(400);
    type(1, '13');
    await vi.advanceTimersByTimeAsync(400);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(900);
    expect(writes).toHaveLength(0);
    expect(saved(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(writes[0].values)).toEqual(['e_row', 'primary', 2, 1, '135']);
    expect(saved(1)).toBe(true);
  });

  it('edit mode never auto-saves', async () => {
    isEditMode.value = true;
    await mount(BENCH_ROW_CURL);
    type(1, '135');
    moveUp(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(writes).toHaveLength(0);
  });
});

describe('#389 with #394: a save after a row delete writes the set\'s own, shifted row', () => {
  // Bench S1 (row 2), Bench S2 (3), Row S1 (4), Curl S1 50x10 (5). Deleting
  // Bench S2 shifts Row to 3 and Curl to 4; the tracker shifts its rows too.
  const SPECS: Spec[] = [
    ['e_bench', 'Bench', 'primary', 1, 1, '100', '5'],
    ['e_bench', 'Bench', 'primary', 1, 2, '100', '5'],
    ['e_row', 'Row', 'primary', 2, 1, '', ''],
    ['e_curl', 'Curl', 'burnout', 3, 1, '50', '10'],
  ];
  const CURL = toRow(SPECS[3]);
  const nonDeletes = () => writes.filter((w) => w.kind !== 'delete');
  const confirmYes = () => vi.spyOn(window, 'confirm').mockReturnValue(true);
  afterEach(() => vi.restoreAllMocks());

  it('Remove set, then edit a set below it: Row\'s own row is updated, Curl is untouched', async () => {
    await mount(SPECS);
    fireEvent.click(setRows(0)[1].querySelector('.set-remove-btn')!);
    await vi.advanceTimersByTimeAsync(0);
    expect(sheet.Sets).toHaveLength(3);

    type(1, '135');
    await vi.advanceTimersByTimeAsync(1000);
    expect(nonDeletes()).toHaveLength(1);
    expect(nonDeletes()[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(brief(nonDeletes()[0].values)).toEqual(['e_row', 'primary', 2, 1, '135']);
    expect(sheet.Sets[2]).toEqual(CURL);
    expect(saved(1)).toBe(true);
  });

  it('Remove exercise, then edit a set below it: only that set\'s row is written', async () => {
    confirmYes();
    await mount(SPECS);
    fireEvent.click(cards()[0].querySelector('.exercise-toolbar-remove')!);
    await vi.advanceTimersByTimeAsync(0);
    expect(sheet.Sets).toHaveLength(2);

    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);
    expect(nonDeletes()).toHaveLength(1);
    expect(nonDeletes()[0]).toMatchObject({ kind: 'update', row: 2 });
    expect(sheet.Sets[1]).toEqual(CURL);
  });

  it('an edit typed while the delete is pending lands after it, on the shifted row', async () => {
    await mount(SPECS);
    type(1, '135');
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.click(setRows(0)[1].querySelector('.set-remove-btn')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(nonDeletes()).toHaveLength(1);
    expect(nonDeletes()[0]).toMatchObject({ kind: 'update', row: 3 });
    expect(sheet.Sets.map(brief)).toEqual([
      ['e_bench', 'primary', 1, 1, '100'],
      ['e_row', 'primary', 2, 1, '135'],
      ['e_curl', 'burnout', 3, 1, '50'],
    ]);
  });

  it('same-section duplicates after Remove exercise above them: the edit never hits the other copy', async () => {
    // Curl added twice mid-workout: both copies are `primary`.
    confirmYes();
    await mount([
      ['e_bench', 'Bench', 'primary', 1, 1, '100', '5'],
      ['e_curl', 'Curl', 'primary', 2, 1, '', ''],
      ['e_curl', 'Curl', 'primary', 3, 1, '50', '10'],
    ]);
    fireEvent.click(cards()[0].querySelector('.exercise-toolbar-remove')!);
    await vi.advanceTimersByTimeAsync(0);
    expect(sheet.Sets).toHaveLength(2);

    type(0, '135');
    await vi.advanceTimersByTimeAsync(1000);
    expect(nonDeletes()).toHaveLength(1);
    expect(nonDeletes()[0]).toMatchObject({ kind: 'update', row: 2 });
    expect(sheet.Sets.map(brief)).toEqual([
      ['e_curl', 'primary', 2, 1, '135'],
      ['e_curl', 'primary', 3, 1, '50'],
    ]);
    expect(sheet.Sets[1]).toEqual(toRow(['e_curl', 'Curl', 'primary', 3, 1, '50', '10']));
    expect(saved(0)).toBe(true);
    expect(saved(1)).toBe(true);
  });

  it('duplicates in different sections, a delete above them, a move, then typing: the SS1 copy is untouched', async () => {
    confirmYes();
    await mount([
      ['e_bench', 'Bench', 'primary', 1, 1, '100', '5'],
      ['e_row', 'Row BB', 'primary', 2, 1, '', ''],
      ['e_row', 'Row BB', 'SS1', 3, 1, '95', '8'],
    ]);
    fireEvent.click(cards()[0].querySelector('.exercise-toolbar-remove')!);
    await vi.advanceTimersByTimeAsync(0);
    // Move the primary copy below the SS1 copy: it takes order 3.
    fireEvent.click(cards()[0].querySelector<HTMLButtonElement>('[data-move="down"]')!);
    expect(cards()[1].querySelector('.section-badge-btn')!.textContent).toBe('primary');

    type(1, '135');
    await vi.advanceTimersByTimeAsync(1000);
    expect(nonDeletes()).toHaveLength(1);
    expect(nonDeletes()[0]).toMatchObject({ kind: 'update', row: 2 });
    expect(brief(nonDeletes()[0].values)).toEqual(['e_row', 'primary', 3, 1, '135']);
    expect(sheet.Sets[1]).toEqual(toRow(['e_row', 'Row BB', 'SS1', 3, 1, '95', '8']));
    expect(saved(0)).toBe(true);
    expect(saved(1)).toBe(true);
  });

  it('a set above the deleted row still auto-saves to its own row', async () => {
    await mount(SPECS);
    fireEvent.click(setRows(0)[1].querySelector('.set-remove-btn')!);
    await vi.advanceTimersByTimeAsync(0);
    type(0, '110');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 2 });
    expect(saved(0)).toBe(true);
    expect(sheet.Sets[2]).toEqual(CURL);
  });
});

describe('#389: a set whose offline append the queue flushed is not appended again', () => {
  it('Add set, append fails, queue flushes, edit again: one row, updated in place', async () => {
    await mount(BENCH_ROW_CURL);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(readQueue()).toHaveLength(1);
    expect(sheet.Sets).toHaveLength(3);
    expect(saved(1, 1)).toBe(false);

    await flushQueue('test-token');
    expect(readQueue()).toHaveLength(0);
    expect(sheet.Sets).toHaveLength(4);

    type(1, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sheet.Sets).toHaveLength(4);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 2, 2, '140']);
    expect(saved(1, 1)).toBe(true);

    // And the set now holds that row: a further edit updates it again.
    type(1, '145', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sheet.Sets).toHaveLength(4);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
  });

  it('the same after a move: the flushed row (old order) is taken and given the new order', async () => {
    await mount(BENCH_ROW_CURL);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueue('test-token');
    moveUp(1);

    type(0, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sheet.Sets).toHaveLength(4);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 1, 2, '140']);
  });

  it('a quick-fill after the flush re-saves every set of the card without a second row', async () => {
    await mount(BENCH_ROW_CURL);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueue('test-token');

    fireEvent.input(cards()[1].querySelector('.quick-fill-row .set-reps-input')!, { target: { value: '8' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sheet.Sets.filter((r) => r[1] === 'e_row')).toHaveLength(2);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets[3][8]).toBe('8');
  });

  it('a duplicate\'s twin row is never taken, even when unclaimed rows exist for the same key', async () => {
    // Twin copies: the primary copy holds row 2 (e_row, order 1, set 1).
    await mount(ROWBB_TWINS);
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(1, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueue('test-token');

    type(1, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sheet.Sets).toHaveLength(4);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets[0]).toEqual(toRow(ROWBB_TWINS[0]));
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'SS1', 2, 2, '140']);
  });

  it('same-section copies: B never takes A\'s flushed row, and A takes it back on its next edit', async () => {
    // Row added twice mid-workout: both copies `primary`.
    await mount([
      ['e_row', 'Row', 'primary', 1, 1, '95', '8'],
      ['e_row', 'Row', 'primary', 2, 1, '90', '8'],
      ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
    ]);
    // A's new set 2: the append fails, and the queue flush lands it as row 5.
    fireEvent.click(cards()[0].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(0, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueue('test-token');
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 1, 2, '135']);

    // B adds the same set number and types 200: appended, A's row untouched.
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!);
    type(1, '200', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[writes.length - 1].kind).toBe('append');
    expect(sheet.Sets).toHaveLength(5);
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 1, 2, '135']);
    expect(brief(sheet.Sets[4])).toEqual(['e_row', 'primary', 2, 2, '200']);
    expect(saved(1, 1)).toBe(true);

    // A's next edit now takes its own flushed row: no third row, B untouched.
    type(0, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets).toHaveLength(5);
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 1, 2, '140']);
    expect(brief(sheet.Sets[4])).toEqual(['e_row', 'primary', 2, 2, '200']);
  });

  it('same-section copies: a blank added set on B does not stop A taking back its own flushed row', async () => {
    await mount([
      ['e_row', 'Row', 'primary', 1, 1, '95', '8'],
      ['e_row', 'Row', 'primary', 2, 1, '90', '8'],
      ['e_curl', 'Curl', 'burnout', 3, 1, '', ''],
    ]);
    fireEvent.click(cards()[0].querySelector('.add-set-btn')!);
    appendFailure = new TypeError('Failed to fetch');
    type(0, '135', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueue('test-token');
    fireEvent.click(cards()[1].querySelector('.add-set-btn')!); // B's set 2: blank, no row

    type(0, '140', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'update', row: 5 });
    expect(sheet.Sets).toHaveLength(4);
    expect(brief(sheet.Sets[3])).toEqual(['e_row', 'primary', 1, 2, '140']);
  });
});

