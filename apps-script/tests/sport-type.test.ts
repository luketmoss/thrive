// #260 AC2 — Workouts!AB `sport_type`: the COROS sport code, returned on every
// read, sync-owned and optional on the two sync writes (absent leaves AB
// alone), digits or '' on every path, and stored as text.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type CellValue } from './apps-script-sandbox';

const T1 = '2026-09-24T17:41:10.000Z';
const T2 = '2026-09-25T15:17:02.000Z';
const ID = '480640601618940011';
const AB = 27;

const RIDE = {
  date: '2026-09-24', time: '11:02', type: 'bike', sub_type: 'mountain', name: 'Mountain Bike',
  elapsed_seconds: '378', moving_seconds: '378', distance_m: '520', ascent_m: '3', descent_m: '',
  avg_hr: '84', calories: '17', started_at_utc: '2026-09-24T11:02:17-06:00',
};

const LIFT = { date: '2026-09-23', time: '07:30', elapsed_seconds: '2472', avg_hr: '97' };

function call(rows: CellValue[][], action: string, payload: Record<string, unknown>) {
  const api = loadApi(rows, { now: new Date(T1), uuids: ['a1b2c3d4e5f6'] });
  const res = callDoGet<any>(api.sandbox, { action, payload: JSON.stringify(payload) });
  return { ...api, res };
}

const upsert = (rows: CellValue[][], extra: Record<string, unknown>) => call(rows, 'upsertSyncedWorkout', {
  source: 'coros', source_activity_id: ID, incoming: RIDE, last_written: null,
  raw_ref: 'drive-file-1', synced_at: T1, ...extra,
});

const enrich = (rows: CellValue[][], extra: Record<string, unknown>) => call(rows, 'enrichWorkout', {
  source_activity_id: ID, activity: LIFT, last_written: null,
  raw_ref: 'drive-file-9', synced_at: T1, ...extra,
});

const syncedRow = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_ride0001', ...RIDE, source: 'coros', source_activity_id: ID,
  raw_ref: 'drive-file-1', synced_at: T1, created: T1, ...over,
});

const loggedLift = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_lift0001', date: '2026-09-23', time: '07:38', type: 'weight', name: 'Upper Push B',
  elapsed_seconds: '2460', ...over,
});

describe('AC2: the column is AB, the row is 28 cells', () => {
  it('appends sport_type to WORKOUT_FIELDS at index 27', () => {
    const { sandbox } = loadApi([]);
    expect(sandbox.COL.SPORT_TYPE).toBe(AB);
    expect(sandbox.WORKOUT_FIELDS[AB]).toBe('sport_type');
    expect(sandbox.WORKOUT_FIELDS).toHaveLength(28);
    expect(sandbox.WORKOUT_COLUMN_COUNT).toBe(28);
  });
});

describe('AC2: getWorkout / getWorkouts return sport_type on every row', () => {
  it('returns the stored code, and "" for an empty AB', () => {
    const { sandbox } = loadApi([syncedRow({ sport_type: '204' }), workoutRow({ id: 'w_hand' })]);
    const rows = callDoGet<any>(sandbox, { action: 'getWorkouts' }).data;
    expect(rows[0].sport_type).toBe('204');
    expect(rows[1]).toHaveProperty('sport_type', '');
    const one = callDoGet<any>(sandbox, { action: 'getWorkout', id: 'w_ride0001' }).data;
    expect(one.sport_type).toBe('204');
  });

  it('reads a row that predates AB (27 cells) as ""', () => {
    const short = syncedRow().slice(0, 27);
    const { sandbox } = loadApi([short]);
    const [w] = callDoGet<any>(sandbox, { action: 'getWorkouts' }).data;
    expect(w).toHaveProperty('sport_type', '');
  });
});

