// #166: the run's activity step. Each listed activity is read back from the
// archive, normalized, merged through upsertSyncedWorkout, and what the sheet
// then holds is written back to the archive's `normalized`. The merge itself
// is tested against the real Apps Script source in
// apps-script/tests/workouts-upsert-synced.test.ts; here the API is a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createArchive } from '../src/archive.mjs';
import { writeSheet } from '../src/sheet.mjs';
import { syncActivities } from '../src/sync-activities.mjs';
import { memoryDrive } from './helpers.mjs';

const DIR = new URL('./fixtures/activities/', import.meta.url);
const FIXTURES = readdirSync(DIR).filter((n) => n.endsWith('.json'))
  .map((n) => JSON.parse(readFileSync(new URL(n, DIR), 'utf8')));
const legacy = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const GYM = legacy('activity-gym-cardio-471093826615208843.json');
const STRENGTH = legacy('activity-strength-471093115402967310.json');
const HYBRID = legacy('activity-hybrid-fitness-471166302945817205.json');
const byPrefix = (p) => FIXTURES.find((f) => f.list_entry.name.startsWith(p));
const GRAVEL = byPrefix('Gravel');

const SYNCED = '2026-09-24T17:41:10.000Z';
const WINDOW = { start: '2026-09-14', end: '2026-09-25', runDate: '2026-09-24' };

/** An archive holding these files, landed the way ingest lands them. */
async function archiveWith(files) {
  const drive = memoryDrive();
  const archive = createArchive(drive, { now: () => Date.parse(SYNCED) });
  const ids = {};
  for (const f of files) {
    const { fileId } = await archive.upsertActivity({
      activityId: f.activity_id, localDate: f.list_entry.date, tool: f.tool, args: f.args,
      listEntry: f.list_entry, payload: f.payload,
    });
    ids[f.activity_id] = fileId;
  }
  drive.writes.length = 0;
  return { drive, archive, ids };
}

/**
 * A fake API with a Workouts table keyed by vendor ID. It creates, updates
 * with the incoming values, and reports `deleted` for a row that is gone
 * while `last_written` is set — the contract, not the merge.
 */
function fakeApi({ rows = new Map(), fail = {}, enrich = () => ({ status: 'unmatched', reason: 'no match', candidates: [] }) } = {}) {
  const calls = [];
  let seq = 0;
  return {
    calls,
    rows,
    /** #155's contract, scripted: the matching itself is tested against the real source. */
    async enrichWorkout(payload) {
      calls.push({ action: 'enrichWorkout', ...payload });
      if (fail[payload.source_activity_id]) throw fail[payload.source_activity_id];
      return enrich(payload);
    },
    async upsertSyncedWorkout(payload) {
      calls.push({ action: 'upsertSyncedWorkout', ...payload });
      if (fail[payload.source_activity_id]) throw fail[payload.source_activity_id];
      const key = `${payload.source}:${payload.source_activity_id}`;
      const row = rows.get(key);
      if (!row && payload.last_written) return { status: 'deleted' };
      const id = row?.id ?? `w_${String(++seq).padStart(8, '0')}`;
      rows.set(key, { id, ...payload.incoming, raw_ref: payload.raw_ref, synced_at: payload.synced_at });
      return { status: row ? 'updated' : 'created', id, written: { ...payload.incoming, edited: [] }, kept: [] };
    },
    async upsertDailyHealth() {
      calls.push({ action: 'upsertDailyHealth' });
      return { appended: 0, updated: 0, batches: 0 };
    },
    async rebuildDailySummary(from, to, computedAt) {
      calls.push({ action: 'rebuildDailySummary', from, to, computedAt });
      return { written: 1, updated: 0, removed: 0 };
    },
  };
}

const ALL = [...FIXTURES, GYM, STRENGTH];
const allIds = ALL.map((f) => f.activity_id);
const fileOf = (drive, id) => [...drive.files.values()].find((f) => f.props.activity_id === id);

