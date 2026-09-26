// #215: readings deleted in the Withings app leave BodyMeasurements on the next
// complete run. This deletes user data rows, so the completeness gate, the
// cap (with an empty status-0 answer against a non-empty window), the archive
// mark and the log lines each have their own test. The action's row-drift
// guard and bottom-up deletion are tested against the real Apps Script source
// in apps-script/tests/body-measurements-reconcile.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withingsSyncRun } from '../withings-run.mjs';
import { createRunOutput } from '../src/run-log.mjs';
import { createThriveApi, MAX_ENCODED_PAYLOAD } from '../src/thrive-api.mjs';
import { createWithingsArchive, groupHash } from '../src/withings-archive.mjs';
import {
  DEFAULT_MAX_DELETIONS, maxDeletionsFrom, planReconcile, reconcileDeletions,
} from '../src/withings-reconcile.mjs';
import { NOW, memoryDrive, memoryStore, scriptedFetch } from './helpers.mjs';
import {
  CLIENT_ID, CLIENT_SECRET, HOUR, fakeReconcile, getmeasPage, measureGroup, storedWithings, withingsStatus,
} from './withings-helpers.mjs';

const ENV = {
  WITHINGS_CLIENT_ID: CLIENT_ID,
  WITHINGS_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_RUN_ID: '37000000001',
  GITHUB_RUN_ATTEMPT: '1',
};
const START = new Date(NOW).toISOString();
const retry = { delays: [1, 1], wait: async () => {} };
// NOW is 2026-09-24 in Denver: the window is 2026-08-25 to 2026-09-25.
const FROM = '2026-08-25';
const TO = '2026-09-25';
const at = (iso) => Date.parse(iso) / 1000;
const D101 = at('2026-09-01T13:00:00Z');
const D102 = at('2026-09-10T13:00:00Z');
const D103 = at('2026-09-20T13:00:00Z');
const scale = [{ value: 81234, type: 1, unit: -3 }];

/** A fake API: BodyMeasurements as a Map, the action's double, and every call in order. */
function fakeApi(rows = []) {
  const body = new Map(rows.map((r) => [r.grpid, r]));
  const order = [];
  const reconcileCalls = [];
  const rollupCalls = [];
  const logs = [];
  const reconcile = fakeReconcile(body, reconcileCalls);
  return {
    body, order, reconcileCalls, rollupCalls, logs,
    async upsertBodyMeasurements(list) {
      order.push('upsert');
      let appended = 0;
      let updated = 0;
      for (const r of list) {
        if (body.has(r.grpid)) updated += 1; else appended += 1;
        body.set(r.grpid, r);
      }
      return { appended, updated, batches: 1 };
    },
    async reconcileBodyMeasurements(payload) {
      order.push('reconcile');
      return reconcile(payload);
    },
    async rebuildDailySummary(from, to) {
      order.push('rebuild');
      rollupCalls.push({ from, to });
      return { written: 0, updated: 1, removed: 0 };
    },
    async getSyncLog() { return []; },
    async appendSyncLog(row) { logs.push(row); return { status: 'appended', run_id: row.run_id }; },
  };
}

const sheetRow = (grpid, date) => ({ grpid, date, kind: 'scale', weight_kg: '80', source: 'withings' });
const threeRows = () => [sheetRow('101', '2026-09-01'), sheetRow('102', '2026-09-10'), sheetRow('103', '2026-09-20')];

async function run(responses, { env = ENV, api = fakeApi(), drive = memoryDrive(), mode = 'full', backfill } = {}) {
  const tokens = memoryStore(storedWithings({ expiresInMs: 2 * HOUR }));
  const { fetchImpl } = scriptedFetch(responses);
  const stdout = [];
  const stderr = [];
  const output = createRunOutput(mode, {
    out: (l) => stdout.push(l), err: (l) => stderr.push(l),
    logName: 'WithingsSyncLog', command: 'node withings-run.mjs',
  });
  const res = await withingsSyncRun({
    env, now: () => NOW, fetchImpl, retry, output, backfill,
    deps: { createDrive: () => drive, createTokenStore: () => tokens, createApi: () => api },
  });
  return { ...res, api, drive, stdout, stderr, text: [...stdout, ...stderr].join('\n') };
}

const files = (drive) => [...drive.files.values()].filter((f) => f.mimeType !== 'folder');
const fileFor = (drive, grpid) => files(drive).find((f) => f.props.grpid === String(grpid));