describe('AC2: upsertSyncedWorkout takes an optional top-level sport_type', () => {
  it('writes it on a new row, as text, in a 28-cell row', () => {
    const { res, rows } = upsert([], { sport_type: '204' });
    expect(res.success, res.error).toBe(true);
    expect(rows[0]).toHaveLength(28);
    expect(rows[0][AB]).toBe('204');
    expect(typeof rows[0][AB]).toBe('string');
  });

  it('overwrites it on an existing row (a sport changed in the COROS app follows)', () => {
    const { res, rows } = upsert([syncedRow({ sport_type: '203' })], { sport_type: '204' });
    expect(res.data.status).toBe('updated');
    expect(rows[0][AB]).toBe('204');
  });

  it('absent: leaves AB exactly as it is', () => {
    const { res, rows } = upsert([syncedRow({ sport_type: '204' })], {});
    expect(res.success, res.error).toBe(true);
    expect(rows[0][AB]).toBe('204');
  });

  it('absent on a new row: AB is blank, never 0', () => {
    const { rows } = upsert([], {});
    expect(rows[0][AB]).toBe('');
  });

  it('never appears in written or edited, and is refused inside incoming', () => {
    const { res } = upsert([syncedRow({ sport_type: '203' })], { sport_type: '204' });
    expect(res.data.written).not.toHaveProperty('sport_type');
    expect(res.data.written.edited).not.toContain('sport_type');
    const inside = upsert([], { incoming: { ...RIDE, sport_type: '204' } });
    expect(inside.res.success).toBe(false);
    expect(inside.res.error).toMatch(/"sport_type" is not a synced field/);
  });

  it('refuses a code that is not digits, naming the field, and writes nothing', () => {
    for (const bad of ['20a', '-1', '2.5', 'mtb']) {
      const { res, rows } = upsert([], { sport_type: bad });
      expect(res.success, bad).toBe(false);
      expect(res.error).toMatch(/sport_type/);
      expect(rows).toHaveLength(0);
    }
  });
});

describe('AC2: enrichWorkout takes the same optional top-level sport_type', () => {
  it('writes it with the link fields when it links a row', () => {
    const { res, rows } = enrich([loggedLift()], { sport_type: '402' });
    expect(res.data.status).toBe('enriched');
    expect(rows[0][AB]).toBe('402');
    expect(typeof rows[0][AB]).toBe('string');
  });

  it('writes it when filling an already-linked row', () => {
    const linked = loggedLift({ source_activity_id: ID, raw_ref: 'drive-file-9', synced_at: T1 });
    const { res, rows } = enrich([linked], { sport_type: '402', synced_at: T2 });
    expect(res.data.status).toBe('enriched');
    expect(rows[0][AB]).toBe('402');
  });

  it('an unchanged call writes nothing, sport_type included', () => {
    const full = loggedLift({
      source_activity_id: ID, raw_ref: 'drive-file-9', synced_at: T1,
      moving_seconds: '1', avg_hr: '1', calories: '1',
    });
    const { res, rows } = enrich([full], { sport_type: '402', synced_at: T2 });
    expect(res.data.status).toBe('unchanged');
    expect(rows[0][AB]).toBe('');
    expect(rows[0][23]).toBe(T1);
  });

  it('absent: leaves AB alone', () => {
    const { rows } = enrich([loggedLift({ sport_type: '1200' })], {});
    expect(rows[0][AB]).toBe('1200');
  });

  it('refuses a non-digit code, naming the field', () => {
    const { res, rows } = enrich([loggedLift()], { sport_type: 'x402' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sport_type/);
    expect(rows[0][19]).toBe('');
  });
});

describe('AC2: createWorkout / updateWorkout accept digits or "" only', () => {
  it('createWorkout stores digits as text', () => {
    const { res, rows } = call([], 'createWorkout', { data: { type: 'hike', name: 'Hike', sport_type: '104' } });
    expect(res.success, res.error).toBe(true);
    expect(rows[0][AB]).toBe('104');
    expect(typeof rows[0][AB]).toBe('string');
  });

  it('updateWorkout writes { sport_type } alone: no other cell moves, synced_at included', () => {
    const before = syncedRow();
    const { res, rows } = call([before], 'updateWorkout', { id: 'w_ride0001', changes: { sport_type: '204' } });
    expect(res.success, res.error).toBe(true);
    expect(rows[0][AB]).toBe('204');
    for (let i = 0; i < 27; i++) expect(String(rows[0][i] ?? ''), String(i)).toBe(String(before[i] ?? ''));
  });

  it('updateWorkout clears it with ""', () => {
    const { rows } = call([syncedRow({ sport_type: '204' })], 'updateWorkout', { id: 'w_ride0001', changes: { sport_type: '' } });
    expect(rows[0][AB]).toBe('');
  });

  it('refuses anything else on both paths, naming the field', () => {
    const c = call([], 'createWorkout', { data: { type: 'hike', name: 'Hike', sport_type: 'hike' } });
    expect(c.res.success).toBe(false);
    expect(c.res.error).toMatch(/sport_type/);
    const u = call([syncedRow()], 'updateWorkout', { id: 'w_ride0001', changes: { sport_type: '0x1' } });
    expect(u.res.success).toBe(false);
    expect(u.res.error).toMatch(/sport_type/);
  });
});
