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
const writes: { kind: 'update' | 'append'; row?: number; values: Row }[] = [];

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
    for (const v of values) {
      const row = v.map(String);
      writes.push({ kind: 'append', values: row });
      sheet.Sets.push(row);
    }
  }),
  sheetsDeleteRow: vi.fn(),
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
const { readQueue, clearQueue } = await import('../../api/sync-queue');
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
