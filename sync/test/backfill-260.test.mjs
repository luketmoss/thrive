// #260 AC5 — scripts/backfill-260-workouts-sport-type.mjs: fills sport_type on
// existing COROS Workouts rows from their archived activity files, through
// updateWorkout with that field alone, capped per run, and reports by workout
// id and date every row it cannot fill. Fakes only, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfill, planBackfill, isCorosRow } from '../../scripts/backfill-260-workouts-sport-type.mjs';

const T_OLD = '2026-09-24T13:25:32.000Z';

/** A Workouts row as getWorkouts returns it after the deploy: sport_type included. */
const row = (id, over = {}) => ({
  id, date: '2026-09-24', time: '11:02', type: 'bike', name: 'Ride', source: 'coros',
  source_activity_id: `act_${id}`, raw_ref: `drive_${id}`, synced_at: T_OLD, sport_type: '', ...over,
});

/** An archived activity file, as sync/src/archive.mjs writes it. */
const file = (activityId, code, where = 'args') => ({
  source: 'coros', activity_id: activityId, tool: 'getActivityDetail',
  args: where === 'args' ? { labelId: activityId, sportType: code } : { labelId: activityId },
  list_entry: where === 'list' ? { sportType: code } : { name: 'x' },
  payload: '...',
});

function fakes(rows, files) {
  const writes = [];
  const reads = [];
  const api = {
    async get(action) {
      assert.equal(action, 'getWorkouts');
      return rows;
    },
    async write(action, payload) {
      assert.equal(action, 'updateWorkout');
      writes.push(payload);
      const r = rows.find((x) => x.id === payload.id);
      return { ...r, ...payload.changes };
    },
  };
  const drive = {
    async readJson(id) {
      reads.push(id);
      if (!(id in files)) throw new Error(`Drive answered 404: File not found: ${id}`);
      return files[id];
    },
  };
  return { api, drive, writes, reads };
}

async function run(rows, files, opts = {}) {
  const f = fakes(rows, files);
  const out = [];
  const err = [];
  const waits = [];
  const code = await backfill({
    api: f.api, drive: f.drive, wait: async (ms) => { waits.push(ms); },
    log: (l) => out.push(l), error: (l) => err.push(l), ...opts,
  });
  return { ...f, code, waits, out: out.join('\n'), err: err.join('\n') };
}

test('fills a synced and an enriched row from their own files, writing { sport_type } alone through updateWorkout', async () => {
  const rows = [
    row('w_ride', { date: '2026-09-24' }),
    row('w_lift', { date: '2026-09-23', source: '', type: 'weight' }),
  ];
  const files = {
    drive_w_ride: file('act_w_ride', 204),
    drive_w_lift: file('act_w_lift', 402),
  };
  const r = await run(rows, files);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.writes, [
    { id: 'w_lift', changes: { sport_type: '402' } },
    { id: 'w_ride', changes: { sport_type: '204' } },
  ]);
  for (const w of r.writes) assert.deepEqual(Object.keys(w.changes), ['sport_type'], 'no other field, synced_at included');
  assert.match(r.out, /Filled 2 row\(s\)/);
});

test('falls back to list_entry.sportType when args has none', async () => {
  const r = await run([row('w_1')], { drive_w_1: file('act_w_1', 1200, 'list') });
  assert.deepEqual(r.writes, [{ id: 'w_1', changes: { sport_type: '1200' } }]);
});

test('only fills blanks, so a second run reads nothing and writes nothing', async () => {
  const r = await run([row('w_1', { sport_type: '204' })], {});
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.reads, []);
  assert.match(r.out, /already set: 1/);
  assert.match(r.out, /Nothing to write/);
});

test('never touches garmin_import or hand-logged rows', async () => {
  const rows = [
    row('w_garmin', { source: 'garmin_import' }),
    row('w_hand', { source: '', source_activity_id: '' }),
  ];
  const r = await run(rows, { drive_w_garmin: file('act_w_garmin', 204), drive_w_hand: file('act_w_hand', 204) });
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.reads, []);
  assert.equal(isCorosRow(rows[0]), false);
  assert.equal(isCorosRow(rows[1]), false);
});