test('AC1/AC3: the four mapped activities are upserted by vendor ID, with raw_ref and synced_at', async () => {
  const { archive, ids } = await archiveWith(ALL);
  const api = fakeApi();
  const lines = [];
  const out = await syncActivities({ archive, api, activityIds: allIds, syncedAt: SYNCED, log: (l) => lines.push(l) });

  assert.deepEqual(out.failures, []);
  assert.deepEqual({ created: out.created, updated: out.updated, skipped: out.skipped }, { created: 4, updated: 0, skipped: 1 });
  const upserts = api.calls.filter((c) => c.action === 'upsertSyncedWorkout');
  assert.equal(upserts.length, 4);
  for (const call of upserts) {
    assert.equal(call.source, 'coros');
    assert.equal(call.raw_ref, ids[call.source_activity_id], 'raw_ref is the archive file ID');
    assert.equal(call.synced_at, SYNCED);
    assert.equal(call.last_written, null, 'a first sync has nothing to compare');
  }
  const typed = Object.fromEntries(upserts.map((c) => [c.incoming.name, `${c.incoming.type}/${c.incoming.sub_type}`]));
  assert.deepEqual(typed, {
    'Gravel Bike': 'bike/gravel', Walk: 'walk/outdoor', Hike: 'hike/', 'Indoor Cycling': 'bike/indoor',
  });
  // Strength goes to enrichWorkout (#155), never upsertSyncedWorkout, and gym
  // cardio (400) is logged with its ID and code.
  assert.ok(!upserts.some((c) => c.source_activity_id === STRENGTH.activity_id));
  assert.equal(api.calls.filter((c) => c.action === 'enrichWorkout').length, 1);
  assert.ok(lines.some((l) => l.includes(GYM.activity_id) && /sport code 400 is not mapped/.test(l)));
});

test('AC4: what the sheet holds is written back to normalized, and only when it changed', async () => {
  const { drive, archive } = await archiveWith([GRAVEL]);
  const api = fakeApi();
  await syncActivities({ archive, api, activityIds: [GRAVEL.activity_id], syncedAt: SYNCED, log: () => {} });
  const file = fileOf(drive, GRAVEL.activity_id);
  assert.equal(file.data.normalized.distance_m, '520');
  assert.deepEqual(file.data.normalized.edited, []);
  assert.equal(file.data.payload, GRAVEL.payload, 'the payload is never touched');
  assert.equal(file.data.payload_hash, GRAVEL.payload_hash);

  // The second run compares against it, and, unchanged, rewrites nothing.
  drive.writes.length = 0;
  await syncActivities({ archive, api, activityIds: [GRAVEL.activity_id], syncedAt: '2026-09-25T15:17:02.000Z', log: () => {} });
  assert.deepEqual(api.calls[1].last_written, file.data.normalized);
  assert.equal(api.rows.size, 1, 'one row per activity');
  assert.deepEqual(drive.writes, [], 'normalized unchanged, so nothing written to Drive');
});

test('AC4: a row deleted in Thrive is not recreated, is logged, and does not fail the run', async () => {
  const { archive } = await archiveWith([GRAVEL]);
  const api = fakeApi();
  await syncActivities({ archive, api, activityIds: [GRAVEL.activity_id], syncedAt: SYNCED, log: () => {} });
  api.rows.clear(); // the user deleted it
  const lines = [];
  const out = await syncActivities({ archive, api, activityIds: [GRAVEL.activity_id], syncedAt: SYNCED, log: (l) => lines.push(l) });
  assert.equal(out.deleted, 1);
  assert.deepEqual(out.failures, []);
  assert.equal(api.rows.size, 0);
  assert.ok(lines.some((l) => /deleted in Thrive, so it was not recreated/.test(l)));
});

test('AC2: an unrecognized line fails that activity alone, names it, and leaves the archive as it was', async () => {
  const broken = { ...GRAVEL, payload: GRAVEL.payload.replace('Distance: 0.52 km', 'Distance: 0.32 mi') };
  const { drive, archive } = await archiveWith([broken, ...FIXTURES.filter((f) => f !== GRAVEL)]);
  const before = JSON.stringify(fileOf(drive, GRAVEL.activity_id).data);
  const api = fakeApi();
  const lines = [];
  const out = await syncActivities({
    archive, api, activityIds: FIXTURES.map((f) => f.activity_id), syncedAt: SYNCED, log: (l) => lines.push(l),
  });

  assert.equal(out.failures.length, 1, 'the run exits non-zero');
  assert.match(out.failures[0], new RegExp(GRAVEL.activity_id));
  assert.match(out.failures[0], /Distance: 0\.32 mi/);
  assert.ok(!api.calls.some((c) => c.source_activity_id === GRAVEL.activity_id), 'no sheet write for it');
  assert.equal(out.created, 3, 'the others continue');
  assert.equal(JSON.stringify(fileOf(drive, GRAVEL.activity_id).data), before);
  assert.ok(lines.some((l) => l.startsWith('  FAILED')));
});

