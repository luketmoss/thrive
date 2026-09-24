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

test('a read is retried when Google serves a page; a write is not', async () => {
  const page = { status: 404, body: '<html>Not found</html>' };
  const read = api([page, ok([])]);
  assert.deepEqual(await read.client.get('getDailySummary'), []);
  assert.equal(read.calls.length, 2);

  const write = api([page, ok({})]);
  await assert.rejects(write.client.rebuildDailySummary('2026-09-14', '2026-09-24', SYNCED), /web page instead of JSON/);
  assert.equal(write.calls.length, 1);
});

test('chunkByPayload refuses a single entry too large to send', () => {
  assert.throws(() => chunkByPayload([{ x: 'y'.repeat(6000) }], (run) => ({ rows: run })), /too large/);
});