// --- AC1 -----------------------------------------------------------------------

test('AC1: a complete run returning 101 and 103 deletes 102, calling the action once, after the upsert', async () => {
  const api = fakeApi(threeRows());
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], { api });
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(api.reconcileCalls, [{ from: FROM, to: TO, present_grpids: ['101', '103'], max_deletions: 5 }]);
  assert.deepEqual(api.order, ['upsert', 'reconcile', 'rebuild']);
  assert.deepEqual([...api.body.keys()].sort(), ['101', '103']);
  assert.deepEqual(r.result.sheet.reconcile.deleted, ['102']);
  assert.equal(r.row.status, 'ok');
});

test('AC1: rows dated outside the window are never touched, however many there are', async () => {
  const outside = Array.from({ length: 30 }, (_, i) => sheetRow(String(900 + i), i % 2 ? '2026-08-24' : '2026-09-26'));
  const api = fakeApi([...outside, ...threeRows()]);
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], { api });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(api.body.size, 32);
  for (const o of outside) assert.ok(api.body.has(o.grpid));
});

test('AC1: a group that failed to normalize still counts as present, so its row is kept', async () => {
  const api = fakeApi(threeRows());
  const r = await run([getmeasPage([
    measureGroup(101, D101, scale), measureGroup(102, D102, [{ value: 81.2, type: 1, unit: -3 }]),
    measureGroup(103, D103, scale),
  ])], { api });
  assert.deepEqual(api.reconcileCalls[0].present_grpids, ['101', '102', '103']);
  assert.ok(api.body.has('102'));
  assert.equal(r.row.status, 'partial'); // the normalize failure, not a deletion
});

// --- AC2 -----------------------------------------------------------------------

test('AC2: a fetch whose paging failed partway never calls the action, and says so in the full log', async () => {
  const api = fakeApi(threeRows());
  const r = await run([
    getmeasPage([measureGroup(101, D101, scale)], { more: 1, offset: 1 }),
    withingsStatus(2555), withingsStatus(2555), withingsStatus(2555),
  ], { api });
  assert.equal(api.reconcileCalls.length, 0);
  assert.equal(api.body.size, 3);
  assert.match(r.text, /fetch incomplete: deletions not checked/);
  assert.equal(r.result.sheet.reconcile.checked, false);
});

test('AC2: a group that could not be archived makes the fetch incomplete: nothing is deleted', async () => {
  const api = fakeApi(threeRows());
  const drive = memoryDrive();
  const createJson = drive.createJson;
  drive.createJson = async (args) => {
    if (args.props.grpid === '103') throw new Error('Drive 500');
    return createJson(args);
  };
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], { api, drive });
  assert.equal(api.reconcileCalls.length, 0);
  assert.equal(api.body.size, 3);
  assert.match(r.text, /fetch incomplete: deletions not checked/);
});

test('AC2: an upsert that failed is not followed by a deletion check', async () => {
  const api = fakeApi(threeRows());
  api.upsertBodyMeasurements = async () => { throw new Error('upsertBodyMeasurements: boom'); };
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], { api });
  assert.equal(api.reconcileCalls.length, 0);
  assert.equal(api.body.size, 3);
  assert.match(r.text, /deletions not checked/);
});

// --- AC3 -----------------------------------------------------------------------

const sixMissing = () => [
  ...Array.from({ length: 6 }, (_, i) => sheetRow(String(200 + i), `2026-09-0${i + 1}`)),
  sheetRow('101', '2026-09-01'),
];

test('AC3: more than 5 deletions is refused: nothing deleted, the run partial, the message exact', async () => {
  const api = fakeApi(sixMissing());
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], { api });
  assert.equal(api.body.size, 7);
  assert.equal(r.row.status, 'partial');
  assert.equal(r.exitCode, 1);
  assert.match(r.row.error_detail,
    /^refused to delete 6 BodyMeasurements rows \(cap 5\): check Withings, then re-run with WITHINGS_MAX_DELETIONS=6$/m);
  assert.equal(r.row.notes, '');
  // Nothing was deleted, so no rebuild beyond the upsert's own.
  assert.deepEqual(api.order, ['upsert', 'reconcile', 'rebuild']);
});

