// #130 AC2 — reads return the full A:AA shape (A:Z, plus #145's AA), with unset meaning '' and a
// pre-#128 row reading identically to one written after it.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type ApiWorkout } from './apps-script-sandbox';

const SYNC_FIELDS = [
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
];

const ACTIVITY_FIELDS = [
  'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
];

/** Exactly what the Sheets API hands back for a row written before #128: it
 *  truncates at the last non-empty cell, so the row is 17 long, not 27. */
const PRE_128_ROW = [
  'w_old', '2026-03-15', '07:00', 'weight', 'Upper Push A', 'tpl_001',
  'Felt strong', '3720', '2026-03-15T07:00:00.000Z', '', '',
  '', 'Hard', '', '', '', '',
];

describe('AC2: the full 27-column shape', () => {
  it('returns all 27 columns', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    for (const f of sandbox.WORKOUT_FIELDS) {
      expect(w, f).toHaveProperty(f);
    }
    expect(sandbox.WORKOUT_FIELDS).toHaveLength(27);
  });

  it('carries the sheet row so a caller can write back without re-scanning', () => {
    const { sandbox } = loadApi([workoutRow({ id: 'a' }), workoutRow({ id: 'b' })]);
    const rows = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    expect(rows.map((w) => w.sheetRow)).toEqual([2, 3]);
  });

  it('reads every column into the field it belongs to', () => {
    const { sandbox } = loadApi([workoutRow({
      id: 'w_1', elapsed_seconds: '3720', effort: 'Hard', distance_m: '19956',
      sub_type: 'gravel', source: 'coros', started_at_utc: '2026-09-15T07:00:00-06:00',
      calories: '612',
    })]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    expect(w.id).toBe('w_1');
    expect(w.elapsed_seconds).toBe('3720');
    expect(w.effort).toBe('Hard');
    expect(w.distance_m).toBe('19956');
    expect(w.sub_type).toBe('gravel');
    expect(w.source).toBe('coros');
    expect(w.started_at_utc).toBe('2026-09-15T07:00:00-06:00');
    expect(w.calories).toBe('612');
  });
});

describe('AC2: unset is empty, never zero', () => {
  it('reads an unset column as an empty string', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    for (const f of [...ACTIVITY_FIELDS, ...SYNC_FIELDS]) {
      expect(w[f], f).toBe('');
    }
  });

  it('never reads an unset column as 0, null or undefined', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    for (const f of [...ACTIVITY_FIELDS, ...SYNC_FIELDS]) {
      expect(w[f], f).not.toBe(0);
      expect(w[f], f).not.toBeNull();
      expect(w[f], f).not.toBeUndefined();
    }
  });

  // The distinction the activity columns exist to preserve.
  it('keeps a deliberate zero distinct from unset', () => {
    const { sandbox } = loadApi([workoutRow({ ascent_m: 0, distance_m: '' })]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    expect(w.ascent_m).toBe('0');
    expect(w.distance_m).toBe('');
  });

  it('never renders a missing cell as the string "undefined"', () => {
    const { sandbox } = loadApi([PRE_128_ROW]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    for (const f of sandbox.WORKOUT_FIELDS) {
      expect(String(w[f]), f).not.toBe('undefined');
    }
  });
});

describe('AC2: a pre-#128 row reads identically to a post-#128 one', () => {
  it('fills the nine sync columns of a truncated row with empties', () => {
    const { sandbox } = loadApi([PRE_128_ROW]);
    const [w] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    for (const f of SYNC_FIELDS) expect(w[f], f).toBe('');
  });

  it('gives the same keys as a row written with all 27 cells', () => {
    const { sandbox: a } = loadApi([PRE_128_ROW]);
    const { sandbox: b } = loadApi([workoutRow({ id: 'w_old' })]);
    const before = callDoGet(a, { action: 'getWorkouts' }).data[0];
    const after = callDoGet(b, { action: 'getWorkouts' }).data[0];
    expect(Object.keys(before).sort()).toEqual(Object.keys(after).sort());
  });
});

describe('AC2: getWorkout and filters', () => {
  const rows = [
    workoutRow({ id: 'w_1', date: '2026-09-10', type: 'bike' }),
    workoutRow({ id: 'w_2', date: '2026-09-15', type: 'weight' }),
    workoutRow({ id: 'w_3', date: '2026-09-20', type: 'bike' }),
  ];

  it('finds one workout by id', () => {
    const { sandbox } = loadApi(rows.map((r) => [...r]));
    const res = callDoGet<ApiWorkout>(sandbox, { action: 'getWorkout', id: 'w_2' });
    expect(res.success).toBe(true);
    expect(res.data.id).toBe('w_2');
    expect(res.data.sheetRow).toBe(3);
  });

  it('reports a missing id rather than returning null data', () => {
    const { sandbox } = loadApi(rows.map((r) => [...r]));
    const res = callDoGet(sandbox, { action: 'getWorkout', id: 'w_nope' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it('requires an id', () => {
    const { sandbox } = loadApi(rows.map((r) => [...r]));
    expect(callDoGet(sandbox, { action: 'getWorkout' }).error).toMatch(/id parameter required/);
  });

  it('filters by an inclusive date range', () => {
    const { sandbox } = loadApi(rows.map((r) => [...r]));
    const res = callDoGet(sandbox, { action: 'getWorkouts', from: '2026-09-10', to: '2026-09-15' });
    expect(res.data.map((w) => w.id)).toEqual(['w_1', 'w_2']);
  });

  it('filters by type', () => {
    const { sandbox } = loadApi(rows.map((r) => [...r]));
    const res = callDoGet(sandbox, { action: 'getWorkouts', type: 'bike' });
    expect(res.data.map((w) => w.id)).toEqual(['w_1', 'w_3']);
  });

  it('returns an empty list for an empty tab rather than failing', () => {
    const { sandbox } = loadApi([]);
    const res = callDoGet(sandbox, { action: 'getWorkouts' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });
});
