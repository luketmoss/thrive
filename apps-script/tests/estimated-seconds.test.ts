// #145 — Workouts!AA, `estimated_seconds`: how long a planned session is meant
// to take, typed per plan. Returned by every read, accepted by the user's
// writes, validated, and never written by the COROS sync.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type ApiWorkout, type CellValue } from './apps-script-sandbox';

const AA = 26;
const NOW = new Date('2026-09-25T15:30:00Z');
const ID = '471166302945817201';
const T1 = '2026-09-25T17:41:10.000Z';

const plan = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_plan', date: '2099-12-31', time: '', status: 'planned', name: 'Upper Pull A',
  estimated_seconds: '2820', ...over,
});

/** What Sheets hands back for a row written before AA existed: 26 cells. */
const pre145 = (over: Record<string, CellValue> = {}) => plan({ estimated_seconds: '', ...over }).slice(0, 26);

describe('AC5: every read returns estimated_seconds', () => {
  it('sits at AA, after calories', () => {
    const { sandbox } = loadApi([]);
    expect(sandbox.WORKOUT_FIELDS[AA]).toBe('estimated_seconds');
    expect(sandbox.COL.ESTIMATED_SECONDS).toBe(AA);
    expect(sandbox.WORKOUT_COLUMN_COUNT).toBe(27);
  });

  it('getWorkouts, getWorkout and getPlannedWorkouts all return the stored seconds', () => {
    const { sandbox } = loadApi([plan()]);
    const [listed] = callDoGet(sandbox, { action: 'getWorkouts' }).data;
    expect(listed.estimated_seconds).toBe('2820');
    expect(callDoGet<ApiWorkout>(sandbox, { action: 'getWorkout', id: 'w_plan' }).data.estimated_seconds).toBe('2820');
    const [p] = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2099-12-31' }).data;
    expect(p.estimated_seconds).toBe('2820');
    expect(p.elapsed_seconds).toBe('');
  });

  it('reads a row written before AA existed as blank, never 0', () => {
    const { sandbox } = loadApi([pre145()]);
    const [w] = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2099-12-31' }).data;
    expect(w).toHaveProperty('estimated_seconds', '');
  });
});

describe('AC5: createWorkout and updateWorkout accept it', () => {
  function create(data: Record<string, unknown>) {
    const api = loadApi([], { now: NOW, uuids: ['abcdef1234567890'] });
    const res = callDoGet<ApiWorkout>(api.sandbox, { action: 'createWorkout', payload: JSON.stringify({ data }) });
    return { ...api, res };
  }
  function update(rows: CellValue[][], changes: Record<string, unknown>) {
    const api = loadApi(rows, { now: NOW });
    const res = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'updateWorkout', payload: JSON.stringify({ id: 'w_plan', changes }),
    });
    return { ...api, res };
  }

  it('writes a sent estimate to AA as literal text', () => {
    const { res, rows } = create({ type: 'weight', name: 'Pull A', status: 'planned', estimated_seconds: '2820' });
    expect(res.success, res.error).toBe(true);
    expect(res.data.estimated_seconds).toBe('2820');
    expect(rows[0][AA]).toBe('2820');
    expect(typeof rows[0][AA]).toBe('string');
  });

  it('leaves AA blank when none is sent', () => {
    const { rows } = create({ type: 'weight', name: 'Pull A', status: 'planned' });
    expect(rows[0][AA]).toBe('');
  });

  it('changes it, clears it, and leaves it alone when not mentioned', () => {
    expect(update([plan()], { estimated_seconds: '3000' }).rows[0][AA]).toBe('3000');
    expect(update([plan()], { estimated_seconds: '' }).rows[0][AA]).toBe('');
    expect(update([plan()], { name: 'Upper Pull B' }).rows[0][AA]).toBe('2820');
  });

  it('widens a pre-#145 row on its first write, leaving AA blank', () => {
    const { rows } = update([pre145()], { name: 'Upper Pull B' });
    expect(rows[0]).toHaveLength(27);
    expect(rows[0][AA]).toBe('');
  });

  it.each(['0', '45 min', '2820.5', '-60', '47m'])('refuses %j, naming the field, and writes nothing', (bad) => {
    const before = JSON.stringify(plan());
    const { res, rows } = update([plan()], { estimated_seconds: bad });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/estimated_seconds must be a positive whole number of seconds/);
    expect(JSON.stringify(rows[0])).toBe(before);
    const created = create({ type: 'weight', name: 'Pull A', estimated_seconds: bad });
    expect(created.res.success).toBe(false);
    expect(created.rows).toHaveLength(0);
  });
});

