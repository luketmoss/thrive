// #200: every scheduled Withings run writes exactly one WithingsSyncLog row,
// never a SyncLog one; its exit code agrees with the row (AC2); and in summary
// mode the public log carries counts and class names only (AC4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withingsSyncRun } from '../withings-run.mjs';
import { createRunOutput } from '../src/run-log.mjs';
import { createThriveApi } from '../src/thrive-api.mjs';
import { NOW, memoryDrive, memoryStore, scriptedFetch } from './helpers.mjs';
import {
  CLIENT_ID, CLIENT_SECRET, HOUR, getmeasPage, measureGroup, storedWithings, withingsStatus,
} from './withings-helpers.mjs';

const ACTIONS_ENV = {
  WITHINGS_CLIENT_ID: CLIENT_ID,
  WITHINGS_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_RUN_ID: '37000000001',
  GITHUB_RUN_ATTEMPT: '1',
};
const RUN_ID = 'schedule-37000000001-1';
const START = new Date(NOW).toISOString();
const retry = { delays: [1, 1], wait: async () => {} };
const D1 = Date.parse('2026-09-20T13:00:00Z') / 1000;
const D2 = Date.parse('2026-08-31T12:00:00Z') / 1000;
const scale = [{ value: 81234, type: 1, unit: -3 }, { value: 18500, type: 6, unit: -3 }];
const bp = [{ value: 121, type: 10, unit: 0 }, { value: 78, type: 9, unit: 0 }, { value: 64, type: 11, unit: 0 }];

/**
 * A fake Thrive API with BodyMeasurements and both log tabs, the append
 * guarded by run_id as appendSyncLog's is.
 */
function fakeApi({ appendFails } = {}) {
  const body = new Map();
  const logs = { SyncLog: [], WithingsSyncLog: [] };
  const appends = [];
  const rollupCalls = [];
  return {
    body, logs, appends, rollupCalls,
    syncedAt: [],
    async upsertBodyMeasurements(rows, syncedAt) {
      this.syncedAt.push(syncedAt);
      let appended = 0;
      let updated = 0;
      for (const r of rows) {
        if (body.has(r.grpid)) updated += 1; else appended += 1;
        body.set(r.grpid, r);
      }
      return { appended, updated, batches: 1 };
    },
    // #203: rebuilt once, after the upsert, whenever a row changed.
    async rebuildDailySummary(from, to, computedAt) {
      rollupCalls.push({ from, to, computedAt });
      return { written: 1, updated: 0, removed: 0 };
    },
    async getSyncLog(limit, opts) {
      const tab = opts?.log === 'withings' ? logs.WithingsSyncLog : logs.SyncLog;
      return [...tab].reverse().slice(0, limit);
    },
    async appendSyncLog(row, opts) {
      appends.push(opts);
      if (appendFails) throw appendFails;
      const tab = opts?.log === 'withings' ? logs.WithingsSyncLog : logs.SyncLog;
      if (tab.some((r) => r.run_id === row.run_id)) return { status: 'exists', run_id: row.run_id };
      tab.push(row);
      return { status: 'appended', run_id: row.run_id };
    },
  };
}

async function run(responses, { env = ACTIONS_ENV, api = fakeApi(), drive = memoryDrive(), mode = 'full', store } = {}) {
  const tokens = store ?? memoryStore(storedWithings({ expiresInMs: 2 * HOUR }));
  const { fetchImpl } = scriptedFetch(responses);
  const stdout = [];
  const stderr = [];
  const output = createRunOutput(mode, {
    out: (l) => stdout.push(l), err: (l) => stderr.push(l),
    logName: 'WithingsSyncLog', command: 'node withings-run.mjs',
  });
  const res = await withingsSyncRun({
    env, now: () => NOW, fetchImpl, retry, output,
    deps: { createDrive: () => drive, createTokenStore: () => tokens, createApi: () => api },
  });
  return { ...res, api, drive, stdout, stderr, text: [...stdout, ...stderr].join('\n') };
}

