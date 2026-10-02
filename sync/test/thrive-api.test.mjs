// #165: the sync's Thrive API client. No network: fetch is scripted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHealthBundle } from '../src/normalize-health.mjs';
import {
  chunkByPayload, createThriveApi, loadThriveApiConfig, MAX_ENCODED_PAYLOAD, ThriveApiError,
} from '../src/thrive-api.mjs';
import { clearSecrets, redact } from '../src/redact.mjs';
import { scriptedFetch } from './helpers.mjs';

const URL_ = 'https://script.google.com/macros/s/abc/exec';
const KEY = 'test-api-key-0123456789';
/** The API's own limit on a decoded payload (MAX_PAYLOAD_CHARS in types.js). */
const MAX_PAYLOAD_CHARS = 6000;
const SYNCED = '2026-09-24T13:25:32.000Z';

const ok = (data) => ({ status: 200, body: { success: true, data } });
const api = (responses, opts = {}) => {
  const { fetchImpl, calls } = scriptedFetch(responses);
  return { client: createThriveApi({ url: URL_, key: KEY, fetchImpl, wait: async () => {}, ...opts }), calls };
};
const params = (call) => Object.fromEntries(new URL(call.url).searchParams);

/** Eleven full rows: the window at its widest, every field carrying a value. */
function elevenDays() {
  const b = JSON.parse(readFileSync(new URL('./fixtures/health-2026-09-24.json', import.meta.url), 'utf8'));
  const full = parseHealthBundle(b, { rawRef: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }).rows[1];
  return Array.from({ length: 11 }, (_, i) => ({
    ...full, date: `2026-09-${String(14 + i).padStart(2, '0')}`,
    ...(i === 10 ? { vo2max: '51.5', recovery: '100' } : {}),
  }));
}

test('config: both variables are required, and the key is registered for redaction', () => {
  clearSecrets();
  assert.throws(() => loadThriveApiConfig({}), /THRIVE_API_URL and THRIVE_API_KEY not set/);
  assert.throws(() => loadThriveApiConfig({ THRIVE_API_URL: URL_ }), /THRIVE_API_KEY not set/);
  assert.deepEqual(loadThriveApiConfig({ THRIVE_API_URL: URL_, THRIVE_API_KEY: KEY }), { url: URL_, key: KEY });
  assert.equal(redact(`?key=${KEY}`), '?key=[redacted]');
});

test('a write goes by GET with the action, the key and a JSON payload', async () => {
  const { client, calls } = api([ok({ written: 1 })]);
  await client.rebuildDailySummary('2026-09-14', '2026-09-24', SYNCED);
  const p = params(calls[0]);
  assert.equal(p.action, 'rebuildDailySummary');
  assert.equal(p.key, KEY);
  assert.deepEqual(JSON.parse(p.payload), { from: '2026-09-14', to: '2026-09-24', computed_at: SYNCED });
});

test('AC4: the window\'s rows go in batches that each stay under the payload limit', async () => {
  const rows = elevenDays();
  // One batch would not fit: this is the case the batching exists for.
  const whole = encodeURIComponent(JSON.stringify({ rows, synced_at: SYNCED })).length;
  assert.ok(whole > MAX_ENCODED_PAYLOAD, `11 rows encode to ${whole}`);

  const responses = Array.from({ length: 11 }, () => ok({ appended: 0, updated: 0 }));
  const { client, calls } = api(responses);
  const totals = await client.upsertDailyHealth(rows, SYNCED);

  assert.ok(calls.length >= 2, `${calls.length} batches`);
  const sent = [];
  for (const call of calls) {
    const raw = params(call).payload;
    assert.ok(raw.length < MAX_PAYLOAD_CHARS, `decoded payload ${raw.length}`);
    assert.ok(encodeURIComponent(raw).length <= MAX_ENCODED_PAYLOAD);
    const payload = JSON.parse(raw);
    assert.equal(payload.synced_at, SYNCED, 'every batch carries the run\'s one timestamp');
    sent.push(...payload.rows);
  }
  assert.deepEqual(sent, rows, 'every row, once, in order');
  assert.equal(totals.batches, calls.length);
});

