// #200 AC3: the Withings watchdog reads only WithingsSyncLog, at 14 hours, and
// the COROS check (no --log) reads only SyncLog, exactly as before. A fresh
// WithingsSyncLog row can never satisfy the COROS check, nor the reverse.
// deadman.test.mjs, #156's, runs unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFreshness, DEFAULT_THRESHOLD_HOURS, parseDeadmanArgs, WITHINGS_THRESHOLD_HOURS,
} from '../src/deadman.mjs';
import { createThriveApi, ThriveApiError } from '../src/thrive-api.mjs';

const row = (run_id, started_at, extra = {}) => ({ run_id, started_at, status: 'ok', ...extra });
const at = (iso) => new Date(iso);

/** Both tabs behind the real client, served by the `log` query parameter. */
function twoLogApi({ SyncLog = [], WithingsSyncLog = [] }) {
  const requests = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    requests.push(Object.fromEntries(u.searchParams));
    const log = u.searchParams.get('log');
    if (log !== null && log !== 'withings') {
      return { status: 200, text: async () => JSON.stringify({ success: false, error: 'bad log' }) };
    }
    const tab = log === 'withings' ? WithingsSyncLog : SyncLog;
    const limit = Number(u.searchParams.get('limit'));
    return { status: 200, text: async () => JSON.stringify({ success: true, data: tab.slice(0, limit) }) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  return { api, requests };
}

const staleCoros = [row('schedule-1-1', '2026-09-24T00:17:00.000Z')];
const freshWithings = [row('schedule-9-1', '2026-09-25T13:41:00.000Z')];
const NOW = at('2026-09-25T14:00:00Z');

test('AC3: a fresh WithingsSyncLog row does not satisfy the COROS check', async () => {
  const { api, requests } = twoLogApi({ SyncLog: staleCoros, WithingsSyncLog: freshWithings });
  const r = await checkFreshness({ api, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.message, /The COROS sync has not run for 37\.7 hours: newest SyncLog row schedule-1-1/);
  // The COROS request is the one before #200: no log parameter at all.
  assert.deepEqual(requests.map((q) => [q.action, q.limit, q.log]), [['getSyncLog', '1', undefined]]);
});

test('AC3: an empty SyncLog stays empty to the COROS check whatever WithingsSyncLog holds', async () => {
  const { api } = twoLogApi({ SyncLog: [], WithingsSyncLog: freshWithings });
  const r = await checkFreshness({ api, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.message, /SyncLog is empty: the COROS sync has never recorded a run \(threshold 16 h\)/);
});

test('AC3: a fresh SyncLog row does not satisfy the Withings check', async () => {
  const { api, requests } = twoLogApi({ SyncLog: [row('schedule-2-1', '2026-09-25T13:17:00.000Z')], WithingsSyncLog: [] });
  const r = await checkFreshness({ api, now: NOW, log: 'withings' });
  assert.equal(r.ok, false);
  assert.match(r.message, /WithingsSyncLog is empty: the Withings sync has never recorded a run \(threshold 14 h\)/);
  assert.deepEqual(requests.map((q) => [q.action, q.limit, q.log]), [['getSyncLog', '1', 'withings']]);
});

test('AC3: the Withings default is 14 hours: passes at 14, trips just past, naming the Withings sync', async () => {
  assert.equal(WITHINGS_THRESHOLD_HOURS, 14);
  assert.equal(DEFAULT_THRESHOLD_HOURS, 16, 'COROS keeps 16');
  const { api } = twoLogApi({ WithingsSyncLog: [row('schedule-9-1', '2026-09-25T01:41:00.000Z', { status: 'failed' })] });
  assert.equal((await checkFreshness({ api, now: at('2026-09-25T15:41:00Z'), log: 'withings' })).ok, true);
  const stale = await checkFreshness({ api, now: at('2026-09-25T15:42:00Z'), log: 'withings' });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /^The Withings sync has not run for 14\.0 hours: newest WithingsSyncLog row schedule-9-1 started 2026-09-25T01:41:00\.000Z, 14\.0 h ago, status failed; threshold 14 h\. Check Actions → withings-sync/);
});

test('AC3: a single dropped Withings run never alarms: 12 h plus an hour of delay', async () => {
  const { api } = twoLogApi({ WithingsSyncLog: [row('schedule-9-1', '2026-09-25T01:41:00.000Z')] });
  const r = await checkFreshness({ api, now: at('2026-09-25T14:41:00Z'), log: 'withings' });
  assert.equal(r.ok, true);
  assert.match(r.message, /^The Withings sync is running: newest WithingsSyncLog row/);
});

test('AC3: an unreadable WithingsSyncLog trips, naming the tab and the Withings sync', async () => {
  const api = { async getSyncLog(limit, opts) {
    assert.deepEqual([limit, opts], [1, { log: 'withings' }]);
    throw new ThriveApiError('getSyncLog', 'Sheet "WithingsSyncLog" not found');
  } };
  const r = await checkFreshness({ api, now: NOW, log: 'withings' });
  assert.equal(r.ok, false);
  assert.match(r.message, /Could not read WithingsSyncLog \(ThriveApiError, getSyncLog\), so nobody can tell whether the Withings sync is running/);
});

test('AC3: --log withings selects the Withings log and its 14 h default; no flag is COROS at 16', () => {
  assert.deepEqual(
    (({ log, thresholdHours }) => ({ log, thresholdHours }))(parseDeadmanArgs(['--log', 'withings'])),
    { log: 'withings', thresholdHours: 14 },
  );
  assert.deepEqual(
    (({ log, thresholdHours }) => ({ log, thresholdHours }))(parseDeadmanArgs([])),
    { log: 'coros', thresholdHours: 16 },
  );
  assert.equal(parseDeadmanArgs(['--log', 'withings', '--threshold-hours', '2']).thresholdHours, 2);
  assert.throws(() => parseDeadmanArgs(['--log', 'garmin']), /--log must be one of coros, withings, got "garmin"/);
  assert.throws(() => parseDeadmanArgs(['--log']), /--log must be one of/);
});

test('the client: getSyncLog and appendSyncLog send no log parameter unless asked', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    seen.push({ action: u.searchParams.get('action'), log: u.searchParams.get('log'),
      payload: u.searchParams.get('payload') && JSON.parse(u.searchParams.get('payload')) });
    return { status: 200, text: async () => JSON.stringify({ success: true, data: [] }) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  await api.getSyncLog(1);
  await api.getSyncLog(1, { log: 'withings' });
  const r = row('local-1', '2026-09-25T13:41:00.000Z');
  await api.appendSyncLog(r);
  await api.appendSyncLog(r, { log: 'withings' });
  assert.deepEqual(seen.map((s) => [s.action, s.log]), [
    ['getSyncLog', null], ['getSyncLog', 'withings'], ['appendSyncLog', null], ['appendSyncLog', null],
  ]);
  assert.deepEqual(Object.keys(seen[2].payload), ['row']);
  assert.deepEqual(seen[3].payload, { row: r, log: 'withings' });
});

test('the client: a long error_detail is cut so the payload with its log field still fits', async () => {
  const { MAX_ENCODED_PAYLOAD } = await import('../src/thrive-api.mjs');
  let size = 0;
  let payload;
  const fetchImpl = async (url) => {
    const raw = new URL(url).searchParams.get('payload');
    size = encodeURIComponent(raw).length;
    payload = JSON.parse(raw);
    return { status: 200, text: async () => JSON.stringify({ success: true, data: { status: 'appended' } }) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  await api.appendSyncLog(row('local-1', '2026-09-25T13:41:00.000Z', { error_detail: 'é'.repeat(4000) }), { log: 'withings' });
  assert.ok(size <= MAX_ENCODED_PAYLOAD, `${size} > ${MAX_ENCODED_PAYLOAD}`);
  assert.equal(payload.log, 'withings');
  assert.match(payload.row.error_detail, /\[truncated: /);
});