test('AC2: a clean run appends one ok row to WithingsSyncLog, none to SyncLog, and exits 0', async () => {
  const r = await run([getmeasPage([measureGroup(1, D1, scale), measureGroup(2, D2, bp)])]);
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(r.api.appends, [{ log: 'withings' }]);
  assert.equal(r.api.logs.SyncLog.length, 0);
  assert.equal(r.api.logs.WithingsSyncLog.length, 1);
  assert.deepEqual(r.row, {
    run_id: RUN_ID,
    started_at: START,
    finished_at: START,
    window_start: '2026-08-25',
    window_end: '2026-09-25',
    n_seen: 2,
    n_new: 2,
    n_updated: 0,
    n_enriched: 0,
    n_fit_fetched: 0,
    n_errors: 0,
    status: 'ok',
    error_detail: '',
    notes: '',
  });
  assert.deepEqual(r.api.logs.WithingsSyncLog[0], r.row);
  // One timestamp: started_at is every row's synced_at, as with COROS.
  assert.deepEqual(r.api.syncedAt, [START]);
  assert.equal(r.api.body.size, 2);
});

test('AC2: a re-run counts BodyMeasurements rows changed as n_updated', async () => {
  const api = fakeApi();
  const drive = memoryDrive();
  const page = () => getmeasPage([measureGroup(1, D1, scale), measureGroup(2, D2, bp)]);
  await run([page()], { api, drive });
  const again = await run([page()], { api, drive, env: { ...ACTIONS_ENV, GITHUB_RUN_ID: '37000000002' } });
  assert.equal(again.exitCode, 0);
  assert.equal(again.row.n_new, 0);
  assert.equal(again.row.n_updated, 2);
  assert.equal(api.logs.WithingsSyncLog.length, 2);
});

test('AC2: unattributed groups go to notes with grpid and attrib, and are not a failure', async () => {
  const r = await run([getmeasPage([measureGroup(1, D1, scale), measureGroup(2, D1, scale, { attrib: 1 })])]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.row.status, 'ok');
  assert.equal(r.row.notes, 'Skipped 1 unattributed Withings group(s): grpid 2 (attrib 1)');
});

test('AC2: a malformed group and a Drive failure make the run partial, naming each, and exit 1', async () => {
  const drive = memoryDrive();
  const createJson = drive.createJson;
  drive.createJson = async (args) => {
    if (args.props.grpid === '4') throw new Error('Drive 500: backend error');
    return createJson(args);
  };
  const r = await run([getmeasPage([
    measureGroup(1, D1, scale),
    measureGroup(3, D1, [{ value: 81.2, type: 1, unit: -3 }]),
    measureGroup(4, D2, bp),
  ])], { drive });
  assert.equal(r.exitCode, 1);
  assert.equal(r.row.status, 'partial');
  assert.equal(r.row.n_errors, 2);
  assert.equal(r.row.n_seen, 3);
  assert.equal(r.row.n_new, 1);
  assert.match(r.row.error_detail, /Could not archive Withings group 4: Error: Drive 500/);
  assert.match(r.row.error_detail, /Could not normalize Withings group 3 type 1/);
  assert.equal(r.api.logs.WithingsSyncLog.length, 1);
});

test('AC2: an aborted run (a dead grant) still writes one failed row, led by the error class, and exits 1', async () => {
  const r = await run([withingsStatus(401)]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.api.logs.WithingsSyncLog.length, 1);
  assert.equal(r.row.status, 'failed');
  assert.equal(r.row.n_errors, 1);
  assert.match(r.row.error_detail, /^WithingsGrantDeadError: /);
  assert.equal(r.row.window_start, '2026-08-25');
});

test('AC2: no token file aborts before fetching, and the row is still written', async () => {
  const store = memoryStore(null);
  store.tokens = null;
  const r = await run([], { store });
  assert.equal(r.exitCode, 1);
  assert.equal(r.row.status, 'failed');
  assert.match(r.row.error_detail, /^WithingsGrantDeadError: /);
  assert.equal(r.api.logs.WithingsSyncLog.length, 1);
});

