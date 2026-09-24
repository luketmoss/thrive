// #156 AC4: the dead-man's switch trips on a stale SyncLog, and only then.
// The clock and threshold are injected; no real data is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFreshness, DEFAULT_THRESHOLD_HOURS, parseDeadmanArgs } from '../src/deadman.mjs';
import { ThriveApiError } from '../src/thrive-api.mjs';

const row = (started_at, extra = {}) => ({ run_id: 'schedule-1-1', started_at, status: 'ok', ...extra });
const apiWith = (rows) => ({ async getSyncLog(limit) { assert.equal(limit, 1); return rows; } });
const at = (iso) => new Date(iso);

test('the default threshold is 16 hours', () => {
  assert.equal(DEFAULT_THRESHOLD_HOURS, 16);
});

test('passes at 15.9 hours and at exactly 16, trips just past 16', async () => {
  const api = apiWith([row('2026-09-24T18:17:00.000Z')]);
  assert.equal((await checkFreshness({ api, now: at('2026-09-25T10:11:00Z') })).ok, true);
  assert.equal((await checkFreshness({ api, now: at('2026-09-25T10:17:00Z') })).ok, true);
  const stale = await checkFreshness({ api, now: at('2026-09-25T10:18:00Z') });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /has not run for 16\.0 hours: newest SyncLog row schedule-1-1 started 2026-09-24T18:17:00\.000Z, 16\.0 h ago, status ok; threshold 16 h/);
});

test('a single dropped run never alarms: the longest one-drop gap is 15 hours', async () => {
  // 00:17 UTC skipped: the previous row is 18:17, the next run 09:17.
  const api = apiWith([row('2026-09-24T18:17:00.000Z')]);
  const result = await checkFreshness({ api, now: at('2026-09-25T09:17:00Z') });
  assert.equal(result.ok, true);
});

test('any status counts as a run: a fresh failed row passes', async () => {
  const api = apiWith([row('2026-09-24T18:17:00.000Z', { status: 'failed' })]);
  assert.equal((await checkFreshness({ api, now: at('2026-09-24T19:00:00Z') })).ok, true);
});

test('the threshold can be injected', async () => {
  const api = apiWith([row('2026-09-24T18:17:00.000Z')]);
  const r = await checkFreshness({ api, now: at('2026-09-24T19:17:00Z'), thresholdHours: 0.5 });
  assert.equal(r.ok, false);
  assert.match(r.message, /threshold 0\.5 h/);
});

test('an empty SyncLog trips', async () => {
  const r = await checkFreshness({ api: apiWith([]), now: at('2026-09-24T19:00:00Z') });
  assert.equal(r.ok, false);
  assert.match(r.message, /SyncLog is empty/);
});

test('an unreadable started_at trips', async () => {
  const r = await checkFreshness({ api: apiWith([row('last Tuesday')]), now: at('2026-09-24T19:00:00Z') });
  assert.equal(r.ok, false);
  assert.match(r.message, /unreadable started_at \("last Tuesday"\)/);
});

test('an API that cannot be read trips, naming the error class only', async () => {
  const api = { async getSyncLog() { throw new ThriveApiError('getSyncLog', 'Sheet "SyncLog" not found'); } };
  const r = await checkFreshness({ api, now: at('2026-09-24T19:00:00Z') });
  assert.equal(r.ok, false);
  assert.match(r.message, /Could not read SyncLog \(ThriveApiError, getSyncLog\)/);
});

test('--now and --threshold-hours parse, and default to the clock and 16', () => {
  const parsed = parseDeadmanArgs(['--now', '2026-09-26T00:00:00Z', '--threshold-hours', '2']);
  assert.equal(parsed.now.toISOString(), '2026-09-26T00:00:00.000Z');
  assert.equal(parsed.thresholdHours, 2);
  assert.equal(parseDeadmanArgs([]).thresholdHours, 16);
  assert.equal(parseDeadmanArgs([], { DEADMAN_THRESHOLD_HOURS: '20' }).thresholdHours, 20);
  assert.throws(() => parseDeadmanArgs(['--now', 'soon']), /--now must be an ISO instant/);
  assert.throws(() => parseDeadmanArgs(['--threshold-hours', '0']), /positive number/);
});