test('an API refusal fails that activity, and the others still go', async () => {
  const { archive } = await archiveWith(FIXTURES);
  const api = fakeApi({ fail: { [GRAVEL.activity_id]: new Error('upsertSyncedWorkout: 2 Workouts rows are coros activity') } });
  const out = await syncActivities({ archive, api, activityIds: FIXTURES.map((f) => f.activity_id), syncedAt: SYNCED, log: () => {} });
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /2 Workouts rows/);
  assert.equal(out.created, 3);
});

test('an activity the archive does not hold is skipped quietly: ingest already reported it', async () => {
  const { archive } = await archiveWith([]);
  const out = await syncActivities({ archive, api: fakeApi(), activityIds: ['123'], syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(out.failures, []);
});

test('AC5: health, then activities, then the rollup, once, over D − 10 to D', async () => {
  const { archive } = await archiveWith([GRAVEL]);
  const api = fakeApi();
  const out = await writeSheet({ archive, api, window: WINDOW, activityIds: [GRAVEL.activity_id], syncedAt: SYNCED, log: () => {} });
  // No health bundle in this archive, which is a reported failure; the rest still runs.
  assert.match(out.failures[0], /no bundle in the archive/);
  assert.deepEqual(api.calls.map((c) => c.action), ['upsertSyncedWorkout', 'rebuildDailySummary']);
  const rollup = api.calls.at(-1);
  assert.deepEqual([rollup.from, rollup.to, rollup.computedAt], ['2026-09-14', '2026-09-24', SYNCED]);
  assert.equal(out.activities.created, 1);
});

// --- the list entry, refreshed on its own (#166) ------------------------------

test('a rename that shows only in the list refreshes the archived entry', async () => {
  const { drive, archive } = await archiveWith([GRAVEL]);
  const renamed = {
    ...GRAVEL.list_entry,
    name: 'Evening gravel',
    text: GRAVEL.list_entry.text.replace('Gravel Bike —', 'Evening gravel —'),
  };
  const res = await archive.upsertActivity({
    activityId: GRAVEL.activity_id, localDate: '2026-09-24', tool: GRAVEL.tool, args: GRAVEL.args,
    listEntry: renamed, payload: GRAVEL.payload,
  });
  assert.equal(res.status, 'updated');
  assert.equal(fileOf(drive, GRAVEL.activity_id).data.list_entry.name, 'Evening gravel');
});

test('the entry moving down the list is not a change', async () => {
  const { drive, archive } = await archiveWith([GRAVEL]);
  const moved = { ...GRAVEL.list_entry, text: GRAVEL.list_entry.text.replace(/^4\. /, '7. ') };
  const res = await archive.upsertActivity({
    activityId: GRAVEL.activity_id, localDate: '2026-09-24', tool: GRAVEL.tool, args: GRAVEL.args,
    listEntry: moved, payload: GRAVEL.payload,
  });
  assert.equal(res.status, 'unchanged');
  assert.deepEqual(drive.writes, []);
});

const HIKE = byPrefix('Hike');

test('#156 AC2: a re-sync that changes nothing counts as unchanged, not updated', async () => {
  const { archive } = await archiveWith([GRAVEL, HIKE]);
  const api = fakeApi();
  const ids = [GRAVEL.activity_id, HIKE.activity_id];
  const first = await syncActivities({ archive, api, activityIds: ids, syncedAt: SYNCED, log: () => {} });
  assert.deepEqual({ created: first.created, updated: first.updated, unchanged: first.unchanged }, { created: 2, updated: 0, unchanged: 0 });

  // The API answers `updated` for both, because synced_at moved; only the
  // renamed one actually changed.
  const renamed = { ...GRAVEL };
  const realUpsert = api.upsertSyncedWorkout;
  api.upsertSyncedWorkout = async (payload) => {
    const res = await realUpsert(payload);
    if (payload.source_activity_id === renamed.activity_id) res.written = { ...res.written, name: 'Renamed' };
    return res;
  };
  const lines = [];
  const second = await syncActivities({ archive, api, activityIds: ids, syncedAt: '2026-09-25T15:17:02.000Z', log: (l) => lines.push(l) });
  assert.deepEqual({ created: second.created, updated: second.updated, unchanged: second.unchanged }, { created: 0, updated: 1, unchanged: 1 });
  assert.ok(lines.some((l) => l.includes(HIKE.activity_id) && /: unchanged w_/.test(l)));
});

// --- strength enrichment (#155) -----------------------------------------------

const enrichCalls = (api) => api.calls.filter((c) => c.action === 'enrichWorkout');

test('#155 AC1: a strength session is offered to enrichWorkout with its local start and four fields, never a row', async () => {
  const { archive, ids } = await archiveWith([STRENGTH]);
  const api = fakeApi();
  await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id], syncedAt: SYNCED, log: () => {} });
  const [call] = enrichCalls(api);
  assert.deepEqual(call.activity, {
    date: '2026-09-23', time: '07:30',
    elapsed_seconds: '124', moving_seconds: '124', avg_hr: '88', calories: '21',
  });
  assert.equal(call.source_activity_id, STRENGTH.activity_id);
  assert.equal(call.raw_ref, ids[STRENGTH.activity_id]);
  assert.equal(call.synced_at, SYNCED);
  assert.equal(call.last_written, null);
  assert.equal(api.calls.filter((c) => c.action === 'upsertSyncedWorkout').length, 0, 'no row of its own');
});