test('AC2: a page that fails mid-fetch fails the run; the groups before it still land', async () => {
  const r = await run([
    getmeasPage([measureGroup(1, D1, scale)], { more: 1, offset: 1 }),
    withingsStatus(2555), withingsStatus(2555), withingsStatus(2555),
  ]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.row.status, 'failed');
  assert.equal(r.row.n_seen, 1);
  assert.equal(r.row.n_new, 1);
  assert.match(r.row.error_detail, /^WithingsUnavailableError: /);
});

test('AC2: a row that cannot be written fails a clean run, and says so', async () => {
  const api = fakeApi({ appendFails: Object.assign(new Error('Sheet "WithingsSyncLog" not found'), { name: 'ThriveApiError', action: 'appendSyncLog' }) });
  const r = await run([getmeasPage([measureGroup(1, D1, scale)])], { api });
  assert.equal(r.row.status, 'ok');
  assert.equal(r.logged, false);
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /WithingsSyncLog row schedule-37000000001-1 was not written/);
});

test('AC2: missing THRIVE_API_URL/KEY costs the sheet write and the row, never the archive', async () => {
  const drive = memoryDrive();
  const { fetchImpl } = scriptedFetch([getmeasPage([measureGroup(1, D1, scale)])]);
  const lines = [];
  const output = createRunOutput('full', { out: (l) => lines.push(l), err: (l) => lines.push(l), logName: 'WithingsSyncLog' });
  const r = await withingsSyncRun({
    env: ACTIONS_ENV, now: () => NOW, fetchImpl, retry, output,
    deps: { createDrive: () => drive, createTokenStore: () => memoryStore(storedWithings({ expiresInMs: 2 * HOUR })) },
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.logged, false);
  assert.equal(r.row.status, 'partial');
  assert.match(r.row.error_detail, /BodyMeasurements not written: ThriveApiError/);
  assert.equal([...drive.files.values()].filter((f) => f.mimeType !== 'folder').length, 1, 'the archive landed');
  assert.match(lines.join('\n'), /WithingsSyncLog row schedule-37000000001-1 was not written: config: THRIVE_API_URL and THRIVE_API_KEY not set/);
});

test('AC2: a re-sent run_id is not appended twice', async () => {
  const api = fakeApi();
  const drive = memoryDrive();
  await run([getmeasPage([measureGroup(1, D1, scale)])], { api, drive });
  const again = await run([getmeasPage([measureGroup(1, D1, scale)])], { api, drive });
  assert.equal(again.exitCode, 0);
  assert.equal(api.logs.WithingsSyncLog.length, 1);
  assert.match(again.text, /WithingsSyncLog row schedule-37000000001-1 already present/);
});

test('AC2: through the real client, the row is sent to appendSyncLog with log=withings', async () => {
  const sent = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (action === 'getSyncLog') {
      sent.push({ action, log: u.searchParams.get('log') });
      return { status: 200, text: async () => JSON.stringify({ success: true, data: [] }) };
    }
    const payload = JSON.parse(u.searchParams.get('payload'));
    sent.push({ action, payload });
    const data = action === 'appendSyncLog' ? { status: 'appended', run_id: payload.row.run_id }
      : action === 'rebuildDailySummary' ? { written: 1, updated: 0, removed: 0 }
      : { appended: payload.rows.length, updated: 0 };
    return { status: 200, text: async () => JSON.stringify({ success: true, data }) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  const r = await run([getmeasPage([measureGroup(1, D1, scale)])], { api });
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(sent.filter((s) => s.action === 'getSyncLog').map((s) => s.log), [null, 'withings']);
  const log = sent.filter((s) => s.action === 'appendSyncLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.log, 'withings');
  assert.equal(log[0].payload.row.run_id, RUN_ID);
});

test('AC3: an API that ignores log (older than #200) gets no row, so SyncLog stays COROS-only', async () => {
  // The old API: both reads and the append go to SyncLog.
  const api = fakeApi();
  api.logs.SyncLog.push({ run_id: 'schedule-1-1', started_at: '2026-09-24T09:17:00.000Z', status: 'ok' });
  api.getSyncLog = async (limit) => [...api.logs.SyncLog].reverse().slice(0, limit);
  const append = api.appendSyncLog;
  api.appendSyncLog = (row) => append(row);
  const r = await run([getmeasPage([measureGroup(1, D1, scale)])], { api, mode: 'summary' });
  assert.equal(r.exitCode, 1);
  assert.equal(r.logged, false);
  assert.deepEqual(api.logs.SyncLog.map((x) => x.run_id), ['schedule-1-1']);
  assert.match(r.text, /WithingsSyncLog row schedule-37000000001-1 was not written: ApiIgnoresLogError \(getSyncLog\)/);
});

test('AC3: a log read that fails does not block the append', async () => {
  const api = fakeApi();
  api.getSyncLog = async () => { throw new Error('unreachable'); };
  const r = await run([getmeasPage([measureGroup(1, D1, scale)])], { api });
  assert.equal(r.exitCode, 0);
  assert.equal(api.logs.WithingsSyncLog.length, 1);
});

// --- AC4: the public log ------------------------------------------------------

test('AC4: summary mode prints counts, dates, status, run_id and class names only', async () => {
  const drive = memoryDrive();
  const createJson = drive.createJson;
  drive.createJson = async (args) => {
    if (args.props.grpid === '777001') throw new Error('Drive 500 for grpid 777001');
    return createJson(args);
  };
  const r = await run([
    getmeasPage([
      measureGroup(777001, D1, scale, { model: 'Body+ Secret Model' }),
      measureGroup(777002, D1, [{ value: 81.2, type: 1, unit: -3 }], { model: 'Body+ Secret Model' }),
      measureGroup(777003, D1, scale, { attrib: 1, model: 'Body+ Secret Model' }),
      measureGroup(777004, D2, bp, { model: 'BPM Secret Cuff' }),
    ], { more: 1, offset: 4 }),
    withingsStatus(2555, 'withings says something private'),
    withingsStatus(2555, 'withings says something private'),
    withingsStatus(2555, 'withings says something private'),
  ], { drive, mode: 'summary' });

  assert.equal(r.exitCode, 1);
  assert.equal(r.row.status, 'failed');
  // The private record has the detail...
  assert.match(r.row.error_detail, /777001/);
  assert.match(r.row.notes, /grpid 777003 \(attrib 1\)/);

  // ...the public log does not.
  const text = r.text;
  for (const secret of ['777001', '777002', '777003', '777004', 'grpid',
    '81234', '81.234', '18500', '18.5', '121', 'Body+', 'Secret', 'BPM', 'private', 'Drive 500']) {
    assert.ok(!text.includes(secret), `public log contains "${secret}":\n${text}`);
  }
  assert.doesNotMatch(text, /\battrib\b/);
  // It does carry the run, the window, the counts, the status and the class.
  assert.match(text, /Run schedule-37000000001-1: failed\. Window 2026-08-25 to 2026-09-25\. 4 measure groups fetched/);
  assert.match(text, /Aborted by WithingsUnavailableError/);
  assert.match(text, /They are in WithingsSyncLog row schedule-37000000001-1, not in this public log\./);
});

test('AC4: full mode, as a local run uses, still prints the detail', async () => {
  const r = await run([getmeasPage([measureGroup(1, D1, scale), measureGroup(2, D1, scale, { attrib: 1 })])]);
  assert.match(r.text, /grpid 2 \(attrib 1\)/);
});

// --- #199: the backfill dispatch ---------------------------------------------

const DISPATCH_ENV = {
  WITHINGS_CLIENT_ID: CLIENT_ID,
  WITHINGS_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_RUN_ID: '38000000001',
  GITHUB_RUN_ATTEMPT: '1',
  BACKFILL: 'true',
};

test('AC1: BACKFILL=true writes one row with run_id workflow_dispatch-… and window_start 1970-01-01', async () => {
  const r = await run([getmeasPage([measureGroup(1, D1, scale), measureGroup(2, D2, bp)])], { env: DISPATCH_ENV });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(r.row.run_id, 'workflow_dispatch-38000000001-1');
  assert.equal(r.row.window_start, '1970-01-01');
  assert.equal(r.api.logs.WithingsSyncLog.length, 1);
  assert.deepEqual(r.api.logs.WithingsSyncLog[0], r.row);
});

test('AC1: the backfill fetches from startdate 0, not the rolling window', async () => {
  const { fetchImpl, calls } = scriptedFetch([getmeasPage([measureGroup(1, D1, scale)])]);
  const stdout = [];
  const output = createRunOutput('full', { out: (l) => stdout.push(l), err: () => {}, logName: 'WithingsSyncLog' });
  await withingsSyncRun({
    env: DISPATCH_ENV, now: () => NOW, fetchImpl, retry, output,
    deps: { createDrive: () => memoryDrive(), createTokenStore: () => memoryStore(storedWithings({ expiresInMs: 2 * HOUR })), createApi: () => fakeApi() },
  });
  assert.equal(calls[0].form.startdate, '0');
});

test('AC1: an explicit backfill: true option overrides env, and false stays the rolling window even with BACKFILL set', async () => {
  const { fetchImpl: fetchTrue, calls: callsTrue } = scriptedFetch([getmeasPage([])]);
  await withingsSyncRun({
    env: { WITHINGS_CLIENT_ID: CLIENT_ID, WITHINGS_CLIENT_SECRET: CLIENT_SECRET }, now: () => NOW, fetchImpl: fetchTrue, retry, backfill: true,
    deps: { createDrive: () => memoryDrive(), createTokenStore: () => memoryStore(storedWithings({ expiresInMs: 2 * HOUR })), createApi: () => fakeApi() },
  });
  assert.equal(callsTrue[0].form.startdate, '0');

  const { fetchImpl: fetchFalse, calls: callsFalse } = scriptedFetch([getmeasPage([])]);
  await withingsSyncRun({
    env: { ...DISPATCH_ENV, BACKFILL: 'true' }, now: () => NOW, fetchImpl: fetchFalse, retry, backfill: false,
    deps: { createDrive: () => memoryDrive(), createTokenStore: () => memoryStore(storedWithings({ expiresInMs: 2 * HOUR })), createApi: () => fakeApi() },
  });
  assert.notEqual(callsFalse[0].form.startdate, '0');
});

test('AC2: a backfill that stopped partway is still safe to re-dispatch: no duplicate rows, no duplicate WithingsSyncLog', async () => {
  const drive = memoryDrive();
  const api = fakeApi();
  const groups = Array.from({ length: 6 }, (_, i) => measureGroup(6000 + i, D1 - i * 86400, scale));

  const partial = await run([
    getmeasPage(groups.slice(0, 3), { more: 1, offset: 3 }),
    withingsStatus(2555), withingsStatus(2555), withingsStatus(2555),
  ], { env: { ...DISPATCH_ENV }, api, drive });
  assert.equal(partial.exitCode, 1);
  assert.equal(partial.row.status, 'failed');

  const resumed = await run([getmeasPage(groups)], {
    env: { ...DISPATCH_ENV, GITHUB_RUN_ID: '38000000002' }, api, drive,
  });
  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.row.n_new, 3, 'only the 3 groups not archived the first time are new to BodyMeasurements');
  assert.equal(resumed.row.n_updated, 3);
  assert.equal(api.logs.WithingsSyncLog.length, 2);
  assert.equal(api.body.size, 6, 'no duplicate BodyMeasurements row per grpid');
});
