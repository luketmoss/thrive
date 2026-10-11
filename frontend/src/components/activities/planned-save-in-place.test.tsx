// #349 — the planned-workout editor saves in place: the same Workouts row and
// id, and the plan's Sets rows reconciled in one atomic batchUpdate. Drives
// the REAL WorkoutEdit, actions.ts and workouts-api.ts through a mocked
// `../../api/sheets` that keeps a two-tab sheet in memory, so every write is
// checked against what the sheet ends up holding.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import {
  workouts, sets, templates, toasts, activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode,
} from '../../state/store';
import type { WorkoutWithRow, SetWithRow, BuilderExercise, WorkoutSet } from '../../api/types';

const WORKOUTS_SHEET_ID = 1;
const SETS_SHEET_ID = 2;

type Tab = 'Workouts' | 'Sets';
let sheet: Record<Tab, string[][]>;
let failBatch = false;
let failWorkoutsPut: Error | null = null;
let demoMode = false;

const colIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  return {
    tab: tab as Tab,
    colStart: colIndex(m[1]),
    colEnd: colIndex(m[3]),
    rowStart: m[2] ? Number(m[2]) : null,
    rowEnd: m[4] ? Number(m[4]) : null,
  };
}

/** What Sheets reads back: every value as text. */
const asRead = (row: unknown[]) => row.map((v) => (v === '' || v == null ? '' : String(v)));

function decodeCells(row: { values: any[] }): string[] {
  return row.values.map((c) => {
    const v = c.userEnteredValue;
    if (!v) return '';
    if ('numberValue' in v) return String(v.numberValue);
    return String(v.stringValue);
  });
}

vi.mock('../../api/sheets', () => {
  class SheetsApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(`Sheets API ${status}: ${message}`);
      this.status = status;
    }
  }
  return {
    SheetsApiError,
    isMissingTabError: () => false,
    withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<any>) => fn(token)),
    sheetsGet: vi.fn(async (range: string) => {
      const { tab, colStart, colEnd, rowStart, rowEnd } = parseRange(range);
      const rows = sheet[tab];
      const out: string[][] = [];
      for (let r = rowStart ?? 2; r <= (rowEnd ?? rows.length + 1); r++) {
        if (rows[r - 2]) out.push(rows[r - 2].slice(colStart, colEnd + 1));
      }
      return out;
    }),
    sheetsUpdate: vi.fn(async (range: string, values: any[][]) => {
      const { tab, colStart, rowStart } = parseRange(range);
      if (tab === 'Workouts' && failWorkoutsPut) throw failWorkoutsPut;
      const row = sheet[tab][(rowStart as number) - 2];
      asRead(values[0]).forEach((v, i) => { row[colStart + i] = v; });
    }),
    sheetsAppend: vi.fn(async (range: string, values: any[][]) => {
      const tab = range.split('!')[0] as Tab;
      for (const row of values) sheet[tab].push(asRead(row));
    }),
    sheetsDeleteRow: vi.fn(async (sheetId: number, rowIndex: number) => {
      sheet[sheetId === WORKOUTS_SHEET_ID ? 'Workouts' : 'Sets'].splice(rowIndex - 2, 1);
    }),
    // All or nothing, in order — as Sheets applies a batchUpdate.
    sheetsBatchUpdate: vi.fn(async (requests: any[]) => {
      if (failBatch) throw new SheetsApiError(500, 'backend error');
      const next = { Workouts: sheet.Workouts.map((r) => [...r]), Sets: sheet.Sets.map((r) => [...r]) };
      const tabOf = (id: number): Tab => (id === WORKOUTS_SHEET_ID ? 'Workouts' : 'Sets');
      for (const r of requests) {
        if (r.updateCells) {
          const { sheetId, rowIndex, columnIndex } = r.updateCells.start;
          expect(columnIndex).toBe(0);
          next[tabOf(sheetId)][rowIndex - 1] = decodeCells(r.updateCells.rows[0]);
        } else if (r.deleteDimension) {
          const { sheetId, startIndex, endIndex } = r.deleteDimension.range;
          next[tabOf(sheetId)].splice(startIndex - 1, endIndex - startIndex);
        } else if (r.appendCells) {
          for (const row of r.appendCells.rows) next[tabOf(r.appendCells.sheetId)].push(decodeCells(row));
        } else {
          throw new Error(`Unexpected request ${JSON.stringify(r)}`);
        }
      }
      sheet = next;
    }),
    getSheetId: vi.fn(async (name: string) => (name === 'Workouts' ? WORKOUTS_SHEET_ID : SETS_SHEET_ID)),
  };
});

