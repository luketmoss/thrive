// #155 — enrichWorkout: a COROS strength session fills blanks on the matching
// hand-logged weight row, never creates one, and never overwrites a typed value.
// Every value here is made up; the shapes are the sync's.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type CellValue } from './apps-script-sandbox';

const T1 = '2026-09-24T13:17:04.000Z';
const T2 = '2026-09-24T18:17:09.000Z';
const ID = '471093115402967310';

const ORDER = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes',
  'elapsed_seconds', 'created', 'copied_from', 'status',
  'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
];
const C = Object.fromEntries(ORDER.map((f, i) => [f, i])) as Record<string, number>;

/** A strength session as the sync sends it: local start 07:30. */
const LIFT = {
  date: '2026-09-23', time: '07:30',
  elapsed_seconds: '2472', moving_seconds: '2390', avg_hr: '97', calories: '211',
};

/** A hand-logged weight row as the SPA leaves it: Time and Elapsed typed, the rest blank. */
const logged = (over: Record<string, CellValue> = {}) => workoutRow({
  id: 'w_lift0001', date: '2026-09-23', time: '07:38', type: 'weight', name: 'Upper Push B',
  elapsed_seconds: '2460', effort: 'Medium', notes: 'felt fine', created: '2026-09-23T13:38:00.000Z',
  ...over,
});

function enrich(rows: CellValue[][], body: Record<string, unknown> = {}, key?: string) {
  const api = loadApi(rows);
  const res = callDoGet<any>(api.sandbox, {
    action: 'enrichWorkout',
    payload: JSON.stringify({
      source_activity_id: ID, activity: LIFT, last_written: null,
      raw_ref: 'drive-file-9', synced_at: T1, ...body,
    }),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res };
}

const snapshot = (rows: CellValue[][]) => JSON.stringify(rows);

describe('AC1: a strength session enriches its hand-logged workout', () => {
  it('links the row and fills only its blanks; the typed values and every other column are untouched', () => {
    const before = logged();
    const { res, rows, lock } = enrich([before]);
    expect(res.success, res.error).toBe(true);
    expect(res.data).toMatchObject({
      status: 'enriched', id: 'w_lift0001', sheetRow: 2, linked: true,
      filled: ['moving_seconds', 'avg_hr', 'calories'],
      written: { workout_id: 'w_lift0001', filled: ['moving_seconds', 'avg_hr', 'calories'] },
    });
    expect(lock.acquired).toBe(1);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r[C.elapsed_seconds]).toBe('2460'); // typed: the app's, not the watch's 2472
    expect(r[C.moving_seconds]).toBe('2390');
    expect(r[C.avg_hr]).toBe('97');
    expect(r[C.calories]).toBe('211');
    expect(r[C.source]).toBe('');
    expect(r[C.source_activity_id]).toBe(ID);
    expect(r[C.raw_ref]).toBe('drive-file-9');
    expect(r[C.synced_at]).toBe(T1);
    const touched = new Set(['moving_seconds', 'avg_hr', 'calories', 'source_activity_id', 'raw_ref', 'synced_at']);
    for (const f of ORDER) {
      if (!touched.has(f)) expect(String(r[C[f]]), f).toBe(String(before[C[f]]));
    }
    // Stored as text through asText(): no number was parsed.
    expect(typeof r[C.avg_hr]).toBe('string');
  });

  it('fills a blank elapsed too, and leaves a field COROS did not send blank, never 0', () => {
    const { res, rows } = enrich([logged({ elapsed_seconds: '' })], { activity: { ...LIFT, calories: '' } });
    expect(res.data.filled).toEqual(['elapsed_seconds', 'moving_seconds', 'avg_hr']);
    expect(rows[0][C.elapsed_seconds]).toBe('2472');
    expect(rows[0][C.calories]).toBe('');
  });

  it('matches at exactly the tolerance, 30 minutes either side', () => {
    expect(enrich([logged({ time: '08:00' })]).res.data.status).toBe('enriched');
    expect(enrich([logged({ time: '07:00' })]).res.data.status).toBe('enriched');
    expect(enrich([logged({ time: '08:01' })]).res.data.status).toBe('unmatched');
  });

  it('holds the tolerance in one constant', () => {
    const { sandbox } = loadApi();
    expect(sandbox.STRENGTH_MATCH_TOLERANCE_MINUTES).toBe(30);
  });

  it('links a row whose fields are all typed, filling nothing', () => {
    const full = logged({ moving_seconds: '2400', avg_hr: '101', calories: '190' });
    const { res, rows } = enrich([full]);
    expect(res.data).toMatchObject({ status: 'enriched', linked: true, filled: [] });
    expect(rows[0][C.avg_hr]).toBe('101');
    expect(rows[0][C.source_activity_id]).toBe(ID);
  });
});

