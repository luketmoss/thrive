// Issue #172: saving an edit writes only what the user changed.
//
// These drive the real forms, actions.ts and workouts-api.ts against an
// in-memory `Workouts` tab behind a mocked `../../api/sheets`, so the tests
// see exactly the row a save would leave in the sheet.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { workouts, sets, isEditMode, activeWorkoutId, activeWorkoutSets, activeWarmupExercises } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';

let sheet: { Workouts: string[][]; Sets: string[][] };

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  return {
    tab: tab as 'Workouts' | 'Sets',
    colStart: m[1].charCodeAt(0) - 65,
    colEnd: m[3].charCodeAt(0) - 65,
    rowStart: m[2] ? Number(m[2]) : null,
    rowEnd: m[4] ? Number(m[4]) : null,
  };
}

const sheetsGet = vi.fn(async (range: string) => {
  const { tab, colStart, colEnd, rowStart, rowEnd } = parseRange(range);
  const rows = sheet[tab];
  const out: string[][] = [];
  for (let r = rowStart ?? 2; r <= (rowEnd ?? rows.length + 1); r++) {
    if (rows[r - 2]) out.push(rows[r - 2].slice(colStart, colEnd + 1));
  }
  return out;
});
const sheetsUpdate = vi.fn(async (range: string, values: string[][]) => {
  const { tab, colStart, rowStart } = parseRange(range);
  const row = sheet[tab][(rowStart as number) - 2];
  values[0].forEach((v, i) => { row[colStart + i] = String(v); });
});