test('AC3: WITHINGS_MAX_DELETIONS raises the cap for that run', async () => {
  const api = fakeApi(sixMissing());
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], {
    api, env: { ...ENV, GITHUB_EVENT_NAME: 'workflow_dispatch', WITHINGS_MAX_DELETIONS: '6' },
  });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(api.reconcileCalls[0].max_deletions, 6);
  assert.deepEqual([...api.body.keys()], ['101']);
});

test('AC3: an empty status-0 answer against a non-empty window deletes nothing, even under the cap', async () => {
  const api = fakeApi(threeRows());
  const drive = memoryDrive();
  const r = await run([getmeasPage([])], { api, drive });
  assert.deepEqual(api.reconcileCalls, [{ from: FROM, to: TO, present_grpids: [], max_deletions: 5 }]);
  assert.equal(api.body.size, 3);
  assert.equal(r.row.status, 'partial');
  assert.match(r.row.error_detail, /refused to delete 3 BodyMeasurements rows \(cap 5\)/);
  assert.match(r.row.error_detail, /Withings returned no groups/);
  assert.equal(files(drive).length, 0);
});

test('AC3: an owner-set cap confirms an empty answer (every reading in the window deleted)', async () => {
  const api = fakeApi([sheetRow('102', '2026-09-10')]);
  const r = await run([getmeasPage([])], { api, env: { ...ENV, WITHINGS_MAX_DELETIONS: '1' } });
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(api.reconcileCalls[0], { from: FROM, to: TO, present_grpids: [], max_deletions: 1, allow_empty: true });
  assert.equal(api.body.size, 0);
});

test('AC3: a malformed WITHINGS_MAX_DELETIONS deletes nothing and is a failure', async () => {
  const api = fakeApi(threeRows());
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], {
    api, env: { ...ENV, WITHINGS_MAX_DELETIONS: 'lots' },
  });
  assert.equal(api.reconcileCalls.length, 0);
  assert.equal(api.body.size, 3);
  assert.equal(r.row.status, 'partial');
  assert.match(r.row.error_detail, /WITHINGS_MAX_DELETIONS must be a positive integer/);
});

test('maxDeletionsFrom: default 5, a positive integer when set, anything else refused', () => {
  assert.deepEqual(maxDeletionsFrom({}), { max: DEFAULT_MAX_DELETIONS, explicit: false });
  assert.deepEqual(maxDeletionsFrom({ WITHINGS_MAX_DELETIONS: '' }), { max: 5, explicit: false });
  assert.deepEqual(maxDeletionsFrom({ WITHINGS_MAX_DELETIONS: '12' }), { max: 12, explicit: true });
  for (const bad of ['0', '-1', '2.5', 'x', '05']) {
    assert.throws(() => maxDeletionsFrom({ WITHINGS_MAX_DELETIONS: bad }), /positive integer/);
  }
});

// --- the old API: until apps-script is redeployed -----------------------------

test('an API that does not know the action fails only that step: archive, upsert and rebuild still happen', async () => {
  const sent = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    sent.push(action);
    const payload = u.searchParams.get('payload') ? JSON.parse(u.searchParams.get('payload')) : {};
    const reply = action === 'reconcileBodyMeasurements'
      ? { success: false, error: 'Unknown action: "reconcileBodyMeasurements"' }
      : action === 'getSyncLog' ? { success: true, data: [] }
        : action === 'appendSyncLog' ? { success: true, data: { status: 'appended', run_id: payload.row.run_id } }
          : action === 'rebuildDailySummary' ? { success: true, data: { written: 1, updated: 0, removed: 0 } }
            : { success: true, data: { appended: payload.rows.length, updated: 0 } };
    return { status: 200, text: async () => JSON.stringify(reply) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  const drive = memoryDrive();
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], { api, drive });
  assert.equal(files(drive).length, 1);
  assert.deepEqual(sent.filter((a) => a !== 'getSyncLog'),
    ['upsertBodyMeasurements', 'reconcileBodyMeasurements', 'rebuildDailySummary', 'appendSyncLog']);
  assert.equal(r.row.status, 'partial');
  assert.equal(r.row.n_new, 1);
  assert.equal(r.row.n_errors, 1);
  assert.match(r.row.error_detail, /BodyMeasurements deletions not checked: ThriveApiError: reconcileBodyMeasurements: Unknown action/);
  assert.equal(r.logged, true);
});

// --- AC4 -----------------------------------------------------------------------