test('#155 AC1/AC3: an enrichment is counted, recorded in normalized, and a re-run with nothing new writes nothing', async () => {
  const { drive, archive } = await archiveWith([STRENGTH]);
  const written = { workout_id: 'w_lift0001', filled: ['moving_seconds', 'avg_hr', 'calories'] };
  let linked = false;
  const api = fakeApi({
    enrich: (p) => {
      if (!linked) {
        linked = true;
        return { status: 'enriched', id: 'w_lift0001', linked: true, filled: written.filled, written };
      }
      assert.deepEqual(p.last_written, written, 'the next run sends what the archive recorded');
      return { status: 'unchanged', id: 'w_lift0001', linked: false, filled: [], written };
    },
  });
  const lines = [];
  const first = await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id], syncedAt: SYNCED, log: (l) => lines.push(l) });
  assert.deepEqual({ enriched: first.enriched, unmatched: first.unmatched, failures: first.failures, notes: first.notes },
    { enriched: 1, unmatched: 0, failures: [], notes: [] });
  assert.deepEqual(fileOf(drive, STRENGTH.activity_id).data.normalized, { enrichment: written });
  assert.equal(fileOf(drive, STRENGTH.activity_id).data.payload, STRENGTH.payload, 'the payload is never touched');
  assert.ok(lines.some((l) => /enriched w_lift0001 \(linked; filled moving_seconds, avg_hr, calories\)/.test(l)));

  drive.writes.length = 0;
  const second = await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id], syncedAt: '2026-09-25T15:17:02.000Z', log: () => {} });
  assert.deepEqual({ enriched: second.enriched, unchanged: second.unchanged }, { enriched: 0, unchanged: 1 });
  assert.deepEqual(drive.writes, [], 'normalized unchanged, so nothing written to Drive');
});

test('#155 AC2: no match or an ambiguous one is a note, not a failure, and nothing is recorded', async () => {
  const { drive, archive } = await archiveWith([STRENGTH]);
  for (const [result, expected] of [
    [{ status: 'unmatched', reason: 'no match', candidates: [] },
      `strength ${STRENGTH.activity_id} on 2026-09-23 at 07:30: no match; no workout enriched`],
    [{ status: 'unmatched', reason: 'ambiguous', candidates: [{ id: 'w_a', time: '07:31' }, { id: 'w_b', time: '' }] },
      `strength ${STRENGTH.activity_id} on 2026-09-23 at 07:30: ambiguous (candidates: w_a at 07:31, w_b with no time); no workout enriched`],
  ]) {
    drive.writes.length = 0;
    const api = fakeApi({ enrich: () => result });
    const out = await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id], syncedAt: SYNCED, log: () => {} });
    assert.deepEqual(out.failures, []);
    assert.equal(out.unmatched, 1);
    assert.equal(out.enriched, 0);
    assert.deepEqual(out.notes, [expected]);
    assert.deepEqual(drive.writes, [], 'nothing recorded, so a later run can still match');
    assert.equal(fileOf(drive, STRENGTH.activity_id).data.normalized, null);
  }
});