test('AC4: totals are summed across batches', async () => {
  const rows = elevenDays();
  const n = chunkByPayload(rows, (run) => ({ rows: run, synced_at: SYNCED })).length;
  const { client } = api(Array.from({ length: n }, (_, i) => ok({ appended: i, updated: 1 })));
  const totals = await client.upsertDailyHealth(rows, SYNCED);
  assert.equal(totals.updated, n);
  assert.equal(totals.appended, (n * (n - 1)) / 2);
});

test('a batch that fails says how many rows already landed', async () => {
  const rows = elevenDays();
  const { client } = api([ok({ appended: 3, updated: 0 }), { status: 200, body: { success: false, error: 'boom' } }]);
  await assert.rejects(client.upsertDailyHealth(rows, SYNCED), (err) => {
    assert.ok(err instanceof ThriveApiError);
    assert.match(err.message, /boom/);
    assert.match(err.message, /rows were already written; batch 2 of \d+ failed/);
    return true;
  });
});

test('nothing to send makes no call', async () => {
  const { client, calls } = api([]);
  assert.deepEqual(await client.upsertDailyHealth([], SYNCED), { appended: 0, updated: 0, batches: 0 });
  assert.equal(calls.length, 0);
});

test('an API refusal is an error naming the action, and is never retried', async () => {
  const { client, calls } = api([{ status: 200, body: { success: false, error: 'Invalid or missing API key' } }]);
  await assert.rejects(client.get('getDailySummary'), /getDailySummary: Invalid or missing API key/);
  assert.equal(calls.length, 1);
});

test('a read is retried when Google serves a page; the bare write() is not', async () => {
  const page = { status: 404, body: '<html>Not found</html>' };
  const read = api([page, ok([])]);
  assert.deepEqual(await read.client.get('getDailySummary'), []);
  assert.equal(read.calls.length, 2);

  const write = api([page, ok({})]);
  await assert.rejects(write.client.write('anything', {}), /web page instead of JSON/);
  assert.equal(write.calls.length, 1);
});

// --- #327: a write that got a 404 page is retried, when its replay is safe -----------

const PAGE_404 = { status: 404, body: '<html>Not found</html>' };
const BASE = [2000, 6000, 15000];
/** A client whose waits are recorded and whose random() is scripted (default 0.5, factor 1). */
function retrying(responses, { randoms = [], ...opts } = {}) {
  const waits = [];
  const r = api(responses, { wait: async (ms) => { waits.push(ms); }, random: () => (randoms.length ? randoms.shift() : 0.5), ...opts });
  return { ...r, waits };
}

/** The opted-in calls, each as a function of the client. */
const OPTED_IN = {
  upsertSyncedWorkout: (c) => c.upsertSyncedWorkout({ source: 'coros', source_activity_id: 'a1', incoming: { Name: 'Run' }, last_written: null, raw_ref: 'r', synced_at: SYNCED }),
  enrichWorkout: (c) => c.enrichWorkout({ source_activity_id: 'a1', activity: { Name: 'Lift' }, last_written: null, raw_ref: 'r', synced_at: SYNCED }),
  upsertDailyHealth: (c) => c.upsertDailyHealth([elevenDays()[0]], SYNCED),
  upsertBodyMeasurements: (c) => c.upsertBodyMeasurements([{ grpid: '1', date: '2026-09-24' }], SYNCED),
  rebuildDailySummary: (c) => c.rebuildDailySummary('2026-09-14', '2026-09-24', SYNCED),
  appendSyncLog: (c) => c.appendSyncLog({ run_id: 'r1', status: 'ok', notes: '' }),
  'appendSyncLog (withings)': (c) => c.appendSyncLog({ run_id: 'r1', status: 'ok', notes: '' }, { log: 'withings' }),
};

