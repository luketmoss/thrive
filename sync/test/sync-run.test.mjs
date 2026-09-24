// #156: every run writes exactly one SyncLog row, its exit code agrees with
// it, and a summary-mode log carries no COROS-derived data. The run's steps
// are fakes here; each is tested on its own elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CorosGrantDeadError, DriveAuthError } from '../src/errors.mjs';
import { buildSyncLogRow, createRunOutput, runIdFor } from '../src/run-log.mjs';
import { REQUIRED_TOOLS } from '../src/ingest.mjs';
import { syncRun } from '../src/sync-run.mjs';
import { ThriveApiError, fitErrorDetail, createThriveApi, MAX_ENCODED_PAYLOAD } from '../src/thrive-api.mjs';
import { scriptedFetch } from './helpers.mjs';

const START = '2026-09-24T09:17:04.512Z';
const END = '2026-09-24T09:17:41.020Z';
const ACTIONS_ENV = {
  GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '36024934026', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule',
};

/** Strings no summary-mode log line may contain: a name, an ID, a quoted line. */
const CANARIES = ['Canyon Loop', '480544748954747182', '1VMEemjfGrOajNaXfH1v7NTll3', 'Resting HR: 57 bpm'];

/** A clock that answers START, then END. */
const clock = () => {
  const times = [START, END];
  return () => new Date(times.length > 1 ? times.shift() : times[0]);
};

/** Fakes for every step, each overridable; `api.rows` collects SyncLog appends. */
function fakes({ ingestResult, sheetResult, api: apiOverride, ...overrides } = {}) {
  const rows = [];
  const api = apiOverride ?? {
    rows,
    async appendSyncLog(row) { rows.push(row); return { status: 'appended', run_id: row.run_id }; },
  };
  const deps = {
    createDrive: () => ({}),
    createTokenStore: () => ({}),
    getAccessToken: async () => ({ accessToken: 'at', refreshed: false }),
    connectCoros: async () => ({
      async listTools() { return { tools: REQUIRED_TOOLS.map((name) => ({ name })) }; },
      async close() {},
    }),
    createArchive: () => ({}),
    ingest: async ({ log }) => {
      log(`  activity 480544748954747182 (Canyon Loop, 2026-09-23): unchanged 1VMEemjfGrOajNaXfH1v7NTll3`);
      return ingestResult ?? {
        window: { start: '2026-09-14', end: '2026-09-25', runDate: '2026-09-24' },
        activities: { created: 0, updated: 0, unchanged: 3 },
        activityIds: ['a1', 'a2', 'a3'],
        failures: [],
        health: 'unchanged',
      };
    },
    writeSheet: async ({ log }) => {
      log('  DailyHealth: 3 dates');
      return sheetResult ?? { activities: { created: 1, updated: 1, unchanged: 1 }, failures: [] };
    },
    createApi: () => api,
    ...overrides,
  };
  return { deps, api, rows: api.rows ?? rows };
}

/** Run with captured output. */
async function run({ env = ACTIONS_ENV, ...fakeOpts } = {}) {
  const f = fakes(fakeOpts);
  const lines = [];
  const output = createRunOutput(env.SYNC_LOG === 'summary' ? 'summary' : 'full', {
    out: (l) => lines.push(l), err: (l) => lines.push(l),
  });
  const result = await syncRun({ env, now: clock(), deps: f.deps, output });
  return { ...result, rows: f.rows, lines, text: lines.join('\n') };
}

test('AC2: run_id names the Actions event, run and attempt, else local-<started_at>', () => {
  assert.equal(runIdFor(ACTIONS_ENV, START), 'schedule-36024934026-1');
  assert.equal(runIdFor({ ...ACTIONS_ENV, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '2' }, START),
    'workflow_dispatch-36024934026-2');
  assert.equal(runIdFor({}, START), `local-${START}`);
});

test('AC2: a clean run writes one ok row with the window and counts, and exits 0', async () => {
  const { exitCode, rows } = await run();
  assert.equal(exitCode, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    run_id: 'schedule-36024934026-1',
    started_at: START,
    finished_at: END,
    window_start: '2026-09-14',
    window_end: '2026-09-25',
    n_seen: 3, n_new: 1, n_updated: 1, n_enriched: 0, n_fit_fetched: 0, n_errors: 0,
    status: 'ok',
    error_detail: '',
  });
});

