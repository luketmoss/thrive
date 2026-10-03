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