// --- Hybrid Fitness takes the strength path (#194) ----------------------------

test('#194 AC1/AC2: a Hybrid Fitness session enriches like strength, with moving time withheld', async () => {
  const { archive, ids } = await archiveWith([HYBRID]);
  const written = { workout_id: 'w_lift0002', filled: ['avg_hr', 'calories'] };
  const api = fakeApi({ enrich: () => ({ status: 'enriched', id: 'w_lift0002', linked: true, filled: written.filled, written }) });
  const fit = { ensure: async () => assert.fail('no FIT for Hybrid Fitness') };
  const out = await syncActivities({ archive, api, activityIds: [HYBRID.activity_id], syncedAt: SYNCED, fit, log: () => {} });

  const [call] = enrichCalls(api);
  assert.deepEqual(call.activity, {
    date: '2026-09-25', time: '06:50',
    elapsed_seconds: '1872', moving_seconds: '', avg_hr: '109', calories: '231',
  }, 'Workout Time 31:12 includes the rests, so it is never offered as moving time');
  assert.equal(call.source_activity_id, HYBRID.activity_id);
  assert.equal(call.raw_ref, ids[HYBRID.activity_id]);
  assert.equal(call.synced_at, SYNCED);
  assert.equal(api.calls.filter((c) => c.action === 'upsertSyncedWorkout').length, 0, 'no row of its own');
  assert.deepEqual({ enriched: out.enriched, skipped: out.skipped, failures: out.failures }, { enriched: 1, skipped: 0, failures: [] });
});

test('#194 AC2: a strength session still offers Workout Time as moving time', async () => {
  const { archive } = await archiveWith([STRENGTH, HYBRID]);
  const api = fakeApi();
  await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id, HYBRID.activity_id], syncedAt: SYNCED, log: () => {} });
  const moving = Object.fromEntries(enrichCalls(api).map((c) => [c.source_activity_id, c.activity.moving_seconds]));
  assert.deepEqual(moving, { [STRENGTH.activity_id]: '124', [HYBRID.activity_id]: '' });
});

test('#194 AC3: an unmatched Hybrid Fitness session is a note, not a failure', async () => {
  const { drive, archive } = await archiveWith([HYBRID]);
  const api = fakeApi();
  const out = await syncActivities({ archive, api, activityIds: [HYBRID.activity_id], syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(out.failures, []);
  assert.equal(out.unmatched, 1);
  assert.deepEqual(out.notes, [`strength ${HYBRID.activity_id} on 2026-09-25 at 06:50: no match; no workout enriched`]);
  assert.equal(fileOf(drive, HYBRID.activity_id).data.normalized, null);
});

test('#155: a strength payload with an unrecognized line fails that activity, like any other', async () => {
  const broken = { ...STRENGTH, payload: STRENGTH.payload.replace('Average Heart Rate: 88 bpm', 'Average Heart Rate: 88') };
  const { archive } = await archiveWith([broken]);
  const api = fakeApi();
  const out = await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id], syncedAt: SYNCED, log: () => {} });
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /Average Heart Rate: 88/);
  assert.equal(enrichCalls(api).length, 0);
});

test('#155: an API refusal fails the strength session alone', async () => {
  const { archive } = await archiveWith([STRENGTH, GRAVEL]);
  const api = fakeApi({ fail: { [STRENGTH.activity_id]: new Error('enrichWorkout: 2 Workouts rows are enriched from activity') } });
  const out = await syncActivities({ archive, api, activityIds: [STRENGTH.activity_id, GRAVEL.activity_id], syncedAt: SYNCED, log: () => {} });
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /2 Workouts rows are enriched/);
  assert.equal(out.created, 1);
});