test('AC4: a deleted row\'s archive file gains deleted_seen_at, payload untouched, and is never deleted', async () => {
  const drive = memoryDrive();
  const api = fakeApi();
  const all = () => getmeasPage([measureGroup(101, D101, scale), measureGroup(102, D102, scale), measureGroup(103, D103, scale)]);
  await run([all()], { api, drive });
  const before = structuredClone(fileFor(drive, 102).data);
  assert.equal(api.body.size, 3);

  const later = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], { api, drive });
  assert.equal(later.exitCode, 0, later.text);
  assert.equal(api.body.has('102'), false);
  const after = fileFor(drive, 102).data;
  assert.equal(after.deleted_seen_at, START);
  assert.deepEqual(after.payload, before.payload);
  assert.equal(after.payload_hash, before.payload_hash);
  assert.equal(after.fetched_at, before.fetched_at);
  assert.equal(files(drive).length, 3);
  assert.equal(fileFor(drive, 101).data.deleted_seen_at, undefined);
});

test('AC4: a reading that reappears is upserted again and loses its deleted_seen_at', async () => {
  const drive = memoryDrive();
  const api = fakeApi();
  const g102 = measureGroup(102, D102, scale);
  await run([getmeasPage([measureGroup(101, D101, scale), g102])], { api, drive });
  await run([getmeasPage([measureGroup(101, D101, scale)])], { api, drive });
  assert.equal(fileFor(drive, 102).data.deleted_seen_at, START);

  const back = await run([getmeasPage([measureGroup(101, D101, scale), structuredClone(g102)])], { api, drive });
  assert.equal(back.exitCode, 0, back.text);
  assert.equal(back.row.n_new, 1);
  assert.ok(api.body.has('102'));
  const file = fileFor(drive, 102);
  assert.equal('deleted_seen_at' in file.data, false);
  assert.equal(file.data.payload_hash, groupHash(g102));
  assert.equal(api.body.get('102').raw_ref, file.id);
});

test('AC4: markDeleted on a group never archived marks nothing', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now: () => NOW });
  assert.equal(await archive.markDeleted('55', START), null);
  assert.equal(drive.writes.length, 0);
});

test('AC4: an archive mark that fails is a failure of its own; the row stays deleted', async () => {
  const drive = memoryDrive();
  const api = fakeApi();
  await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(102, D102, scale)])], { api, drive });
  const update = drive.updateJson;
  drive.updateJson = async () => { throw new Error('Drive 503'); };
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], { api, drive });
  drive.updateJson = update;
  assert.equal(api.body.has('102'), false);
  assert.equal(r.row.status, 'partial');
  assert.match(r.row.error_detail, /Could not mark Withings group 102 deleted in the archive/);
  assert.match(r.row.notes, /deleted in Withings: 1 \(102\)/);
});

// --- AC5 -----------------------------------------------------------------------

test('AC5: the notes line names the grpids; the public summary log carries the count only', async () => {
  const api = fakeApi([...threeRows(), sheetRow('104', '2026-09-21')]);
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], {
    api, mode: 'summary',
  });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(r.row.notes, 'deleted in Withings: 2 (102, 104)');
  assert.match(r.text, /Deleted in Withings: 2\./);
  for (const secret of ['102', '104']) assert.ok(!r.text.includes(secret), `public log contains ${secret}:\n${r.text}`);
});

test('AC5: a run that only deleted rows still rebuilds DailySummary over the window', async () => {
  const drive = memoryDrive();
  const api = fakeApi();
  const g = () => [measureGroup(101, D101, scale), measureGroup(103, D103, scale)];
  await run([getmeasPage([...g(), measureGroup(102, D102, scale)])], { api, drive });
  api.rollupCalls.length = 0;
  api.order.length = 0;
  // Unchanged groups: only the rows re-sent, same values. The fake counts
  // them as updates, so make the second upsert report nothing changed.
  api.upsertBodyMeasurements = async () => { api.order.push('upsert'); return { appended: 0, updated: 0, batches: 1 }; };
  const r = await run([getmeasPage(g())], { api, drive });
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(api.order, ['upsert', 'reconcile', 'rebuild']);
  assert.deepEqual(api.rollupCalls, [{ from: FROM, to: '2026-09-24' }]);
});

test('AC5: a run that neither changed nor deleted anything does not rebuild', async () => {
  const api = fakeApi(threeRows());
  api.upsertBodyMeasurements = async () => ({ appended: 0, updated: 0, batches: 1 });
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(102, D102, scale), measureGroup(103, D103, scale)])], { api });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(api.rollupCalls.length, 0);
});

