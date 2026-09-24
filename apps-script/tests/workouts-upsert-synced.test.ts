// #166 — upsertSyncedWorkout: a synced activity found by vendor ID, never
// duplicated, and merged three ways so edits made in Thrive survive a re-sync.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type CellValue } from './apps-script-sandbox';

const NOW = new Date('2026-09-24T17:41:10Z');
const T1 = '2026-09-24T17:41:10.000Z';
const T2 = '2026-09-25T15:17:02.000Z';
const ID = '471166302945817201';

const ORDER = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes',
  'elapsed_seconds', 'created', 'copied_from', 'status',
  'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
];
const C = Object.fromEntries(ORDER.map((f, i) => [f, i])) as Record<string, number>;

/** The gravel fixture, normalized the way sync/ sends it. */
const RIDE = {
  date: '2026-09-24', time: '11:02', type: 'bike', sub_type: 'gravel', name: 'Gravel Bike',
  elapsed_seconds: '378', moving_seconds: '378', distance_m: '520', ascent_m: '3', descent_m: '',
  avg_hr: '84', calories: '17', started_at_utc: '2026-09-24T11:02:17-06:00',
};

function upsert(
  rows: CellValue[][],
  body: Record<string, unknown>,
  { key, uuids = ['a1b2c3d4e5f6'] }: { key?: string; uuids?: string[] } = {},
) {
  const api = loadApi(rows, { now: NOW, uuids });
  const res = callDoGet<any>(api.sandbox, {
    action: 'upsertSyncedWorkout',
    payload: JSON.stringify({
      source: 'coros', source_activity_id: ID, incoming: RIDE, last_written: null,
      raw_ref: 'drive-file-1', synced_at: T1, ...body,
    }),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res };
}

/** A row as the sheet displays it: what a later call reads back. */
const display = (row: CellValue[]) => row.map((v) => (v instanceof Date ? v.toISOString() : String(v ?? '')));

/** A synced row already in the sheet, as a previous run left it. */
const syncedRow = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_ride0001', ...RIDE, source: 'coros', source_activity_id: ID,
  raw_ref: 'drive-file-1', synced_at: T1, created: T1, ...over,
});

describe('AC3: no row with that vendor ID appends one, like createWorkout', () => {
  it('writes a w_ id, created, the sync-owned fields and the incoming fields', () => {
    const { res, rows } = upsert([], {});
    expect(res.success, res.error).toBe(true);
    expect(res.data.status).toBe('created');
    expect(res.data.id).toBe('w_a1b2c3d4');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toHaveLength(26);
    expect(r[C.id]).toBe('w_a1b2c3d4');
    expect(r[C.created]).toBe(NOW.toISOString());
    expect(r[C.source]).toBe('coros');
    expect(r[C.source_activity_id]).toBe(ID);
    expect(r[C.raw_ref]).toBe('drive-file-1');
    expect(r[C.synced_at]).toBe(T1);
    for (const [f, v] of Object.entries(RIDE)) expect(r[C[f]], f).toBe(v);
  });

  it('stores every value as literal text: no date, time or number is parsed', () => {
    const { rows } = upsert([], {});
    expect(typeof rows[0][C.date]).toBe('string');
    expect(typeof rows[0][C.time]).toBe('string');
    expect(typeof rows[0][C.distance_m]).toBe('string');
  });

  it('leaves blank what it was not sent, never 0, and never sets the user\'s fields', () => {
    const { rows } = upsert([], {});
    const r = rows[0];
    for (const f of ['descent_m', 'effort', 'notes', 'status', 'template_id', 'copied_from', 'fit_ref', 'fit_fetched_at']) {
      expect(r[C[f]], f).toBe('');
    }
  });

  it('refuses a field the sync may not set, and writes nothing', () => {
    for (const f of ['effort', 'notes', 'status', 'template_id', 'fit_ref', 'fit_fetched_at']) {
      const { res, rows } = upsert([], { incoming: { ...RIDE, [f]: 'Hard' } });
      expect(res.success, f).toBe(false);
      expect(res.error).toMatch(new RegExp(`"${f}" is not a synced field`));
      expect(rows).toHaveLength(0);
    }
  });

  it('refuses a non-integer measure or an unknown sub_type rather than landing it', () => {
    expect(upsert([], { incoming: { ...RIDE, distance_m: '0.52 km' } }).res.error).toMatch(/distance_m must be a whole number/);
    expect(upsert([], { incoming: { ...RIDE, sub_type: 'from-track' } }).res.error).toMatch(/Invalid incoming.sub_type/);
    expect(upsert([], { incoming: { ...RIDE, started_at_utc: '2026-09-24 11:02' } }).res.error).toMatch(/ISO 8601/);
  });
});