describe('AC2: no match, or an ambiguous one, writes nothing', () => {
  const cases: [string, CellValue[][], string, string[]][] = [
    ['no weight row that day', [logged({ date: '2026-09-22' })], 'no match', []],
    ['a weight row 31 minutes off', [logged({ time: '08:01' })], 'no match', []],
    ['only a bike ride', [logged({ type: 'bike' })], 'no match', []],
    ['only a synced row', [logged({ source: 'coros', source_activity_id: '1' })], 'no match', []],
    ['only a row another session claimed', [logged({ source_activity_id: '999' })], 'no match', []],
    ['only a planned row', [logged({ status: 'planned' })], 'no match', []],
    ['only a row still in progress', [logged({ status: 'active' })], 'no match', []],
    ['two rows within the tolerance, one nearer', [
      logged({ id: 'w_a', time: '07:31' }), logged({ id: 'w_b', time: '07:55' }),
    ], 'ambiguous', ['w_a', 'w_b']],
    ['a timed row and a blank-Time row', [
      logged({ id: 'w_a', time: '07:31' }), logged({ id: 'w_b', time: '' }),
    ], 'ambiguous', ['w_a', 'w_b']],
  ];
  it.each(cases)('%s', (_name, rows, reason, candidates) => {
    const before = snapshot(rows);
    const { res, rows: after } = enrich(rows);
    expect(res.success, res.error).toBe(true);
    expect(res.data.status).toBe('unmatched');
    expect(res.data.reason).toBe(reason);
    expect(res.data.candidates.map((c: any) => c.id)).toEqual(candidates);
    expect(snapshot(after)).toBe(before);
    expect(after).toHaveLength(rows.length);
  });

  it('a blank Time matches when it is the day\'s only candidate', () => {
    const { res, rows } = enrich([logged({ time: '' }), logged({ id: 'w_bike', type: 'bike', time: '07:30' })]);
    expect(res.data).toMatchObject({ status: 'enriched', id: 'w_lift0001' });
    expect(rows[0][C.avg_hr]).toBe('97');
  });

  it('a complete row counts, like a blank status', () => {
    expect(enrich([logged({ status: 'complete' })]).res.data.status).toBe('enriched');
  });

  it('is one-to-one: a row one session claimed is no candidate for the next', () => {
    const api = loadApi([logged()]);
    const call = (id: string) => callDoGet<any>(api.sandbox, {
      action: 'enrichWorkout',
      payload: JSON.stringify({ source_activity_id: id, activity: LIFT, last_written: null, raw_ref: 'f', synced_at: T1 }),
    });
    expect(call('111').data.status).toBe('enriched');
    expect(call('222').data).toMatchObject({ status: 'unmatched', reason: 'no match' });
    expect(api.rows[0][C.source_activity_id]).toBe('111');
  });
});