test('AC5: a backfill applies the same rule over its whole range, under the same cap, and never rebuilds', async () => {
  const old = sheetRow('50', '2019-03-04');
  const api = fakeApi([old, ...threeRows()]);
  const r = await run([getmeasPage([measureGroup(101, D101, scale), measureGroup(103, D103, scale)])], {
    api, backfill: true, env: { ...ENV, GITHUB_EVENT_NAME: 'workflow_dispatch' },
  });
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(api.reconcileCalls, [{ from: '1970-01-01', to: TO, present_grpids: ['101', '103'], max_deletions: 5 }]);
  assert.deepEqual([...api.body.keys()].sort(), ['101', '103']);
  assert.equal(api.rollupCalls.length, 0);
  assert.equal(r.row.notes, 'deleted in Withings: 2 (50, 102)');
});

test('AC5: a backfill over the cap is refused like any run', async () => {
  const api = fakeApi(sixMissing());
  const r = await run([getmeasPage([measureGroup(101, D101, scale)])], { api, backfill: true });
  assert.equal(api.body.size, 7);
  assert.match(r.row.error_detail, /refused to delete 6 BodyMeasurements rows \(cap 5\)/);
});

// --- a range too large for one request ------------------------------------------

test('planReconcile: one request when it fits, covering the window exactly', () => {
  const present = [{ grpid: '1', date: '2026-09-01' }, { grpid: '2', date: '2026-09-02' }, { grpid: '9', date: '2026-10-09' }];
  assert.deepEqual(planReconcile({ from: FROM, to: TO, present }), [
    { from: FROM, to: TO, present_grpids: ['1', '2'] },
  ]);
  assert.deepEqual(planReconcile({ from: FROM, to: TO, present: [] }), [{ from: FROM, to: TO, present_grpids: [] }]);
});

test('planReconcile: thousands of groups split into gapless date ranges, each under the payload limit and none empty', () => {
  const present = [];
  for (let i = 0; i < 3000; i++) {
    const date = new Date(Date.parse('2016-01-01T00:00:00Z') + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10);
    present.push({ grpid: String(1000000000 + i), date });
  }
  const extra = { max_deletions: 5 };
  const chunks = planReconcile({ from: '1970-01-01', to: TO, present, extra });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].from, '1970-01-01');
  assert.equal(chunks.at(-1).to, TO);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    assert.ok(c.present_grpids.length > 0);
    assert.ok(encodeURIComponent(JSON.stringify({ ...c, ...extra })).length <= MAX_ENCODED_PAYLOAD);
    if (i) {
      const next = new Date(Date.parse(`${chunks[i - 1].to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      assert.equal(c.from, next);
    }
  }
  assert.equal(chunks.flatMap((c) => c.present_grpids).length, 3000);
});

test('split requests share one cap: never more than it in total, and a later refusal stops the run', async () => {
  const tab = new Map();
  const groups = [];
  for (let i = 0; i < 1200; i++) {
    const t = Date.parse('2020-01-01T18:00:00Z') + i * 86400000;
    groups.push(measureGroup(1000000000 + i, t / 1000, scale));
    tab.set(String(1000000000 + i), sheetRow(String(1000000000 + i), new Date(t).toISOString().slice(0, 10)));
  }
  // Four rows Withings no longer returns: two early, two late.
  for (const [g, d] of [['11', '2020-01-02'], ['12', '2020-01-03'], ['13', '2023-01-02'], ['14', '2023-01-03']]) {
    tab.set(g, sheetRow(g, d));
  }
  const calls = [];
  const api = { reconcileBodyMeasurements: fakeReconcile(tab, calls) };
  const archive = { markDeleted: async () => null };
  const res = await reconcileDeletions({
    api, archive, from: '1970-01-01', to: TO, groups, env: { WITHINGS_MAX_DELETIONS: '3' }, at: START,
  });
  assert.ok(calls.length > 1);
  assert.ok(res.deleted.length <= 3);
  assert.deepEqual(res.deleted, ['11', '12']);
  assert.match(res.refused, /refused to delete 4 BodyMeasurements rows \(cap 3\)/);
  assert.ok(tab.has('13') && tab.has('14'));
  // Each request after the first was offered only what was left of the cap.
  assert.equal(calls[0].max_deletions, 3);
  assert.ok(calls.slice(1).every((c) => c.max_deletions === 1));
});