test('--dry-run reads and plans but writes nothing', async () => {
  const r = await run([row('w_1')], { drive_w_1: file('act_w_1', 204) }, { dryRun: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /w_1 {2}2026-09-24 {2}sport_type 204/);
  assert.match(r.out, /--dry-run: nothing written/);
});

test('caps the rows per run (--max-rows, default 20) and pauses after each --batch of writes', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(`w_${String(i).padStart(2, '0')}`));
  const files = Object.fromEntries(rows.map((x) => [x.raw_ref, file(x.source_activity_id, 203)]));
  const r = await run(rows, files, { pauseMs: 700 });
  assert.equal(r.writes.length, 20);
  assert.match(r.out, /20 this run, capped by --max-rows 20; 5 for a later run/);
  assert.deepEqual(r.waits, [700, 700, 700]); // after writes 5, 10 and 15
  const small = await run(rows, files, { maxRows: 3, batch: 1, pauseMs: 10 });
  assert.equal(small.writes.length, 3);
  assert.deepEqual(small.waits, [10, 10]);
});

test('lists every row it cannot fill by workout id and date, with why, and guesses nothing', async () => {
  const rows = [
    row('w_noref', { raw_ref: '' }),
    row('w_gone'),
    row('w_health'),
    row('w_other'),
    row('w_nocode'),
    row('w_frac'),
  ];
  const files = {
    drive_w_health: { run_date: '2026-09-24', window: { start: '2026-09-14' }, calls: [] },
    drive_w_other: file('act_someone_else', 204),
    drive_w_nocode: file('act_w_nocode', undefined),
    drive_w_frac: file('act_w_frac', '20.4'),
  };
  const r = await run(rows, files);
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /NOT FILLED, needs a look: 6/);
  assert.match(r.out, /w_noref {2}2026-09-24 {2}no raw_ref/);
  assert.match(r.out, /w_gone {2}2026-09-24 {2}raw_ref drive_w_gone is unreadable: Drive answered 404/);
  assert.match(r.out, /w_health {2}2026-09-24 {2}raw_ref drive_w_health is not an activity file/);
  assert.match(r.out, /w_other {2}2026-09-24 {2}raw_ref drive_w_other is activity act_someone_else, but the row is activity act_w_other/);
  assert.match(r.out, /w_nocode {2}2026-09-24 {2}raw_ref drive_w_nocode carries no whole-number sportType/);
  assert.match(r.out, /w_frac .*no whole-number sportType/);
});

test('refuses to write before the API returns sport_type', async () => {
  const old = [row('w_1')];
  delete old[0].sport_type;
  const r = await run(old, { drive_w_1: file('act_w_1', 204) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.reads, []);
  assert.match(r.err, /REFUSING: getWorkouts does not return sport_type/);
});

test('stops at a failed write and says how many landed', async () => {
  const rows = [row('w_a', { date: '2026-09-20' }), row('w_b', { date: '2026-09-21' }), row('w_c', { date: '2026-09-22' })];
  const files = Object.fromEntries(rows.map((x) => [x.raw_ref, file(x.source_activity_id, 204)]));
  const f = fakes(rows, files);
  const real = f.api.write;
  f.api.write = async (a, p) => {
    if (p.id === 'w_b') throw new Error('updateWorkout: boom');
    return real(a, p);
  };
  const err = [];
  const code = await backfill({ api: f.api, drive: f.drive, wait: async () => {}, log: () => {}, error: (l) => err.push(l) });
  assert.equal(code, 1);
  assert.deepEqual(f.writes.map((w) => w.id), ['w_a']);
  assert.match(err.join('\n'), /FAILED writing w_b \(2026-09-21\): updateWorkout: boom/);
  assert.match(err.join('\n'), /1 row\(s\) were written before it/);
});

test('planBackfill is read-only and reads each file once', async () => {
  const rows = [row('w_1'), row('w_2', { raw_ref: 'drive_w_1', source_activity_id: 'act_w_1' })];
  const reads = [];
  const plan = await planBackfill({
    rows, readFile: async (ref) => { reads.push(ref); return file('act_w_1', 204); },
  });
  assert.deepEqual(reads, ['drive_w_1']);
  assert.deepEqual(plan.fills.map((x) => x.id), ['w_1', 'w_2']);
});
