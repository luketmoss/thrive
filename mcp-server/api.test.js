// #132 — the Apps Script API client: request shape, the envelope, the
// failure that looks nothing like its cause, and payload chunking.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.THRIVE_API_URL = 'https://example.test/macros/s/DEPLOYMENT/exec';
process.env.THRIVE_API_KEY = 'test-key';
process.env.THRIVE_READ_RETRY_DELAYS_MS = '1,1';

const api = await import('./api.js');
const { chunkByPayload, ApiError, MAX_ENCODED_PAYLOAD } = api;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Replace fetch; record each URL; answer with `respond(url, n)`. */
function stubFetch(respond) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    const { status = 200, body } = respond(urls.at(-1), urls.length);
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return urls;
}

// --- request shape ------------------------------------------------------

test('a read sends action and key, and skips empty parameters', async () => {
  const urls = stubFetch(() => ({ body: { success: true, data: [] } }));
  await api.fetchSets(undefined);
  await api.fetchSets('w_1');
  assert.equal(urls[0].searchParams.get('action'), 'getSets');
  assert.equal(urls[0].searchParams.get('key'), 'test-key');
  assert.equal(urls[0].searchParams.has('workout_id'), false);
  assert.equal(urls[1].searchParams.get('workout_id'), 'w_1');
});

// Writes go by GET with a payload, because Apps Script's POST redirect breaks
// anonymous callers.
test('a write sends its data as a JSON payload parameter', async () => {
  const urls = stubFetch(() => ({ body: { success: true, data: { workout_id: 'w_1', sets_deleted: 3 } } }));
  const res = await api.deleteWorkout('w_1');
  assert.equal(urls[0].searchParams.get('action'), 'deleteWorkout');
  assert.deepEqual(JSON.parse(urls[0].searchParams.get('payload')), { id: 'w_1' });
  assert.deepEqual(res, { workout_id: 'w_1', sets_deleted: 3 });
});

// --- the envelope -------------------------------------------------------

test('an API refusal becomes an ApiError carrying the server\'s message', async () => {
  stubFetch(() => ({ body: { success: false, error: 'Workout "w_x" not found' } }));
  await assert.rejects(api.fetchWorkout('w_x'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, 'Workout "w_x" not found');
    assert.equal(err.action, 'getWorkout');
    return true;
  });
});

// Found during the first deployment: a library deployment serves a sign-in
// page, a non-web-app /exec serves 404, and a web app nobody authorized
// serves "Access denied". All are HTML, none mentions its cause.
test('a web page instead of JSON is explained, not reported as a parse error', async () => {
  stubFetch(() => ({ status: 403, body: '<!doctype html><html><title>Access Denied</title></html>' }));
  await assert.rejects(api.fetchWorkouts(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.match(err.message, /returned 403 with a web page instead of JSON/);
    assert.match(err.message, /\/exec URL of a web-app deployment with anonymous access/);
    assert.match(err.message, /authorized it by opening that URL once in a browser/);
    assert.doesNotMatch(err.message, /Unexpected token/);
    return true;
  });
});

// --- transient pages: reads retry, writes never do -------------------------

const PAGE = { status: 404, body: '<html><title>Page Not Found</title></html>' };
const OK = { body: { success: true, data: [{ id: 'w_1' }] } };

// #132's QA hit a run of these 404 pages that cleared on their own.
test('a read retries a transient page and then succeeds', async () => {
  const urls = stubFetch((url, n) => (n === 1 ? PAGE : OK));
  assert.deepEqual(await api.fetchWorkouts(), [{ id: 'w_1' }]);
  assert.equal(urls.length, 2);
});

test('a read gives up after three attempts and explains', async () => {
  const urls = stubFetch(() => PAGE);
  await assert.rejects(api.fetchWorkouts(), /returned 404 with a web page instead of JSON/);
  assert.equal(urls.length, 3);
});

// A page does not prove the write failed; retrying a create would duplicate it.
test('a write is sent exactly once, even when the answer is a page', async () => {
  const urls = stubFetch(() => PAGE);
  await assert.rejects(api.createWorkout({ type: 'weight', name: 'Push' }), /web page instead of JSON/);
  assert.equal(urls.length, 1);
});

// success: false is the script's real answer, not a transport blip.
test('an API refusal is never retried', async () => {
  const urls = stubFetch(() => ({ body: { success: false, error: 'Workout "w_x" not found' } }));
  await assert.rejects(api.fetchWorkout('w_x'), /not found/);
  assert.equal(urls.length, 1);
});

// --- chunking (#132 AC5) --------------------------------------------------

const wrap = (run) => ({ sets: run });
const item = (n) => ({ workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench Press', set_number: n, planned_reps: '8' });

test('everything fits in one chunk when it can', () => {
  const items = [item(1), item(2), item(3)];
  assert.deepEqual(chunkByPayload(items, wrap), [items]);
});

test('chunks respect the limit and keep every item, in order', () => {
  const items = Array.from({ length: 60 }, (_, i) => item(i + 1));
  const chunks = chunkByPayload(items, wrap, 1000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(encodeURIComponent(JSON.stringify(wrap(c))).length <= 1000);
  }
  assert.deepEqual(chunks.flat(), items);
});

test('an entry too large to send alone is an error, never truncated', () => {
  const huge = { ...item(1), notes: 'x'.repeat(2000) };
  assert.throws(() => chunkByPayload([item(1), huge], wrap, 1000), /A single entry is too large to send/);
  assert.throws(() => chunkByPayload([huge], wrap, 1000), /A single entry is too large to send/);
});

test('the default limit keeps the decoded payload under the server\'s 6000', () => {
  // Percent-encoding only grows a string, so an encoded limit below the
  // server's decoded one is a guarantee, not an estimate.
  assert.ok(MAX_ENCODED_PAYLOAD < 6000);
  const chunks = chunkByPayload(Array.from({ length: 200 }, (_, i) => item(i + 1)), wrap);
  for (const c of chunks) assert.ok(JSON.stringify(wrap(c)).length < 6000);
});

// --- appendSets: chunked, and honest about partial writes -----------------

test('appendSets sends a large batch as several requests', async () => {
  const urls = stubFetch(() => ({ body: { success: true, data: [] } }));
  const written = await api.appendSets(Array.from({ length: 80 }, (_, i) => item(i + 1)));
  assert.equal(written, 80);
  assert.ok(urls.length > 1);
  const sent = urls.flatMap((u) => JSON.parse(u.searchParams.get('payload')).sets);
  assert.equal(sent.length, 80);
});

test('appendSets says how many rows landed before a later chunk failed', async () => {
  stubFetch((url, n) => (n === 2
    ? { body: { success: false, error: 'Exceeded maximum execution time' } }
    : { body: { success: true, data: [] } }));
  await assert.rejects(api.appendSets(Array.from({ length: 80 }, (_, i) => item(i + 1))), (err) => {
    assert.match(err.message, /^Exceeded maximum execution time — \d+ of 80 set rows were already written \(chunk 2 of \d+ failed\)\.$/);
    assert.doesNotMatch(err.message, /— 0 of 80/);
    return true;
  });
});

test('appendSets with nothing to write makes no request', async () => {
  const urls = stubFetch(() => ({ body: { success: true, data: [] } }));
  assert.equal(await api.appendSets([]), 0);
  assert.equal(urls.length, 0);
});
