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
function fakeApi({ rows = new Map(), fail = {} } = {}) {
  const calls = [];
  let seq = 0;
  return {
    calls,
    rows,
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
  assert.deepEqual({ created: out.created, updated: out.updated, skipped: out.skipped }, { created: 4, updated: 0, skipped: 2 });
  assert.equal(api.calls.length, 4);
  for (const call of api.calls) {
    assert.equal(call.source, 'coros');
    assert.equal(call.raw_ref, ids[call.source_activity_id], 'raw_ref is the archive file ID');
    assert.equal(call.synced_at, SYNCED);
    assert.equal(call.last_written, null, 'a first sync has nothing to compare');
  }
  const typed = Object.fromEntries(api.calls.map((c) => [c.incoming.name, `${c.incoming.type}/${c.incoming.sub_type}`]));
  assert.deepEqual(typed, {
    'Gravel Bike': 'bike/gravel', Walk: 'walk/outdoor', Hike: 'hike/', 'Indoor Cycling': 'bike/indoor',
  });
  // AC1: strength is left to #155, and gym cardio (400) is logged with its ID and code.
  assert.ok(lines.some((l) => l.includes(STRENGTH.activity_id) && /left to #155/.test(l)));
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