for (const [name, send] of Object.entries(OPTED_IN)) {
  test(`AC1/AC3: ${name} re-sends a byte-identical request after a 404 page, and the answer lands`, async () => {
    const { client, calls, waits } = retrying([PAGE_404, PAGE_404, ok({ appended: 1, updated: 0 })]);
    await send(client);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url, calls[0].url, 'same URL, so same payload and synced_at');
    assert.equal(calls[2].url, calls[0].url);
    assert.deepEqual(calls[1].init, calls[0].init);
    assert.deepEqual(waits, [2000, 6000]);
  });
}

test('AC1: three retries wait 2, 6 and 15 s, each scaled by a random factor of 0.75-1.25', async () => {
  const { client, calls, waits } = retrying([PAGE_404, PAGE_404, PAGE_404, ok({})], { randoms: [0, 1, 0.5] });
  await client.rebuildDailySummary('2026-09-14', '2026-09-24', SYNCED);
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [1500, 7500, 15000]);
  waits.forEach((w, i) => assert.ok(w >= BASE[i] * 0.75 && w <= BASE[i] * 1.25));
});

test('AC1: the first JSON answer is returned as today; a refusal is thrown and never retried', async () => {
  const good = retrying([PAGE_404, ok({ written: 3 })]);
  assert.deepEqual(await good.client.rebuildDailySummary('a', 'b', SYNCED), { written: 3 });

  const refused = retrying([PAGE_404, { status: 200, body: { success: false, error: 'Lock timeout' } }, ok({})]);
  await assert.rejects(refused.client.rebuildDailySummary('a', 'b', SYNCED), /rebuildDailySummary: Lock timeout/);
  assert.equal(refused.calls.length, 2, 'the JSON refusal ended it');
});

test('AC1/AC4: a 404 page on every request is sent four times, then fails with the unchanged message', async () => {
  const { client, calls, waits } = retrying([PAGE_404, PAGE_404, PAGE_404, PAGE_404, ok({})]);
  await assert.rejects(
    client.upsertSyncedWorkout({ source: 'coros', source_activity_id: 'a1', incoming: {}, last_written: null, raw_ref: 'r', synced_at: SYNCED }),
    /upsertSyncedWorkout: the API returned 404 with a web page instead of JSON, so the request never reached the script\. Check that THRIVE_API_URL is the \/exec URL of the web-app deployment\. Apps Script also serves these briefly under load\.$/,
  );
  assert.equal(calls.length, 4);
  assert.equal(waits.length, 3);
});

test('AC2: JSON errors, other statuses and fetch rejections are sent once and throw as today', async () => {
  const cases = [
    [{ status: 200, body: { success: false, error: 'Lock timeout' } }, /Lock timeout/],
    [{ status: 200, body: { success: false, error: 'row drift: expected 5' } }, /row drift/],
    [{ status: 200, body: { success: false, error: 'bad payload' } }, /bad payload/],
    [{ status: 200, body: '<html>Sign in</html>' }, /returned 200 with a web page/],
    [{ status: 403, body: '<html>Access denied</html>' }, /returned 403 with a web page/],
    [{ status: 500, body: '<html>Error</html>' }, /returned 500 with a web page/],
    [{ status: 503, body: '<html>Timeout</html>' }, /returned 503 with a web page/],
    [new Error('ECONNRESET'), /request failed: ECONNRESET/],
  ];
  for (const [response, message] of cases) {
    const { client, calls, waits } = retrying([response, ok({})]);
    await assert.rejects(client.rebuildDailySummary('a', 'b', SYNCED), message);
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  }
});

test('AC2: reconcileBodyMeasurements is never retried, whatever it gets', async () => {
  const { client, calls, waits } = retrying([PAGE_404, ok({ deleted: [], refused: false })]);
  await assert.rejects(
    client.reconcileBodyMeasurements({ from: 'a', to: 'b', present_grpids: [], max_deletions: 5 }),
    /web page instead of JSON/,
  );
  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0);
  assert.equal(client.retryNote(), '');
});

