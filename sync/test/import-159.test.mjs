// #159 — Garmin export activities -> Workouts: JSON summaries, blank where
// Garmin is silent, strength enriches a hand-logged row, idempotent.
// Synthetic rows shaped like the export; never real data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapActivity } from '../src/normalize-garmin.mjs';
import { importActivities, presentIds } from '../../scripts/import-159-garmin-activities.mjs';

// 2026-09-15 07:30:00 local (UTC-6): local stamp is wall clock as if UTC.
const LOCAL = Date.UTC(2026, 8, 15, 7, 30, 0);
const GMT = Date.UTC(2026, 8, 15, 13, 30, 0);
const act = (over = {}) => ({
  activityId: 1001, activityType: 'cycling', name: 'Morning Ride', startTimeLocal: LOCAL, startTimeGmt: GMT,
  duration: 5400000, elapsedDuration: 5700000, movingDuration: 5100000, distance: 2800000,
  elevationGain: 61000, avgHr: 138, calories: 980.4, ...over,
});

test('AC1: units, types and started_at_utc', () => {
  const { incoming } = mapActivity(act());
  assert.deepEqual(incoming, {
    date: '2026-09-15', time: '07:30', type: 'bike', sub_type: '', name: 'Morning Ride',
    elapsed_seconds: '5700', moving_seconds: '5100', distance_m: '28000', ascent_m: '610', descent_m: '',
    avg_hr: '138', calories: '980', started_at_utc: '2026-09-15T07:30:00-06:00',
  });
  const types = {
    indoor_cycling: ['bike', 'indoor'], walking: ['walk', ''], running: ['run', 'outdoor'],
    treadmill_running: ['run', 'indoor'], yoga: ['stretch', ''], strength_training: ['weight', ''],
  };
  for (const [t, [type, sub]] of Object.entries(types)) {
    const m = mapActivity(act({ activityType: t })).incoming;
    assert.equal(m.type, type, t);
    assert.equal(m.sub_type, sub, t);
  }
});

test('AC1: zeros and missing keys are blank, never 0; indoor has no ascent', () => {
  const { incoming } = mapActivity(act({
    activityType: 'indoor_cycling', movingDuration: 0, distance: 0, avgHr: undefined, calories: 0, elevationGain: 5000,
  }));
  assert.equal(incoming.moving_seconds, '');
  assert.equal(incoming.distance_m, '');
  assert.equal(incoming.avg_hr, '');
  assert.equal(incoming.calories, '');
  assert.equal(incoming.ascent_m, '');
  assert.equal(mapActivity(act({ elevationGain: 0 })).incoming.ascent_m, '');
});

test('AC1: skiing, other, and anything outside the export range are not imported', () => {
  for (const t of ['resort_skiing', 'other', 'incident_detected']) {
    assert.equal(mapActivity(act({ activityType: t })).kind, 'skipped');
  }
  const late = mapActivity(act({ startTimeLocal: Date.UTC(2026, 8, 20, 8), startTimeGmt: Date.UTC(2026, 8, 20, 14) }));
  assert.equal(late.kind, 'skipped');
});

function fake({ workouts = [], enrich = () => ({ status: 'unmatched', reason: 'no match', candidates: [] }) } = {}) {
  const calls = { enrich: [], upsert: [], archive: [] };
  return {
    calls,
    api: {
      get: async () => workouts,
      enrichWorkout: async (p) => { calls.enrich.push(p); return enrich(p); },
      upsertSyncedWorkout: async (p) => { calls.upsert.push(p); return { status: 'created', id: 'w_x' }; },
    },
    archive: {
      upsertActivity: async (a, d) => { calls.archive.push([a.activityId, d]); return { fileId: `f${a.activityId}` }; },
    },
  };
}
const run = (f, activities, extra = {}) =>
  importActivities({ ...f, activities, pauseMs: 0, log: () => {}, error: () => {}, now: () => 'T', ...extra });

test('AC2: each activity is archived and sent as garmin_import with its raw_ref', async () => {
  const f = fake();
  assert.equal(await run(f, [act()]), 0);
  assert.deepEqual(f.calls.archive, [[1001, '2026-09-15']]);
  assert.equal(f.calls.upsert.length, 1);
  const p = f.calls.upsert[0];
  assert.deepEqual(
    { s: p.source, id: p.source_activity_id, r: p.raw_ref, l: p.last_written },
    { s: 'garmin_import', id: '1001', r: 'f1001', l: null },
  );
});

test('AC2: a second run writes nothing (rows present or linked are skipped)', async () => {
  const workouts = [{ source: 'garmin_import', source_activity_id: '1001' }, { source: '', source_activity_id: '1002' }];
  assert.deepEqual([...presentIds(workouts)].sort(), ['1001', '1002']);
  const f = fake({ workouts });
  await run(f, [act(), act({ activityId: 1002, activityType: 'strength_training' })]);
  assert.equal(f.calls.archive.length + f.calls.upsert.length + f.calls.enrich.length, 0);
});

test('AC2: --max-rows caps writes and a dry run writes nothing', async () => {
  const f = fake();
  await run(f, [act(), act({ activityId: 1002 }), act({ activityId: 1003 })], { maxRows: 2 });
  assert.equal(f.calls.upsert.length, 2);
  const d = fake();
  await run(d, [act()], { dryRun: true });
  assert.equal(d.calls.upsert.length + d.calls.archive.length, 0);
});

test('AC3: strength enriches a matching hand-logged row and makes no new one', async () => {
  const f = fake({ enrich: () => ({ status: 'enriched', id: 'w_h', filled: ['avg_hr'], linked: true }) });
  await run(f, [act({ activityType: 'strength_training' })]);
  assert.equal(f.calls.enrich.length, 1);
  assert.equal(f.calls.enrich[0].activity.time, '07:30');
  assert.equal(f.calls.upsert.length, 0);
});

test('AC3: ambiguous strength writes no row; unmatched strength becomes a history row', async () => {
  const amb = fake({ enrich: () => ({ status: 'unmatched', reason: 'ambiguous', candidates: [] }) });
  await run(amb, [act({ activityType: 'strength_training' })]);
  assert.equal(amb.calls.upsert.length, 0);
  const none = fake();
  await run(none, [act({ activityType: 'strength_training' })]);
  assert.equal(none.calls.upsert.length, 1);
  assert.equal(none.calls.upsert[0].incoming.type, 'weight');
});

test('a write failure stops the run with exit code 1', async () => {
  const f = fake();
  f.api.upsertSyncedWorkout = async () => { throw new Error('boom'); };
  assert.equal(await run(f, [act(), act({ activityId: 1002 })]), 1);
});
