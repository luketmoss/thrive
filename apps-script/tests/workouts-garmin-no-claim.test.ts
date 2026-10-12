// #159 AC4 — a garmin_import activity is history: it never completes a plan
// (#403), but any other source still does.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type CellValue } from './apps-script-sandbox';

const NOW = new Date('2026-10-11T23:10:00Z');
const T1 = '2026-10-11T23:10:00.000Z';
const T2 = '2026-10-12T05:00:00.000Z';
const ID = '471166302945817999';

const ORDER = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes',
  'elapsed_seconds', 'created', 'copied_from', 'status',
  'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
  'estimated_seconds', 'sport_type',
];
const C = Object.fromEntries(ORDER.map((f, i) => [f, i])) as Record<string, number>;

const RIDE = {
  date: '2026-10-11', time: '16:05', type: 'bike', sub_type: 'mountain', name: 'Mountain Bike',
  elapsed_seconds: '5400', moving_seconds: '5100', distance_m: '28000', ascent_m: '610', descent_m: '605',
  avg_hr: '138', calories: '980', started_at_utc: '2026-10-11T16:05:12-06:00',
};

/** A ride planned in Thrive for that day: no time, no activity yet. */
const plan = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_plan0001', date: '2026-10-11', time: '', type: 'bike', sub_type: 'gravel',
  name: 'Zone 2 - 90 min', notes: 'keep HR under 140', template_id: 'tpl_ride01',
  estimated_seconds: '5400', effort: 'Easy', status: 'planned', created: '2026-10-09T12:00:00.000Z',
  ...over,
});

function upsert(rows: CellValue[][], body: Record<string, unknown> = {}) {
  const api = loadApi(rows, { now: NOW, uuids: ['a1b2c3d4e5f6'] });
  const res = callDoGet<any>(api.sandbox, {
    action: 'upsertSyncedWorkout',
    payload: JSON.stringify({
      source: 'coros', source_activity_id: ID, incoming: RIDE, last_written: null,
      raw_ref: 'drive-file-1', synced_at: T1, sport_type: '204', ...body,
    }),
  });
  return { ...api, res };
}

const display = (row: CellValue[]) => row.map((v) => (v instanceof Date ? v.toISOString() : String(v ?? '')));

describe('#159 AC4: history never claims a plan', () => {
  it('appends a garmin_import row and leaves the plan alone', () => {
    const { res, rows } = upsert([plan()], { source: 'garmin_import', sport_type: undefined });
    expect(res.success, res.error).toBe(true);
    expect(res.data.status).toBe('created');
    expect(res.data.ambiguous_plans).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows[0][C.status]).toBe('planned');
    expect(rows[0][C.source]).toBe('');
    expect(rows[1][C.source]).toBe('garmin_import');
    expect(rows[1][C.source_activity_id]).toBe(ID);
  });

  it('a coros activity on the same day still claims it', () => {
    const { res } = upsert([plan()]);
    expect(res.data.status).toBe('claimed');
  });
});