test('AC2: a run that completes with failures writes a partial row and exits 1', async () => {
  const { exitCode, rows } = await run({
    sheetResult: {
      activities: { created: 0, updated: 0, unchanged: 2 },
      failures: ['activity a2: not written, unrecognized format in getActivityDetail: Distance: 3 furlongs'],
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].n_errors, 1);
  assert.match(rows[0].error_detail, /3 furlongs/);
});

test('AC2: a dead grant aborts the run, and the failed row leads with CorosGrantDeadError', async () => {
  const { exitCode, rows } = await run({
    getAccessToken: async () => { throw new CorosGrantDeadError('invalid_grant'); },
  });
  assert.equal(exitCode, 1);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.status, 'failed');
  assert.equal(row.n_errors, 1);
  assert.equal(row.n_seen, 0);
  assert.match(row.error_detail, /^CorosGrantDeadError: COROS refused the stored refresh token \(invalid_grant\)/);
  // The window is known before anything can fail.
  assert.equal(row.window_start, '2026-09-14');
  assert.equal(row.window_end, '2026-09-25');
});

test('AC2: a Drive credential failure is a failed row too, and the COROS client is never opened', async () => {
  let connected = false;
  const { exitCode, rows } = await run({
    createDrive: () => { throw new DriveAuthError('invalid_grant'); },
    connectCoros: async () => { connected = true; },
  });
  assert.equal(exitCode, 1);
  assert.equal(connected, false);
  assert.match(rows[0].error_detail, /^DriveAuthError: /);
});

test('AC2: failures before the abort are kept in the row after the fatal error', async () => {
  const { rows } = await run({
    ingestResult: {
      window: { start: '2026-09-14', end: '2026-09-25', runDate: '2026-09-24' },
      activities: { created: 0, updated: 0, unchanged: 0 },
      activityIds: ['a1'], failures: ['activity a1: timed out'], health: null,
    },
    writeSheet: async () => { throw new Error('boom'); },
  });
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].n_errors, 2);
  assert.equal(rows[0].n_seen, 1);
  assert.equal(rows[0].error_detail, 'Error: boom\nactivity a1: timed out');
});

test('AC2: a SyncLog row that cannot be written fails a clean run, and says so', async () => {
  const api = { async appendSyncLog() { throw new ThriveApiError('appendSyncLog', 'Sheet "SyncLog" not found'); } };
  const { exitCode, logged, row, text } = await run({ api });
  assert.equal(row.status, 'ok');
  assert.equal(logged, false);
  assert.equal(exitCode, 1);
  assert.match(text, /SyncLog row schedule-36024934026-1 was not written/);
});

test('AC2: missing API secrets cost the sheet and the row, never the archive, and exit 1', async () => {
  let ingested = false;
  const { exitCode, row, logged, text } = await run({
    createApi: () => { throw new ThriveApiError('config', 'THRIVE_API_URL and THRIVE_API_KEY not set'); },
    ingest: async () => {
      ingested = true;
      return { window: {}, activities: { created: 0, updated: 0, unchanged: 0 }, activityIds: [], failures: [], health: null };
    },
  });
  assert.equal(ingested, true);
  assert.equal(logged, false);
  assert.equal(exitCode, 1);
  assert.equal(row.status, 'partial');
  assert.match(text, /SyncLog row schedule-36024934026-1 was not written: config: THRIVE_API_URL and THRIVE_API_KEY not set/);
  const summary = await run({
    env: { ...ACTIONS_ENV, SYNC_LOG: 'summary' },
    createApi: () => { throw new ThriveApiError('config', 'THRIVE_API_URL and THRIVE_API_KEY not set'); },
  });
  assert.match(summary.text, /was not written: ThriveApiError \(config\)\./);
});

test('AC2: secrets are redacted from error_detail', async () => {
  const { registerSecret } = await import('../src/redact.mjs');
  registerSecret('secret-token-abcdefgh');
  const { rows } = await run({ getAccessToken: async () => { throw new Error('saw secret-token-abcdefgh'); } });
  assert.doesNotMatch(rows[0].error_detail, /secret-token-abcdefgh/);
  assert.match(rows[0].error_detail, /\[redacted\]/);
});