describe('AC3: one matching row is updated, two are refused', () => {
  it('updates the one row with that (source, source_activity_id), leaving other rows alone', () => {
    const manual = workoutRow({ id: 'w_manual01', type: 'bike', name: 'Gravel Bike', date: '2026-09-24' });
    const otherVendor = syncedRow({ id: 'w_garmin01', source: 'garmin_import' });
    const { res, rows } = upsert(
      [manual, otherVendor, syncedRow()],
      { last_written: RIDE, incoming: { ...RIDE, avg_hr: '85' }, synced_at: T2 },
    );
    expect(res.data).toMatchObject({ status: 'updated', id: 'w_ride0001', sheetRow: 4 });
    expect(rows).toHaveLength(3);
    expect(rows[2][C.avg_hr]).toBe('85');
    expect(rows[0]).toEqual(manual);
    expect(rows[1]).toEqual(otherVendor);
  });

  it('refuses two rows with the same vendor ID, naming both, and writes nothing', () => {
    const a = syncedRow({ id: 'w_dupe0001' });
    const b = syncedRow({ id: 'w_dupe0002' });
    const before = JSON.stringify([a, b]);
    const { res, rows } = upsert([a, b], { last_written: RIDE });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/w_dupe0001/);
    expect(res.error).toMatch(/w_dupe0002/);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('re-reads the row and refuses to write if it no longer holds that activity', () => {
    const api = loadApi([syncedRow()], { now: NOW });
    const scan = api.sandbox.getAllRows;
    // Another execution inserts a row above between the scan and the write.
    api.sandbox.getAllRows = (sheet: any) => {
      const out = scan(sheet);
      api.rows.unshift(workoutRow({ id: 'w_other001' }));
      return out;
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'upsertSyncedWorkout',
      payload: JSON.stringify({
        source: 'coros', source_activity_id: ID, incoming: RIDE, last_written: RIDE,
        raw_ref: 'drive-file-1', synced_at: T2,
      }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sheet changed during the write/);
    expect(api.rows[0][C.id]).toBe('w_other001');
    expect(api.rows[0][C.source]).toBe('');
  });

  it('twice over the same payload: one row, identical apart from synced_at', () => {
    const first = upsert([], {});
    const once = display(first.rows[0]);
    const second = upsert(first.rows.map((r) => display(r)), {
      last_written: first.res.data.written, synced_at: T2,
    });
    expect(second.res.data.status).toBe('updated');
    expect(second.rows).toHaveLength(1);
    const twice = display(second.rows[0]);
    for (let i = 0; i < 26; i++) {
      if (i === C.synced_at) continue;
      expect(twice[i], ORDER[i]).toBe(once[i]);
    }
    expect(twice[C.synced_at]).toBe(T2);
  });

  it('accepts only the API key', () => {
    const { res, rows } = upsert([], {}, { key: 'wrong' });
    expect(res).toEqual({ success: false, error: 'Invalid or missing API key' });
    expect(rows).toHaveLength(0);
  });
});

describe('AC4: the three-way merge keeps edits made in Thrive', () => {
  it('a renamed ride with a changed sub_type keeps both when the distance changes', () => {
    // The user renamed the ride and called it mountain, in Thrive.
    const edited = syncedRow({ name: 'Evening loop', sub_type: 'mountain', effort: 'Hard', notes: 'muddy' });
    const { res, rows } = upsert([edited], {
      last_written: RIDE,
      incoming: { ...RIDE, distance_m: '640' },
      raw_ref: 'drive-file-2',
      synced_at: T2,
    });
    expect(res.success, res.error).toBe(true);
    const r = rows[0];
    expect(r[C.name]).toBe('Evening loop');
    expect(r[C.sub_type]).toBe('mountain');
    expect(r[C.distance_m]).toBe('640');
    // The user's own fields are untouched; the sync-owned ones always move.
    expect(r[C.effort]).toBe('Hard');
    expect(r[C.notes]).toBe('muddy');
    expect(r[C.raw_ref]).toBe('drive-file-2');
    expect(r[C.synced_at]).toBe(T2);
    // `written` is what the sheet now holds: the sync's next last_written.
    expect(res.data.written).toMatchObject({ name: 'Evening loop', sub_type: 'mountain', distance_m: '640' });
    expect(res.data.written.edited).toEqual(['sub_type', 'name']);
    expect(res.data.kept.sort()).toEqual(['name', 'sub_type']);
  });

  // `written` records the sheet's values, so on its own an edited field would
  // look untouched on the run after and be overwritten a run late.
  it('an edited field stays edited on every later run', () => {
    const edited = syncedRow({ name: 'Evening loop' });
    const first = upsert([edited], { last_written: RIDE, synced_at: T2 });
    const again = upsert(first.rows.map(display), {
      last_written: first.res.data.written, incoming: { ...RIDE, name: 'Gravel Bike 2' }, synced_at: T2,
    });
    expect(again.rows[0][C.name]).toBe('Evening loop');
    expect(again.res.data.written.edited).toEqual(['name']);
    const third = upsert(again.rows.map(display), {
      last_written: again.res.data.written, incoming: { ...RIDE, name: 'Gravel Bike 3' }, synced_at: T2,
    });
    expect(third.rows[0][C.name]).toBe('Evening loop');
  });

  it('refuses an edited list naming a field that is not synced', () => {
    const { res } = upsert([syncedRow()], { last_written: { ...RIDE, edited: ['notes'] } });
    expect(res.error).toMatch(/"notes" is not a synced field/);
  });

  it('with last_written null and a row present, fills blanks only', () => {
    const partial = syncedRow({ name: 'Evening loop', distance_m: '', avg_hr: '90' });
    const { res, rows } = upsert([partial], {
      last_written: null, incoming: { ...RIDE, distance_m: '640', avg_hr: '84' }, synced_at: T2,
    });
    expect(res.data.status).toBe('updated');
    expect(rows[0][C.distance_m]).toBe('640');  // was blank: filled
    expect(rows[0][C.avg_hr]).toBe('90');       // non-blank: kept
    expect(rows[0][C.name]).toBe('Evening loop');
    expect(rows[0][C.synced_at]).toBe(T2);
    // Neither overwritten value is known to be COROS's, so both stay kept.
    expect(res.data.written.edited).toEqual(['name', 'avg_hr']);
  });

  it('with last_written set and no row, the user deleted it: not recreated', () => {
    const manual = workoutRow({ id: 'w_manual01' });
    const { res, rows } = upsert([manual], { last_written: RIDE });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe('deleted');
    expect(rows).toEqual([manual]);
  });

  it('writes a blank incoming value over an untouched one, and never writes 0 for it', () => {
    const { rows } = upsert([syncedRow()], {
      last_written: RIDE, incoming: { ...RIDE, avg_hr: '' }, synced_at: T2,
    });
    expect(rows[0][C.avg_hr]).toBe('');
  });
});