vi.mock('../../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: async (token: string, fn: (t: string) => Promise<unknown>) => fn(token),
  sheetsGet: (range: string) => sheetsGet(range),
  sheetsUpdate: (range: string, values: string[][]) => sheetsUpdate(range, values),
  sheetsAppend: vi.fn(),
  sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(async () => 1),
}));
vi.mock('../../api/demo-data', () => ({ isDemo: () => false, DEMO_WORKOUTS: [], DEMO_SETS: [] }));
vi.mock('../../api/exercises-api', () => ({
  fetchExercises: vi.fn(), createExercise: vi.fn(), updateExercise: vi.fn(), deleteExercise: vi.fn(),
}));
vi.mock('../../api/templates-api', () => ({
  fetchTemplateRows: vi.fn(), groupTemplateRows: vi.fn(), createTemplate: vi.fn(),
  updateTemplate: vi.fn(), deleteTemplate: vi.fn(), updateExerciseNameInTemplates: vi.fn(),
}));
vi.mock('../../api/labels-api', () => ({
  fetchLabels: vi.fn(), createLabel: vi.fn(), updateLabel: vi.fn(), deleteLabel: vi.fn(), appendLabels: vi.fn(),
}));
vi.mock('../../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn() }));

const { EditWorkoutForm } = await import('./edit-workout-form');
const { WorkoutTracker } = await import('../workout/workout-tracker');
const { rowToWorkout, workoutToRow } = await import('../../api/workouts-api');
const { saveSimpleWorkoutEdits } = await import('../../state/actions');
const { navigate } = await import('../../router/router');

/** Clicks Save and waits for the save to finish, which ends in navigation. */
async function clickSave(view: ReturnType<typeof render>) {
  fireEvent.click(view.getAllByText('Save Changes')[0]);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
}

// A COROS hike as the sync writes it. Values are made up.
const SYNCED: WorkoutWithRow = {
  id: 'w_sync1', date: '2026-09-20', time: '07:05', type: 'hike', name: 'Ridge Loop',
  template_id: '', notes: 'Windy', elapsed_seconds: '343', created: '2026-09-20T12:00:00.000Z',
  copied_from: '', status: '', moving_seconds: '301', effort: '',
  distance_m: '430', ascent_m: '37', descent_m: '41', avg_hr: '128',
  sub_type: 'outdoor', source: 'coros', source_activity_id: 'act_0001',
  raw_ref: 'raw/act_0001.json', fit_ref: 'fit/act_0001.fit', fit_fetched_at: '2026-09-20T13:00:00Z',
  synced_at: '2026-09-20T13:00:00Z', started_at_utc: '2026-09-20T14:05:00Z', calories: '212',
  sheetRow: 2,
};

// A hand-logged strength session that #155's enrichment has filled and linked.
const ENRICHED: WorkoutWithRow = {
  id: 'w_lift1', date: '2026-09-21', time: '06:30', type: 'weight', name: 'Upper Push A',
  template_id: '', notes: 'Solid', elapsed_seconds: '343', created: '2026-09-21T11:30:00.000Z',
  copied_from: '', status: '', moving_seconds: '290', effort: 'Medium',
  distance_m: '', ascent_m: '', descent_m: '', avg_hr: '112',
  sub_type: '', source: '', source_activity_id: 'act_0002', raw_ref: 'raw/act_0002.json',
  fit_ref: '', fit_fetched_at: '', synced_at: '2026-09-21T13:00:00Z', started_at_utc: '', calories: '180',
  sheetRow: 3,
};

const row = (sheetRow: number) => rowToWorkout(sheet.Workouts[sheetRow - 2], sheetRow);

beforeEach(() => {
  sheet = { Workouts: [SYNCED, ENRICHED].map((w) => workoutToRow(w).map(String)), Sets: [] };
  workouts.value = [{ ...SYNCED }, { ...ENRICHED }];
  sets.value = [];
  sheetsGet.mockClear();
  sheetsUpdate.mockClear();
  vi.mocked(navigate).mockClear();
});

afterEach(() => {
  cleanup();
  isEditMode.value = false;
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
});

function renderEdit(id = SYNCED.id) {
  const view = render(h(EditWorkoutForm, { workoutId: id }));
  const field = (label: string) => view.getByLabelText(label) as HTMLInputElement;
  const type = (label: string, value: string) => fireEvent.input(field(label), { target: { value } });
  return { ...view, field, type, save: () => clickSave(view) };
}

describe('AC1: an untouched measure keeps its exact stored value', () => {
  it('an effort-only save leaves 343 s and 430 m, and every other column, as they were', async () => {
    const f = renderEdit();
    expect(f.field('Duration (minutes)').value).toBe('6');
    expect(f.field('Distance (miles)').value).toBe('0.3');

    fireEvent.click(f.getByLabelText('Session effort: Hard'));
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, effort: 'Hard' });
  });

  it('a notes-only save does not touch the measures either', async () => {
    const f = renderEdit();
    f.type('Notes', 'Windy, then sun');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, notes: 'Windy, then sun' });
  });

  it('a field changed and changed back counts as untouched', async () => {
    const f = renderEdit();
    f.type('Duration (minutes)', '7');
    f.type('Duration (minutes)', '6');
    f.type('Distance (miles)', '1');
    f.type('Distance (miles)', '0.3');
    f.type('Notes', 'Calm');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, notes: 'Calm' });
  });
});

describe('AC2: a real edit still saves, through the conversion boundary', () => {
  it('Duration 6 → 7 stores 420 s, and nothing else moves', async () => {
    const f = renderEdit();
    f.type('Duration (minutes)', '7');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, elapsed_seconds: '420' });
  });

  it('Distance 0.5 mi stores 805 m, leaving the untouched measures exact', async () => {
    const f = renderEdit();
    f.type('Distance (miles)', '0.5');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, distance_m: '805' });
  });
});

describe('AC3: clearing a measure blanks it, never zeroes it', () => {
  it('a cleared Duration stores blank', async () => {
    const f = renderEdit();
    f.type('Duration (minutes)', '');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, elapsed_seconds: '' });
  });

  it('a cleared Distance stores blank', async () => {
    const f = renderEdit();
    f.type('Distance (miles)', '');
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, distance_m: '' });
  });
});