test('AC5: summary mode prints counts and the run_id, and no COROS-derived text', async () => {
  const env = { ...ACTIONS_ENV, SYNC_LOG: 'summary' };
  const clean = await run({ env });
  const partial = await run({
    env,
    sheetResult: { activities: { created: 0, updated: 0, unchanged: 0 }, failures: ['health 2026-09-23: not written, unrecognized format in queryRestingHeartRate: Resting HR: 57 bpm'] },
  });
  const failed = await run({
    env,
    getAccessToken: async () => { throw new Error('unreadable sport record: 1. Canyon Loop — 2026-09-23'); },
  });
  for (const r of [clean, partial, failed]) {
    for (const canary of CANARIES) assert.ok(!r.text.includes(canary), `summary log leaked "${canary}":\n${r.text}`);
  }
  assert.match(clean.text, /Run schedule-36024934026-1: ok\. Window 2026-09-14 to 2026-09-25\. 3 activities listed; Workouts 1 created, 1 updated; 0 failure\(s\)\./);
  assert.match(partial.text, /1 failure\(s\)\. They are in SyncLog row schedule-36024934026-1, not in this public log\./);
  assert.match(failed.text, /Aborted by Error\. See "When a run fails" in sync\/README\.md; the message is in SyncLog row schedule-36024934026-1\./);
  // The detail still reaches the private row.
  assert.match(partial.rows[0].error_detail, /Resting HR: 57 bpm/);
});

test('AC5: without SYNC_LOG a run logs in full, as before', async () => {
  const { text } = await run({
    env: {},
    sheetResult: { activities: { created: 0, updated: 0, unchanged: 0 }, failures: ['activity a2: Distance: 3 furlongs'] },
  });
  assert.match(text, /Canyon Loop/);
  assert.match(text, /DailyHealth: 3 dates/);
  assert.match(text, /activity a2: Distance: 3 furlongs/);
});

test('AC2: buildSyncLogRow derives status from what happened', () => {
  const base = { runId: 'r', startedAt: START, finishedAt: END, window: { start: 'a', end: 'b' } };
  assert.equal(buildSyncLogRow(base).status, 'ok');
  assert.equal(buildSyncLogRow({ ...base, failures: ['x'] }).status, 'partial');
  assert.equal(buildSyncLogRow({ ...base, fatal: new Error('y') }).status, 'failed');
});

test('AC2: error_detail is cut to fit the payload limit, and says so', () => {
  const huge = { run_id: 'r', error_detail: 'health 2026-09-23: "quoted" — line\n'.repeat(400) };
  const fitted = fitErrorDetail(huge);
  assert.ok(encodeURIComponent(JSON.stringify({ row: fitted })).length <= MAX_ENCODED_PAYLOAD);
  assert.match(fitted.error_detail, /… \[truncated: \d+ of \d+ characters\]$/);
  assert.ok(fitted.error_detail.startsWith('health 2026-09-23'));
  const small = { run_id: 'r', error_detail: 'short' };
  assert.equal(fitErrorDetail(small), small);
});

test('AC1: the client appends by action appendSyncLog and reads getSyncLog with limit, retrying the read', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { status: 200, body: { success: true, data: { status: 'appended', run_id: 'r' } } },
    { status: 404, body: '<html>Sorry, unable to open the file</html>' },
    { status: 200, body: { success: true, data: [{ run_id: 'r', started_at: START }] } },
  ]);
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/abc/exec', key: 'k-0123456789', fetchImpl, wait: async () => {} });
  assert.deepEqual(await api.appendSyncLog({ run_id: 'r' }), { status: 'appended', run_id: 'r' });
  const first = new URL(calls[0].url).searchParams;
  assert.equal(first.get('action'), 'appendSyncLog');
  assert.deepEqual(JSON.parse(first.get('payload')), { row: { run_id: 'r' } });
  assert.deepEqual(await api.getSyncLog(1), [{ run_id: 'r', started_at: START }]);
  assert.equal(new URL(calls[2].url).searchParams.get('limit'), '1');
});