vi.mock('../../api/demo-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/demo-data')>()),
  isDemo: () => demoMode,
}));
vi.mock('../../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
const navigate = vi.fn();
const goBack = vi.fn();
vi.mock('../../router/router', () => ({
  navigate: (p: string) => navigate(p),
  goBack: (p?: string) => goBack(p),
}));

const sheets = await import('../../api/sheets');
const { ReauthFailedError } = await import('../../auth/reauth');
const { savePlannedWorkoutEdits, startPlannedWorkout } = await import('../../state/actions');
const { WorkoutEdit } = await import('./workout-edit');

const TOKEN = 'test-token';

// ── Fixtures ────────────────────────────────────────────────────────

/** w_X, everything the planner does not edit filled in, so a loss shows. */
function planRow(): string[] {
  return [
    'w_X', '2099-12-30', '06:45', 'weight', 'Legs A', 'tpl_legs', 'Bring the belt', '', '2026-09-01T10:00:00.000Z',
    'w_src', 'planned',
    '', '', '', '', '', '',
    // R-Z, AA, AB: never edited here; nonsense values on purpose, to prove they are passed through.
    'gym', 'coros', '123', 'raw/1', 'fit/1', 'x', 'y', 'z', '400',
    '2830', '402',
  ];
}

function otherRow(id: string): string[] {
  return [id, '2099-12-01', '07:00', 'weight', `Other ${id}`, '', '', '', '', '', 'planned',
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
}

function setRow(
  w: string, ex: string, section: string, order: number, n: number, reps: string, weight = '', done = '', effort = '',
): string[] {
  return [w, ex, ex.toUpperCase(), section, String(order), String(n), reps, weight, done, effort];
}

/** Legs A as an agent scheduled it, interleaved with another plan's rows. */
function scheduledSets(): string[][] {
  return [
    setRow('w_other', 'ex_a', 'primary', 1, 1, '10'),
    setRow('w_X', 'ex_squat', 'warmup', 1, 1, ''),
    setRow('w_X', 'ex_squat', 'primary', 2, 1, '5', '95'),
    setRow('w_X', 'ex_squat', 'primary', 2, 2, '5', '115'),
    setRow('w_other', 'ex_a', 'primary', 1, 2, '10', '50'),
    setRow('w_X', 'ex_squat', 'primary', 2, 3, '5', '135', '5', 'Hard'),
    setRow('w_X', 'ex_pushup', 'SS1', 3, 1, '12', '0'),
    setRow('w_X', 'ex_pushup', 'SS1', 3, 2, '12', '0'),
    setRow('w_other', 'ex_b', 'primary', 2, 1, '8'),
  ];
}

const SQUAT_WARM: BuilderExercise = { exercise_id: 'ex_squat', exercise_name: 'EX_SQUAT', section: 'warmup', sets: 1, planned_reps: '' };
const SQUAT: BuilderExercise = { exercise_id: 'ex_squat', exercise_name: 'EX_SQUAT', section: 'primary', sets: 3, planned_reps: '5' };
const PUSHUP: BuilderExercise = { exercise_id: 'ex_pushup', exercise_name: 'EX_PUSHUP', section: 'SS1', sets: 2, planned_reps: '12' };
const SAME = [SQUAT_WARM, SQUAT, PUSHUP];

function toWorkouts(): WorkoutWithRow[] {
  return sheet.Workouts.map((r, i) => ({
    id: r[0], date: r[1], time: r[2], type: r[3] as any, name: r[4], template_id: r[5], notes: r[6],
    elapsed_seconds: r[7], created: r[8], copied_from: r[9], status: r[10], moving_seconds: r[11],
    effort: r[12] as any, distance_m: r[13], ascent_m: r[14], descent_m: r[15], avg_hr: r[16],
    sub_type: r[17], source: r[18], source_activity_id: r[19], raw_ref: r[20], fit_ref: r[21],
    fit_fetched_at: r[22], synced_at: r[23], started_at_utc: r[24], calories: r[25],
    estimated_seconds: r[26], sport_type: r[27], sheetRow: i + 2,
  }));
}

function toSets(): SetWithRow[] {
  return sheet.Sets.map((r, i) => ({
    workout_id: r[0], exercise_id: r[1], exercise_name: r[2], section: r[3],
    exercise_order: Number(r[4]), set_number: Number(r[5]), planned_reps: r[6],
    weight: r[7], reps: r[8], effort: r[9] as any, sheetRow: i + 2,
  }));
}

const rowsOf = (w: string) => sheet.Sets.filter((r) => r[0] === w);
const batchCalls = () => vi.mocked(sheets.sheetsBatchUpdate).mock.calls;
const lastToast = () => toasts.value[toasts.value.length - 1];

function load() {
  workouts.value = toWorkouts();
  sets.value = toSets();
}

beforeEach(() => {
  vi.clearAllMocks();
  failBatch = false;
  failWorkoutsPut = null;
  demoMode = false;
  sheet = { Workouts: [otherRow('w_other'), planRow()], Sets: scheduledSets() };
  load();
  templates.value = [];
  toasts.value = [];
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
  isEditMode.value = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── AC1 through the real editor ─────────────────────────────────────

function button(text: string): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`No button "${text}"`);
  return el as HTMLButtonElement;
}
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const type = (id: string, value: string) => fireEvent.input(input(id), { target: { value } });

async function saveFromEditor(edit: () => void = () => {}) {
  render(<WorkoutEdit workoutId="w_X" />);
  edit();
  fireEvent.click(button('Save Workout'));
  await waitFor(() => expect(goBack.mock.calls.length + toasts.value.length).toBeGreaterThan(0));
  await waitFor(() => expect(button('Save Workout').disabled).toBe(false));
}

describe('AC1: Save keeps the workout\'s identity and every column it does not edit', () => {
  it('patches the one row in place: a single PUT, only the name changed', async () => {
    const before = planRow();
    await saveFromEditor(() => type('planner-name', 'Legs B'));

    const puts = vi.mocked(sheets.sheetsUpdate).mock.calls.filter(([r]) => r.startsWith('Workouts'));
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe('Workouts!A3:AB3');
    expect(puts[0][1]).toEqual([before.map((v, i) => (i === 4 ? 'Legs B' : v))]);

    expect(vi.mocked(sheets.sheetsAppend)).not.toHaveBeenCalled();
    expect(vi.mocked(sheets.sheetsDeleteRow)).not.toHaveBeenCalled();
    expect(batchCalls()).toHaveLength(0); // the sets did not change
    expect(sheet.Workouts).toEqual([otherRow('w_other'), before.map((v, i) => (i === 4 ? 'Legs B' : v))]);
    expect(workouts.value.filter((w) => w.id === 'w_X')).toHaveLength(1);
    expect(workouts.value.map((w) => w.id)).toEqual(['w_other', 'w_X']);
    expect(lastToast()).toMatchObject({ text: 'Workout updated', type: 'success' });
  });

  it.each([
    ['created', 8, '2026-09-01T10:00:00.000Z'],
    ['time', 2, '06:45'],
    ['template_id', 5, 'tpl_legs'],
    ['copied_from', 9, 'w_src'],
    ['notes', 6, 'Bring the belt'],
    ['estimated_seconds (untouched, off-minute)', 26, '2830'],
    ['date (untouched)', 1, '2099-12-30'],
    ['status', 10, 'planned'],
    ['sport_type', 27, '402'],
  ])('keeps %s', async (_f, col, value) => {
    await saveFromEditor(() => type('planner-name', 'Legs B'));
    const row = sheet.Workouts.find((r) => r[0] === 'w_X')!;
    expect(row[col]).toBe(value);
  });

  // The patch object itself is asserted in planned-estimate.test.tsx.
  it('a name-only edit changes the name cell and nothing else', async () => {
    await saveFromEditor(() => type('planner-name', 'Legs B'));
    const row = sheet.Workouts.find((r) => r[0] === 'w_X')!;
    expect(row.filter((v, i) => v !== planRow()[i])).toEqual(['Legs B']);
  });

  it('writes a changed date and estimate as typed; a cleared estimate blank, never 0', async () => {
    await saveFromEditor(() => {
      type('planner-date', '2099-12-29');
      type('planner-estimate', '50');
    });
    let row = sheet.Workouts.find((r) => r[0] === 'w_X')!;
    expect(row[1]).toBe('2099-12-29');
    expect(row[26]).toBe('3000');

    cleanup();
    load();
    await saveFromEditor(() => type('planner-estimate', ''));
    row = sheet.Workouts.find((r) => r[0] === 'w_X')!;
    expect(row[26]).toBe('');
  });
});

// ── AC2 through the action ──────────────────────────────────────────

describe('AC2: sets are reconciled in place, in one atomic write', () => {
  it('unchanged exercises make no Sets write', async () => {
    await savePlannedWorkoutEdits('w_X', {}, SAME, TOKEN);
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(scheduledSets());
  });

  it('removing an exercise: one batchUpdate, other workouts\' rows byte-identical', async () => {
    const others = () => sheet.Sets.filter((r) => r[0] !== 'w_X');
    const before = others();
    await savePlannedWorkoutEdits('w_X', {}, [SQUAT_WARM, SQUAT], TOKEN);
    expect(batchCalls()).toHaveLength(1);
    expect(others()).toEqual(before);
    expect(rowsOf('w_X')).toEqual([
      setRow('w_X', 'ex_squat', 'warmup', 1, 1, ''),
      setRow('w_X', 'ex_squat', 'primary', 2, 1, '5', '95'),
      setRow('w_X', 'ex_squat', 'primary', 2, 2, '5', '115'),
      setRow('w_X', 'ex_squat', 'primary', 2, 3, '5', '135', '5', 'Hard'),
    ]);
    expect(sets.value).toEqual(toSets()); // refetched
  });

  it('a grown plan deletes no row and shifts nobody: other rows stay at their row numbers', async () => {
    const ROW = { exercise_id: 'ex_row', exercise_name: 'EX_ROW', section: 'primary', sets: 2, planned_reps: '6' };
    const before = sheet.Sets.map((r) => [...r]);
    await savePlannedWorkoutEdits('w_X', {}, [...SAME, ROW], TOKEN);
    const reqs = batchCalls()[0][0] as any[];
    expect(reqs.some((r) => r.deleteDimension)).toBe(false);
    expect(sheet.Sets.slice(0, before.length)).toEqual(before);
    expect(sheet.Sets.slice(before.length)).toEqual([
      setRow('w_X', 'ex_row', 'primary', 4, 1, '6'),
      setRow('w_X', 'ex_row', 'primary', 4, 2, '6'),
    ]);
  });

  it('reads this workout\'s rows fresh, never from the cached sheetRows', async () => {
    // The cache is stale: a row above was deleted elsewhere since it loaded.
    sheet.Sets.shift();
    await savePlannedWorkoutEdits('w_X', {}, [SQUAT_WARM, SQUAT], TOKEN);
    expect(sheet.Sets.filter((r) => r[0] === 'w_other')).toEqual([
      setRow('w_other', 'ex_a', 'primary', 1, 2, '10', '50'),
      setRow('w_other', 'ex_b', 'primary', 2, 1, '8'),
    ]);
    expect(rowsOf('w_X')).toHaveLength(4);
  });

  // #118's cases, ported from saveWorkoutForLater to the in-place save.
  it('keeps every prescribed weight when the structure is unchanged', async () => {
    await savePlannedWorkoutEdits('w_X', { name: 'Renamed' }, SAME, TOKEN);
    expect(rowsOf('w_X').map((r) => r[7])).toEqual(['', '95', '115', '135', '0', '0']);
  });

  it('keeps loads on surviving sets and leaves an added set blank', async () => {
    await savePlannedWorkoutEdits('w_X', {}, [{ ...SQUAT, sets: 4 }], TOKEN);
    expect(rowsOf('w_X').map((r) => [r[5], r[7]])).toEqual([['1', '95'], ['2', '115'], ['3', '135'], ['4', '']]);
  });

  it('a newly added exercise has blank weights', async () => {
    const ROW = { exercise_id: 'ex_row', exercise_name: 'EX_ROW', section: 'primary', sets: 3, planned_reps: '6' };
    await savePlannedWorkoutEdits('w_X', {}, [ROW], TOKEN);
    expect(rowsOf('w_X').map((r) => r[7])).toEqual(['', '', '']);
  });

  it('carries reps and effort with the weight when an exercise moves', async () => {
    await savePlannedWorkoutEdits('w_X', {}, [PUSHUP, SQUAT, SQUAT_WARM], TOKEN);
    expect(rowsOf('w_X')).toEqual([
      setRow('w_X', 'ex_pushup', 'SS1', 1, 1, '12', '0'),
      setRow('w_X', 'ex_pushup', 'SS1', 1, 2, '12', '0'),
      setRow('w_X', 'ex_squat', 'primary', 2, 1, '5', '95'),
      setRow('w_X', 'ex_squat', 'primary', 2, 2, '5', '115'),
      setRow('w_X', 'ex_squat', 'primary', 2, 3, '5', '135', '5', 'Hard'),
      setRow('w_X', 'ex_squat', 'warmup', 3, 1, ''),
    ]);
  });
});

// ── AC3 ─────────────────────────────────────────────────────────────

describe('AC3: a failure never loses or duplicates the plan', () => {
  it('a row mismatch writes nothing to Sets and says out of sync', async () => {
    workouts.value = workouts.value.map((w) => (w.id === 'w_X' ? { ...w, sheetRow: 2 } : w));
    await expect(savePlannedWorkoutEdits('w_X', { name: 'B' }, [SQUAT], TOKEN)).rejects.toThrow();
    expect(batchCalls()).toHaveLength(0);
    expect(vi.mocked(sheets.sheetsGet).mock.calls.some(([r]) => r.startsWith('Sets'))).toBe(false);
    expect(sheet.Sets).toEqual(scheduledSets());
    expect(lastToast()).toMatchObject({ type: 'error' });
    expect(lastToast().text).toMatch(/out of sync/i);
  });

  it('any other patch failure writes nothing to Sets: "Failed to save changes"', async () => {
    failWorkoutsPut = new (sheets.SheetsApiError as any)(409, 'conflict');
    await expect(savePlannedWorkoutEdits('w_X', { name: 'B' }, [SQUAT], TOKEN)).rejects.toThrow();
    expect(batchCalls()).toHaveLength(0);
    expect(lastToast().text).toBe('Failed to save changes');
  });

  it('a re-auth failure propagates with no toast', async () => {
    vi.mocked(sheets.sheetsGet).mockRejectedValueOnce(new ReauthFailedError());
    await expect(savePlannedWorkoutEdits('w_X', { name: 'B' }, [SQUAT], TOKEN)).rejects.toBeInstanceOf(ReauthFailedError);
    expect(toasts.value).toEqual([]);
  });

  it('a failed Sets write leaves Sets exactly as before; a retry writes the rows once', async () => {
    failBatch = true;
    await expect(savePlannedWorkoutEdits('w_X', { name: 'B' }, [SQUAT, { ...PUSHUP, sets: 3 }], TOKEN)).rejects.toThrow();
    expect(sheet.Sets).toEqual(scheduledSets());
    expect(lastToast().text).toBe("Couldn't save the exercises. Try again.");
    expect(sheet.Workouts[1][4]).toBe('B'); // the patch landed; only the exercises did not

    failBatch = false;
    await savePlannedWorkoutEdits('w_X', {}, [SQUAT, { ...PUSHUP, sets: 3 }], TOKEN);
    expect(rowsOf('w_X')).toEqual([
      setRow('w_X', 'ex_squat', 'primary', 1, 1, '5', '95'),
      setRow('w_X', 'ex_squat', 'primary', 1, 2, '5', '115'),
      setRow('w_X', 'ex_squat', 'primary', 1, 3, '5', '135', '5', 'Hard'),
      setRow('w_X', 'ex_pushup', 'SS1', 2, 1, '12', '0'),
      setRow('w_X', 'ex_pushup', 'SS1', 2, 2, '12', '0'),
      setRow('w_X', 'ex_pushup', 'SS1', 2, 3, '12'),
    ]);
    expect(sheet.Workouts.filter((r) => r[0] === 'w_X')).toHaveLength(1);
    expect(sheet.Workouts).toHaveLength(2);
  });

  it('the editor stays put with Save enabled when the Sets write fails', async () => {
    failBatch = true;
    render(<WorkoutEdit workoutId="w_X" />);
    type('planner-name', 'Legs B');
    // Remove the push-ups, so the sets change.
    const removes = Array.from(document.querySelectorAll('button')).filter((b) => /remove/i.test(b.getAttribute('aria-label') || ''));
    fireEvent.click(removes[removes.length - 1]);
    fireEvent.click(button('Save Workout'));
    await waitFor(() => expect(lastToast()?.text).toBe("Couldn't save the exercises. Try again."));
    await waitFor(() => expect(button('Save Workout').disabled).toBe(false));
    expect(goBack).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(input('planner-name').value).toBe('Legs B');
  });
});

// ── AC4 ─────────────────────────────────────────────────────────────

describe('AC4: Save returns to where the user came from', () => {
  it('calls goBack(\'/activities\') once, never navigate', async () => {
    await saveFromEditor(() => type('planner-name', 'Legs B'));
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledWith('/activities');
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ── AC5 ─────────────────────────────────────────────────────────────

describe('AC5: active-workout state and template warmups are left alone', () => {
  it('saving a plan leaves the active workout\'s signals identical', async () => {
    const tracked: SetWithRow[] = toSets().filter((s) => s.workout_id === 'w_other');
    const warm = [{ exercise_id: 'ex_w', exercise_name: 'W', exercise_order: 1 }];
    activeWorkoutId.value = 'w_other';
    activeWorkoutSets.value = tracked;
    activeWarmupExercises.value = warm;
    isEditMode.value = true;

    await savePlannedWorkoutEdits('w_X', { name: 'B' }, [SQUAT, PUSHUP], TOKEN);

    expect(activeWorkoutId.value).toBe('w_other');
    expect(activeWorkoutSets.value).toBe(tracked);
    expect(activeWarmupExercises.value).toBe(warm);
    expect(isEditMode.value).toBe(true);
  });

  it('with no active workout, saving starts none', async () => {
    await savePlannedWorkoutEdits('w_X', {}, [SQUAT], TOKEN);
    expect(activeWorkoutId.value).toBeNull();
    expect(activeWorkoutSets.value).toEqual([]);
    expect(activeWarmupExercises.value).toEqual([]);
    expect(isEditMode.value).toBe(false);
  });

  const LEGS = {
    id: 'tpl_legs', name: 'Legs A',
    exercises: [
      { template_id: 'tpl_legs', template_name: 'Legs A', order: 1, exercise_id: 'ex_squat', exercise_name: 'EX_SQUAT', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
      { template_id: 'tpl_legs', template_name: 'Legs A', order: 2, exercise_id: 'ex_squat', exercise_name: 'EX_SQUAT', section: 'primary', sets: '3', reps: '5', sheetRow: 3 },
    ],
  };

  it('a template plan whose warmup moved from order 1 to 3 gets no warmup restored', async () => {
    templates.value = [LEGS as any];
    await savePlannedWorkoutEdits('w_X', {}, [SQUAT, PUSHUP, SQUAT_WARM], TOKEN);
    expect(workouts.value.find((w) => w.id === 'w_X')!.template_id).toBe('tpl_legs');

    await startPlannedWorkout('w_X', TOKEN);
    expect(activeWarmupExercises.value).toEqual([]);
    expect(activeWorkoutSets.value.filter((s) => s.section === 'warmup').map((s) => s.exercise_order)).toEqual([3]);
  });

  it('a legacy template plan with no warmup rows still has them restored', async () => {
    templates.value = [LEGS as any];
    sheet.Sets = sheet.Sets.filter((r) => !(r[0] === 'w_X' && r[3] === 'warmup'));
    load();
    await startPlannedWorkout('w_X', TOKEN);
    expect(activeWarmupExercises.value).toEqual([{ exercise_id: 'ex_squat', exercise_name: 'EX_SQUAT', exercise_order: 1 }]);
  });
});

// ── AC6 ─────────────────────────────────────────────────────────────

describe('AC6: demo mode', () => {
  it('updates the store in place, same id, the AC2 rows, and fetches nothing', async () => {
    demoMode = true;
    const otherSets = sets.value.filter((s) => s.workout_id !== 'w_X');
    await savePlannedWorkoutEdits('w_X', { name: 'Demo B' }, [{ ...SQUAT, sets: 4 }], TOKEN);

    for (const f of [sheets.sheetsGet, sheets.sheetsUpdate, sheets.sheetsAppend, sheets.sheetsBatchUpdate, sheets.getSheetId]) {
      expect(vi.mocked(f)).not.toHaveBeenCalled();
    }
    expect(workouts.value.filter((w) => w.id === 'w_X').map((w) => w.name)).toEqual(['Demo B']);
    expect(sets.value.filter((s) => s.workout_id !== 'w_X')).toEqual(otherSets);
    const mine: WorkoutSet[] = sets.value.filter((s) => s.workout_id === 'w_X');
    expect(mine.map((s) => [s.exercise_order, s.set_number, s.weight])).toEqual([[1, 1, '95'], [1, 2, '115'], [1, 3, '135'], [1, 4, '']]);
    expect(new Set(sets.value.map((s) => s.sheetRow)).size).toBe(sets.value.length);
    expect(lastToast().text).toBe('Workout updated');
  });
});

/** Bench 10/8/6 at 135/155/175, push-ups, then Bench again in the same section 12/12 at 95/95. */
function variedSets(): string[][] {
  return [
    setRow('w_other', 'ex_a', 'primary', 1, 1, '10'),
    setRow('w_X', 'ex_squat', 'warmup', 1, 1, ''),
    setRow('w_X', 'ex_bench', 'primary', 2, 1, '10', '135'),
    setRow('w_X', 'ex_bench', 'primary', 2, 2, '8', '155'),
    setRow('w_X', 'ex_bench', 'primary', 2, 3, '6', '175', '6', 'Hard'),
    setRow('w_X', 'ex_pushup', 'SS1', 3, 1, '12', '0'),
    setRow('w_X', 'ex_pushup', 'SS1', 3, 2, '12', '0'),
    // Its own weights (#380): each entry carries the values of the rows it
    // was built from, never the first same-section Bench's.
    setRow('w_X', 'ex_bench', 'primary', 4, 1, '12', '95'),
    setRow('w_X', 'ex_bench', 'primary', 4, 2, '12', '95', '12', 'Easy'),
  ];
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.compact-card-body'));
/** Expands entry `i` and returns its [sets, reps] inputs. */
function open(i: number): [HTMLInputElement, HTMLInputElement] {
  fireEvent.click(cards()[i]);
  const inputs = document.querySelectorAll<HTMLInputElement>('.template-exercise-config input[type="number"]');
  return [inputs[0], inputs[1]];
}
const setValue = (el: HTMLInputElement, value: string) => fireEvent.input(el, { target: { value } });
const pill = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.section-picker-row button')).find((b) => b.textContent === text)!;

// ── #350, as #375 keeps it: per-set planned reps survive an edit ──
//
// #350 pinned "an exercise whose Reps is left alone keeps its stored per-set
// values" through a comparison against the pre-filled Reps. #375 replaced
// that with a row per set holding the stored text, so the guarantee is now
// #375's AC2: every set is written as its row holds it, and a row nobody
// touched holds (and writes) its stored text verbatim.

/** The expanded entry's per-set inputs, in set order. */
const rowInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('.planner-set-row input'));

describe('#350 / #375 AC2: each set is saved as its row holds it', () => {
  beforeEach(() => {
    sheet.Sets = variedSets();
    load();
  });

  /** [exercise, section, order, set, planned_reps, weight] of w_X's rows. */
  const shape = () => rowsOf('w_X').map((r) => [r[1], r[3], r[4], r[5], r[6], r[7]]);
  const benchReps = (order: string) => rowsOf('w_X').filter((r) => r[1] === 'ex_bench' && r[4] === order).map((r) => r[6]);

  it('#375 AC1: shows each stored value in its own row; "Reps, all sets" is blank', () => {
    render(<WorkoutEdit workoutId="w_X" />);
    const [setsInput, all] = open(1);
    expect(setsInput.value).toBe('3');
    expect(all.value).toBe('');
    expect(all.placeholder).toBe('Varies');
    expect(rowInputs().map((el) => el.value)).toEqual(['10', '8', '6']);
  });

  it('a name-only edit writes no Sets rows at all', async () => {
    await saveFromEditor(() => type('planner-name', 'Push B'));
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(variedSets());
  });

  it('opening and saving with nothing changed writes no Sets rows', async () => {
    await saveFromEditor();
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(variedSets());
  });

  it('expanding the varied entry and saving untouched writes no Sets rows', async () => {
    await saveFromEditor(() => open(1));
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(variedSets());
  });

  it('another exercise\'s reps changed: Bench keeps 10 / 8 / 6', async () => {
    await saveFromEditor(() => setValue(open(2)[1], '15'));
    expect(batchCalls()).toHaveLength(1);
    expect(benchReps('2')).toEqual(['10', '8', '6']);
    expect(rowsOf('w_X').filter((r) => r[1] === 'ex_pushup').map((r) => r[6])).toEqual(['15', '15']);
    expect(benchReps('4')).toEqual(['12', '12']);
  });

  it('removing another exercise: Bench keeps 10 / 8 / 6, weights carried', async () => {
    await saveFromEditor(() => fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Remove EX_PUSHUP"]')[0]));
    expect(shape()).toEqual([
      ['ex_squat', 'warmup', '1', '1', '', ''],
      ['ex_bench', 'primary', '2', '1', '10', '135'],
      ['ex_bench', 'primary', '2', '2', '8', '155'],
      ['ex_bench', 'primary', '2', '3', '6', '175'],
      ['ex_bench', 'primary', '3', '1', '12', '95'],
      ['ex_bench', 'primary', '3', '2', '12', '95'],
    ]);
  });

  it('#375 AC2: one set changed: only that set changes', async () => {
    await saveFromEditor(() => {
      open(1);
      setValue(rowInputs()[1], '9');
    });
    expect(benchReps('2')).toEqual(['10', '9', '6']);
    expect(benchReps('4')).toEqual(['12', '12']);
  });

  it('#375 AC2: set 1\'s own value typed into "Reps, all sets" flattens the plan', async () => {
    await saveFromEditor(() => setValue(open(1)[1], '10'));
    expect(benchReps('2')).toEqual(['10', '10', '10']);
  });

  it('a changed "Reps, all sets" value applies to every set', async () => {
    await saveFromEditor(() => setValue(open(1)[1], '12'));
    expect(benchReps('2')).toEqual(['12', '12', '12']);
  });

  it('a cleared "Reps, all sets" value blanks every set', async () => {
    await saveFromEditor(() => setValue(open(1)[1], ''));
    expect(benchReps('2')).toEqual(['', '', '']);
  });

  it('#375 AC3: Sets 3 → 4: 10, 8, 6, then a fourth set pre-filled from the row above', async () => {
    await saveFromEditor(() => setValue(open(1)[0], '4'));
    expect(benchReps('2')).toEqual(['10', '8', '6', '6']);
  });

  it('Sets 3 → 2: 10, 8', async () => {
    await saveFromEditor(() => setValue(open(1)[0], '2'));
    expect(benchReps('2')).toEqual(['10', '8']);
  });

  it('#375 AC3: Sets cleared and retyped as 3 loses nothing, and writes nothing', async () => {
    await saveFromEditor(() => {
      const [setsInput] = open(1);
      setValue(setsInput, '');
      setValue(setsInput, '3');
    });
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(variedSets());
  });

  it('moving the second Bench up keeps each entry\'s own reps', async () => {
    await saveFromEditor(() => {
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH up"]')[1]);
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH up"]')[1]);
    });
    // Bench (12/12) now sits ahead of Bench (10/8/6).
    expect(shape().map((r) => [r[0], r[2], r[4]])).toEqual([
      ['ex_squat', '1', ''],
      ['ex_bench', '2', '12'],
      ['ex_bench', '2', '12'],
      ['ex_bench', '3', '10'],
      ['ex_bench', '3', '8'],
      ['ex_bench', '3', '6'],
      ['ex_pushup', '4', '12'],
      ['ex_pushup', '4', '12'],
    ]);
  });

  it('moving the first Bench down keeps each entry\'s own reps', async () => {
    await saveFromEditor(() => {
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH down"]')[0]);
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH down"]')[0]);
    });
    expect(benchReps('3')).toEqual(['12', '12']);
    expect(benchReps('4')).toEqual(['10', '8', '6']);
  });

  it('changing either entry\'s section never flattens or swaps its reps', async () => {
    await saveFromEditor(() => {
      open(3);
      fireEvent.click(pill('SS2'));
      fireEvent.click(cards()[3]); // collapse
      open(1);
      fireEvent.click(pill('SS2'));
    });
    expect(shape().map((r) => [r[0], r[1], r[2], r[4]])).toEqual([
      ['ex_squat', 'warmup', '1', ''],
      ['ex_bench', 'SS2', '2', '10'],
      ['ex_bench', 'SS2', '2', '8'],
      ['ex_bench', 'SS2', '2', '6'],
      ['ex_pushup', 'SS1', '3', '12'],
      ['ex_pushup', 'SS1', '3', '12'],
      ['ex_bench', 'SS2', '4', '12'],
      ['ex_bench', 'SS2', '4', '12'],
    ]);
  });

  it('the warmup stays one row with blank planned reps', async () => {
    await saveFromEditor(() => setValue(open(2)[1], '15'));
    expect(rowsOf('w_X').filter((r) => r[3] === 'warmup')).toEqual([setRow('w_X', 'ex_squat', 'warmup', 1, 1, '')]);
  });
});

describe('#375 AC2: stored text the input cannot display is written back verbatim', () => {
  /** Bench planned as ranges (#376's case): 4-6, 4-6, 6-8. */
  beforeEach(() => {
    sheet.Sets = variedSets().map((r) =>
      (r[0] === 'w_X' && r[1] === 'ex_bench' && r[4] === '2' ? [...r.slice(0, 6), r[5] === '3' ? '6-8' : '4-6', ...r.slice(7)] : r));
    load();
  });
  const benchReps = () => rowsOf('w_X').filter((r) => r[1] === 'ex_bench' && r[4] === '2').map((r) => r[6]);

  it('another exercise changed: the ranges are rewritten exactly as stored', async () => {
    await saveFromEditor(() => setValue(open(2)[1], '15'));
    expect(batchCalls()).toHaveLength(1);
    expect(benchReps()).toEqual(['4-6', '4-6', '6-8']);
  });

  it('one set changed beside ranges: only that set changes', async () => {
    await saveFromEditor(() => {
      open(1);
      setValue(rowInputs()[1], '5');
    });
    expect(benchReps()).toEqual(['4-6', '5', '6-8']);
  });

  it('a set added after a range is pre-filled with that range\'s text', async () => {
    await saveFromEditor(() => setValue(open(1)[0], '4'));
    expect(benchReps()).toEqual(['4-6', '4-6', '6-8', '6-8']);
  });
});

// ── The editor's entries as the builder's ───────────────────────────

describe('#375: plannerToBuilderExercises', () => {
  const BENCH = { exercise_id: 'ex_bench', exercise_name: 'Bench', section: 'primary', sets: '3', reps_by_set: ['10', '8', '6'] };

  it('sends every set\'s held value, verbatim, ranges included', async () => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    expect(plannerToBuilderExercises([BENCH])).toEqual([
      { exercise_id: 'ex_bench', exercise_name: 'Bench', section: 'primary', sets: 3, planned_reps: '10', planned_reps_by_set: ['10', '8', '6'] },
    ]);
    expect(plannerToBuilderExercises([{ ...BENCH, reps_by_set: ['4-6', ' 8 ', ''] }])[0].planned_reps_by_set).toEqual(['4-6', ' 8 ', '']);
  });

  it('sends only the first n of a longer, remembered list', async () => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const [b] = plannerToBuilderExercises([{ ...BENCH, sets: '2' }]);
    expect(b.sets).toBe(2);
    expect(b.planned_reps_by_set).toEqual(['10', '8']);
  });

  it.each([
    ['', 1], ['0', 1], ['-2', 1], ['abc', 1], ['2.7', 2], ['20', 20], ['25', 20],
  ])('Sets %j saves %i sets, each with a value', async (typed, n) => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const [b] = plannerToBuilderExercises([{ ...BENCH, sets: typed }]);
    expect(b.sets).toBe(n);
    expect(b.planned_reps_by_set).toHaveLength(n);
  });

  it('a newly added exercise\'s one value fills every set', async () => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const added = { exercise_id: 'ex_row', exercise_name: 'Row', section: 'primary', sets: '3', reps_by_set: ['8'] };
    const [b] = plannerToBuilderExercises([added]);
    expect(b).toEqual({ exercise_id: 'ex_row', exercise_name: 'Row', section: 'primary', sets: 3, planned_reps: '8', planned_reps_by_set: ['8', '8', '8'] });
    await savePlannedWorkoutEdits('w_X', {}, [b], TOKEN);
    expect(rowsOf('w_X').map((r) => r[6])).toEqual(['8', '8', '8']);
  });

  it('a warmup carries no list: it saves one blank row', async () => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const [b] = plannerToBuilderExercises([{ ...BENCH, section: 'warmup' }]);
    expect(b).not.toHaveProperty('planned_reps_by_set');
  });

  it('a uniform plan saves exactly as today', async () => {
    await saveFromEditor(() => type('planner-name', 'Legs B'));
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(scheduledSets());
  });
});

// ── #380: each entry carries its own stored weight / reps / effort ──

describe('#380: a duplicate exercise keeps its own values through the real editor', () => {
  beforeEach(() => {
    sheet.Sets = variedSets();
    load();
  });

  /** [order, set, weight, reps, effort] of w_X's Bench rows, at one stored order or all. */
  const bench = (order?: string) =>
    rowsOf('w_X')
      .filter((r) => r[1] === 'ex_bench' && (order === undefined || r[4] === order))
      .map((r) => [r[4], r[5], r[7], r[8], r[9]]);
  const values = (rows: string[][]) => rows.map((r) => r.slice(2));
  /** The first Bench's stored [weight, reps, effort] per set, and the second's. */
  const FIRST = [['135', '', ''], ['155', '', ''], ['175', '6', 'Hard']];
  const SECOND = [['95', '', ''], ['95', '12', 'Easy']];
  const firstSetsInput = () => document.querySelector<HTMLInputElement>('.template-exercise-config input[type="number"]')!;

  it('AC1: a name-only save keeps both entries\' values and makes no Sets write', async () => {
    await saveFromEditor(() => type('planner-name', 'Push B'));
    expect(batchCalls()).toHaveLength(0);
    expect(sheet.Sets).toEqual(variedSets());
  });

  it('AC1: another exercise changed: the second Bench keeps 95 / 95, not 135 / 155', async () => {
    await saveFromEditor(() => setValue(open(2)[1], '15'));
    expect(batchCalls()).toHaveLength(1);
    expect(values(bench('2'))).toEqual(FIRST);
    expect(values(bench('4'))).toEqual(SECOND);
  });

  it('AC1: removing another exercise shifts the second Bench up with its own values', async () => {
    await saveFromEditor(() => fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Remove EX_PUSHUP"]')[0]));
    expect(values(bench('2'))).toEqual(FIRST);
    expect(values(bench('3'))).toEqual(SECOND);
  });

  it('AC2: moving the second Bench up: each entry keeps its values', async () => {
    await saveFromEditor(() => {
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH up"]')[1]);
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH up"]')[1]);
    });
    expect(values(bench('2'))).toEqual(SECOND);
    expect(values(bench('3'))).toEqual(FIRST);
  });

  it('AC2: moving the first Bench down: each entry keeps its values', async () => {
    await saveFromEditor(() => {
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH down"]')[0]);
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH down"]')[0]);
    });
    expect(values(bench('3'))).toEqual(SECOND);
    expect(values(bench('4'))).toEqual(FIRST);
  });

  it('AC2: changing the second Bench\'s section keeps its values', async () => {
    await saveFromEditor(() => {
      open(3);
      fireEvent.click(pill('SS2'));
    });
    expect(rowsOf('w_X').filter((r) => r[4] === '4').map((r) => [r[3], r[7], r[8], r[9]]))
      .toEqual([['SS2', '95', '', ''], ['SS2', '95', '12', 'Easy']]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC2: the second Bench changed to warmup keeps its set 1 values on its one row', async () => {
    await saveFromEditor(() => {
      open(3);
      fireEvent.click(pill('warmup'));
    });
    expect(rowsOf('w_X').filter((r) => r[4] === '4').map((r) => [r[3], r[5], r[7], r[8], r[9]]))
      .toEqual([['warmup', '1', '95', '', '']]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC2: a warmup changed to another section keeps set 1; a further set is blank', async () => {
    sheet.Sets = sheet.Sets.map((r) =>
      (r[0] === 'w_X' && r[3] === 'warmup' ? setRow('w_X', 'ex_squat', 'warmup', 1, 1, '', '45', '10', 'Easy') : r));
    load();
    await saveFromEditor(() => {
      open(0);
      fireEvent.click(pill('primary'));
      setValue(firstSetsInput(), '2');
    });
    expect(rowsOf('w_X').filter((r) => r[1] === 'ex_squat').map((r) => [r[3], r[5], r[7], r[8], r[9]]))
      .toEqual([['primary', '1', '45', '10', 'Easy'], ['primary', '2', '', '', '']]);
  });

  it('AC3: the second Bench 2 → 3 sets: 95 / 95 then a blank set 3; the first unaffected', async () => {
    await saveFromEditor(() => setValue(open(3)[0], '3'));
    expect(values(bench('4'))).toEqual([...SECOND, ['', '', '']]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC3: the second Bench 2 → 1 set: 95 only; the first unaffected', async () => {
    await saveFromEditor(() => setValue(open(3)[0], '1'));
    expect(values(bench('4'))).toEqual([SECOND[0]]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC4: a weight changed elsewhere after open is saved from the fresh read, not the editor', async () => {
    await saveFromEditor(() => {
      // Meanwhile (e.g. thrive_update_sets): the second Bench's set 1 becomes 100.
      sheet.Sets = sheet.Sets.map((r) =>
        (r[0] === 'w_X' && r[1] === 'ex_bench' && r[4] === '4' && r[5] === '1' ? setRow('w_X', 'ex_bench', 'primary', 4, 1, '12', '100') : r));
      setValue(open(2)[1], '15'); // a change elsewhere, so Sets is written
    });
    expect(values(bench('4'))).toEqual([['100', '', ''], SECOND[1]]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC4: an entry whose source rows are missing from the fresh read is saved blank', async () => {
    await saveFromEditor(() => {
      // Restructured on another device: the second Bench's rows are gone.
      sheet.Sets = sheet.Sets.filter((r) => !(r[0] === 'w_X' && r[1] === 'ex_bench' && r[4] === '4'));
    });
    expect(values(bench('4'))).toEqual([['', '', ''], ['', '', '']]);
    expect(values(bench('2'))).toEqual(FIRST);
  });

  it('AC5: a newly added Bench primary still borrows the stored Bench primary by key', async () => {
    const added: BuilderExercise = { exercise_id: 'ex_bench', exercise_name: 'EX_BENCH', section: 'primary', sets: 2, planned_reps: '10' };
    await savePlannedWorkoutEdits('w_X', {}, [added], TOKEN);
    expect(values(bench())).toEqual(FIRST.slice(0, 2));
  });

  it('AC5: demo mode carries by entry too, and puts no source_order in the store', async () => {
    demoMode = true;
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const plan = plannerToBuilderExercises([
      { exercise_id: 'ex_bench', exercise_name: 'EX_BENCH', section: 'primary', sets: '2', reps_by_set: ['12', '12'], source_order: 4 },
      { exercise_id: 'ex_bench', exercise_name: 'EX_BENCH', section: 'primary', sets: '3', reps_by_set: ['10', '8', '6'], source_order: 2 },
    ]);
    await savePlannedWorkoutEdits('w_X', {}, plan, TOKEN);
    const mine = sets.value.filter((s) => s.workout_id === 'w_X');
    expect(mine.map((s) => [s.exercise_order, s.set_number, s.weight, s.reps, s.effort])).toEqual([
      [1, 1, '95', '', ''], [1, 2, '95', '12', 'Easy'],
      [2, 1, '135', '', ''], [2, 2, '155', '', ''], [2, 3, '175', '6', 'Hard'],
    ]);
    expect(mine.every((s) => !('source_order' in s))).toBe(true);
  });

  it('nothing writes source_order to Sets: every row stays ten columns', async () => {
    await saveFromEditor(() => {
      fireEvent.click(document.querySelectorAll<HTMLButtonElement>('[aria-label="Move EX_BENCH up"]')[1]);
      setValue(open(2)[0], '3');
    });
    expect(batchCalls()).toHaveLength(1);
    expect(sheet.Sets.every((r) => r.length === 10)).toBe(true);
  });
});

describe('#380: plannerToBuilderExercises passes source_order through', () => {
  it('copies it when present, warmups included, and adds nothing when absent', async () => {
    const { plannerToBuilderExercises } = await import('./workout-edit');
    const warm = { exercise_id: 'ex_squat', exercise_name: 'Squat', section: 'warmup', sets: '', reps_by_set: [] };
    expect(plannerToBuilderExercises([{ ...warm, source_order: 3 }])[0].source_order).toBe(3);
    expect(plannerToBuilderExercises([warm])[0]).not.toHaveProperty('source_order');
  });
});