describe('AC4: the strength edit mode behaves the same', () => {
  function renderTracker() {
    isEditMode.value = true;
    activeWorkoutId.value = ENRICHED.id;
    const view = render(h(WorkoutTracker, { workoutId: ENRICHED.id, workoutName: ENRICHED.name }));
    return { ...view, save: () => clickSave(view) };
  }

  it('a notes-and-effort save keeps 343 s and every enriched column', async () => {
    const t = renderTracker();
    expect((t.getByLabelText('Duration (minutes)') as HTMLInputElement).value).toBe('6');

    fireEvent.input(t.getByLabelText('Notes'), { target: { value: 'Solid, shoulder ok' } });
    fireEvent.click(t.getByLabelText('Session effort: Hard'));
    await t.save();

    expect(row(3)).toEqual({ ...ENRICHED, notes: 'Solid, shoulder ok', effort: 'Hard' });
  });

  it('a real duration edit in the strength form still saves', async () => {
    const t = renderTracker();
    fireEvent.input(t.getByLabelText('Duration (minutes)'), { target: { value: '50' } });
    await t.save();

    expect(row(3)).toEqual({ ...ENRICHED, elapsed_seconds: '3000' });
  });
});

describe('AC5: a save never reverts or blanks a column it did not change', () => {
  it('a copy loaded before enrichment does not wipe what enrichment wrote', async () => {
    // The app loaded the row before the sync ran: no enrichment, no link.
    workouts.value = [{ ...SYNCED }, {
      ...ENRICHED, moving_seconds: '', avg_hr: '', calories: '',
      source_activity_id: '', raw_ref: '', synced_at: '',
    }];

    await saveSimpleWorkoutEdits(ENRICHED.id, { notes: 'Late note' }, 'test-token');

    expect(row(3)).toEqual({ ...ENRICHED, notes: 'Late note' });
    // And the app now holds the row as written, not its stale copy.
    expect(workouts.value.find((w) => w.id === ENRICHED.id)).toEqual({ ...ENRICHED, notes: 'Late note' });
  });

  it('a copy loaded before the FIT fetch does not revert fit_ref on a synced row', async () => {
    workouts.value = [{ ...SYNCED, fit_ref: '', fit_fetched_at: '' }, { ...ENRICHED }];

    const f = renderEdit();
    fireEvent.click(f.getByLabelText('Session effort: Easy'));
    await f.save();

    expect(row(2)).toEqual({ ...SYNCED, effort: 'Easy' });
  });

  it('a save that changed nothing writes nothing', async () => {
    const f = renderEdit();
    await f.save();

    expect(sheetsUpdate).not.toHaveBeenCalled();
    expect(row(2)).toEqual(SYNCED);
  });

  it('still refuses a row whose id no longer matches (#95)', async () => {
    sheet.Workouts[0][0] = 'w_other';
    const before = sheet.Workouts.map((r) => [...r]);

    await expect(saveSimpleWorkoutEdits(SYNCED.id, { notes: 'x' }, 'test-token')).rejects.toThrow(/could not be verified/);
    expect(sheet.Workouts).toEqual(before);
  });
});

describe('AC6: the edit forms label their text inputs', () => {
  it('the simple edit form ties Name, Date, Duration and Notes to their labels', () => {
    const f = renderEdit();
    expect(f.field('Name').value).toBe('Ridge Loop');
    expect(f.field('Date').value).toBe('2026-09-20');
    expect(f.field('Duration (minutes)').value).toBe('6');
    expect(f.field('Notes').value).toBe('Windy');
  });

  it('the strength edit mode does too, with ids that cannot collide with the other form', () => {
    isEditMode.value = true;
    activeWorkoutId.value = ENRICHED.id;
    const t = render(h(WorkoutTracker, { workoutId: ENRICHED.id, workoutName: ENRICHED.name }));
    const ids = ['Name', 'Date', 'Duration (minutes)', 'Notes'].map((l) => (t.getByLabelText(l) as HTMLElement).id);
    expect(ids).toEqual(['tracker-edit-name', 'tracker-edit-date', 'tracker-edit-duration', 'tracker-edit-notes']);
  });
});