describe('AC3: re-runs are idempotent and edits stick', () => {
  const enriched = (over: Record<string, CellValue> = {}) => logged({
    moving_seconds: '2390', avg_hr: '97', calories: '211',
    source_activity_id: ID, raw_ref: 'drive-file-9', synced_at: T1, ...over,
  });
  const LAST = { workout_id: 'w_lift0001', filled: ['moving_seconds', 'avg_hr', 'calories'] };

  it('a second run with nothing to fill writes nothing, synced_at included', () => {
    const rows = [enriched()];
    const before = snapshot(rows);
    const { res, rows: after } = enrich(rows, { last_written: LAST, synced_at: T2 });
    expect(res.data).toMatchObject({ status: 'unchanged', id: 'w_lift0001', filled: [], written: LAST });
    expect(snapshot(after)).toBe(before);
  });

  it('never rewrites a field it filled, even after the user edits or clears it', () => {
    const rows = [enriched({ avg_hr: '120', calories: '' })];
    const before = snapshot(rows);
    const { res, rows: after } = enrich(rows, { last_written: LAST, synced_at: T2 });
    expect(res.data.status).toBe('unchanged');
    expect(snapshot(after)).toBe(before);
  });

  it('fills a field on a later run when COROS only now has it', () => {
    const rows = [enriched({ calories: '' })];
    const last = { workout_id: 'w_lift0001', filled: ['moving_seconds', 'avg_hr'] };
    const { res, rows: after } = enrich(rows, { last_written: last, synced_at: T2 });
    expect(res.data).toMatchObject({
      status: 'enriched', linked: false, filled: ['calories'],
      written: { workout_id: 'w_lift0001', filled: ['moving_seconds', 'avg_hr', 'calories'] },
    });
    expect(after[0][C.calories]).toBe('211');
    expect(after[0][C.synced_at]).toBe(T2);
  });

  it('a row that lost its link is matched afresh, with no filled list carried over', () => {
    // A stale SPA save wrote the row back without the enrichment.
    const rows = [logged()];
    const { res, rows: after } = enrich(rows, { last_written: LAST, synced_at: T2 });
    expect(res.data).toMatchObject({ status: 'enriched', linked: true, filled: ['moving_seconds', 'avg_hr', 'calories'] });
    expect(after[0][C.avg_hr]).toBe('97');
  });

  it('a filled list for a different row does not apply to this one', () => {
    const rows = [enriched({ id: 'w_other', avg_hr: '' })];
    const { res } = enrich(rows, { last_written: LAST });
    expect(res.data.filled).toEqual(['avg_hr']);
  });
});

describe('AC5: the action refuses what it must not write', () => {
  it('refuses two rows carrying the activity ID, naming them, and writes nothing', () => {
    const rows = [logged({ id: 'w_x', source_activity_id: ID }), logged({ id: 'w_y', source_activity_id: ID })];
    const before = snapshot(rows);
    const { res, rows: after } = enrich(rows);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/w_x/);
    expect(res.error).toMatch(/w_y/);
    expect(snapshot(after)).toBe(before);
  });

  it.each([
    ['a field it may not set', { activity: { ...LIFT, effort: 'Hard' } }, /"effort" is not an enrichable field/],
    ['a name', { activity: { ...LIFT, name: 'x' } }, /"name" is not an enrichable field/],
    ['a non-integer measure', { activity: { ...LIFT, avg_hr: '97 bpm' } }, /avg_hr must be a whole number/],
    ['a missing time', { activity: { ...LIFT, time: '' } }, /activity.time must be local HH:MM/],
    ['a bad date', { activity: { ...LIFT, date: '23/09/2026' } }, /activity.date/],
    ['a missing activity ID', { source_activity_id: '' }, /source_activity_id is required/],
    ['a missing raw_ref', { raw_ref: '' }, /raw_ref is required/],
    ['a filled list naming another field', { last_written: { workout_id: 'w', filled: ['notes'] } }, /not an enrichable field/],
  ])('refuses %s', (_n, body, message) => {
    const rows = [logged()];
    const before = snapshot(rows);
    const { res, rows: after } = enrich(rows, body);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(message);
    expect(snapshot(after)).toBe(before);
  });

  it('requires activity and last_written', () => {
    const api = loadApi([logged()]);
    const r1 = callDoGet<any>(api.sandbox, { action: 'enrichWorkout', payload: JSON.stringify({ last_written: null }) });
    expect(r1.error).toMatch(/payload.activity field required/);
    const r2 = callDoGet<any>(api.sandbox, { action: 'enrichWorkout', payload: JSON.stringify({ activity: LIFT }) });
    expect(r2.error).toMatch(/payload.last_written field required/);
  });

  it('accepts only the API key', () => {
    const rows = [logged()];
    const { res } = enrich(rows, {}, 'wrong-key');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid or missing API key/);
    expect(rows[0][C.source_activity_id]).toBe('');
  });

  it('re-reads the row and refuses to write if it changed between the scan and the write', () => {
    const api = loadApi([logged()]);
    const scan = api.sandbox.getAllRows;
    api.sandbox.getAllRows = (sheet: any) => {
      const out = scan(sheet);
      api.rows.unshift(workoutRow({ id: 'w_new', date: '2026-09-23' }));
      return out;
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'enrichWorkout',
      payload: JSON.stringify({ source_activity_id: ID, activity: LIFT, last_written: null, raw_ref: 'f', synced_at: T1 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/changed during the write; nothing was written/);
    expect(api.rows[1][C.source_activity_id]).toBe('');
  });
});