describe('AC4: the sync never writes AA', () => {
  const RIDE = {
    date: '2026-09-24', time: '11:02', type: 'bike', sub_type: 'gravel', name: 'Gravel Bike',
    elapsed_seconds: '378', moving_seconds: '378', distance_m: '520', ascent_m: '3', descent_m: '',
    avg_hr: '84', calories: '17', started_at_utc: '2026-09-24T11:02:17-06:00',
  };
  function upsert(rows: CellValue[][], body: Record<string, unknown> = {}) {
    const api = loadApi(rows, { now: NOW, uuids: ['a1b2c3d4e5f6'] });
    const res = callDoGet<any>(api.sandbox, {
      action: 'upsertSyncedWorkout',
      payload: JSON.stringify({
        source: 'coros', source_activity_id: ID, incoming: RIDE, last_written: null,
        raw_ref: 'drive-file-1', synced_at: T1, ...body,
      }),
    });
    return { ...api, res };
  }

  it('upsertSyncedWorkout refuses an estimate in its incoming fields', () => {
    const { res, rows } = upsert([], { incoming: { ...RIDE, estimated_seconds: '2820' } });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/"estimated_seconds" is not a synced field/);
    expect(rows).toHaveLength(0);
  });

  it('a synced row it creates has a blank AA', () => {
    const { res, rows } = upsert([]);
    expect(res.data.status).toBe('created');
    expect(rows[0][AA]).toBe('');
  });

  it('an update carries an existing AA through unchanged', () => {
    const row = workoutRow({
      id: 'w_ride0001', ...RIDE, source: 'coros', source_activity_id: ID,
      raw_ref: 'drive-file-1', synced_at: '2026-09-24T18:00:00.000Z', estimated_seconds: '3600',
    });
    const { res, rows } = upsert([row], { incoming: { ...RIDE, moving_seconds: '360' } });
    expect(res.data.status).toBe('updated');
    expect(rows[0][AA]).toBe('3600');
  });

  it('enrichWorkout fills its blanks and leaves AA exactly as it was', () => {
    const logged = workoutRow({
      id: 'w_lift0001', date: '2026-09-23', time: '07:38', type: 'weight', name: 'Upper Push B',
      elapsed_seconds: '2460', estimated_seconds: '2820',
    });
    const api = loadApi([logged]);
    const res = callDoGet<any>(api.sandbox, {
      action: 'enrichWorkout',
      payload: JSON.stringify({
        source_activity_id: ID, last_written: null, raw_ref: 'drive-file-9', synced_at: T1,
        activity: { date: '2026-09-23', time: '07:30', elapsed_seconds: '2472', moving_seconds: '2390', avg_hr: '97', calories: '211' },
      }),
    });
    expect(res.data.status).toBe('enriched');
    expect(api.rows[0][AA]).toBe('2820');
    expect(api.rows[0][7]).toBe('2460');
  });

  it('enrichWorkout refuses an estimate in its activity', () => {
    const api = loadApi([workoutRow({ id: 'w_lift0001', date: '2026-09-23', time: '07:38' })]);
    const res = callDoGet<any>(api.sandbox, {
      action: 'enrichWorkout',
      payload: JSON.stringify({
        source_activity_id: ID, last_written: null, raw_ref: 'drive-file-9', synced_at: T1,
        activity: { date: '2026-09-23', time: '07:30', estimated_seconds: '2820' },
      }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/"estimated_seconds" is not an enrichable field/);
  });
});