test('AC2: reads are unchanged: [1000, 3000], every NotReachedError', async () => {
  const { client, calls, waits } = retrying([new Error('ECONNRESET'), PAGE_404, ok([])]);
  assert.deepEqual(await client.get('getDailySummary'), []);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 3000]);
});

test('AC3: a retry re-sends the one batch that failed, not the batches that landed', async () => {
  const rows = elevenDays();
  const n = chunkByPayload(rows, (run) => ({ rows: run, synced_at: SYNCED })).length;
  assert.ok(n >= 2);
  const responses = [ok({ appended: 1 }), PAGE_404, ...Array.from({ length: n - 1 }, () => ok({ appended: 1 }))];
  const { client, calls } = retrying(responses);
  const totals = await client.upsertDailyHealth(rows, SYNCED);
  assert.equal(calls.length, n + 1);
  assert.equal(calls[2].url, calls[1].url, 'batch 2 was re-sent');
  assert.notEqual(calls[1].url, calls[0].url);
  assert.equal(totals.batches, n);
});

test('AC3: a batch that still fails keeps the "N of M rows already written" message', async () => {
  const rows = elevenDays();
  const n = chunkByPayload(rows, (run) => ({ rows: run, synced_at: SYNCED })).length;
  const { client } = retrying([ok({ appended: 1 }), PAGE_404, PAGE_404, PAGE_404, PAGE_404]);
  await assert.rejects(client.upsertDailyHealth(rows, SYNCED), new RegExp(`rows were already written; batch 2 of ${n} failed`));
});

test('AC4: at most 90 s is waited per process; once spent, a 404 page gets no retry', async () => {
  // Every request fails; random 1 makes each wait the longest (2.5, 7.5, 18.75 s = 28.75 s).
  const { client, calls, waits } = retrying(Array.from({ length: 40 }, () => PAGE_404), { randoms: Array(40).fill(1) });
  for (let i = 0; i < 6; i++) {
    const before = calls.length;
    await assert.rejects(
      client.rebuildDailySummary('a', 'b', SYNCED),
      /rebuildDailySummary: the API returned 404 with a web page instead of JSON/,
    );
    assert.ok(calls.length - before <= 4);
  }
  assert.ok(waits.reduce((a, b) => a + b, 0) <= 90000);
  // Three full requests spend 86.25 s; the fourth's 2.5 s fits, its 7.5 s does not.
  const before = calls.length;
  await assert.rejects(client.rebuildDailySummary('a', 'b', SYNCED));
  assert.equal(calls.length - before, 1, 'a spent budget leaves later requests one shot');
});

test('AC5: retryNote names counts and actions, and is empty until something was retried', async () => {
  const { client } = retrying([
    ok({}), // no retry: not counted
    PAGE_404, ok({ written: 1 }), // retried, landed
    PAGE_404, PAGE_404, ok({ status: 'appended' }), // retried, landed
    PAGE_404, PAGE_404, PAGE_404, PAGE_404, // retried, gave up
  ]);
  await client.rebuildDailySummary('a', 'b', SYNCED);
  assert.equal(client.retryNote(), '');
  assert.equal(client.retryCounts(), null);
  await client.rebuildDailySummary('a', 'b', SYNCED);
  await client.appendSyncLog({ run_id: 'r1' });
  await assert.rejects(client.appendSyncLog({ run_id: 'r2' }));
  assert.equal(
    client.retryNote(),
    'Apps Script served a 404 page on write requests: 3 retried, 2 landed, 1 gave up (rebuildDailySummary x1, appendSyncLog x2)',
  );
  assert.deepEqual(client.retryCounts(), { retried: 3, landed: 2, gaveUp: 1 });
});

test('chunkByPayload refuses a single entry too large to send', () => {
  assert.throws(() => chunkByPayload([{ x: 'y'.repeat(6000) }], (run) => ({ rows: run })), /too large/);
});
