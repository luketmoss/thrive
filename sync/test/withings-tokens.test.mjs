// #196 AC3: getWithingsAccessToken refreshes within 15 minutes of expiry,
// persists the rotated set before returning it, and re-reads Drive once on a
// refused refresh. AC4: an outage is retried and never a dead grant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWithingsAccessToken } from '../src/withings-tokens.mjs';
import {
  TokenPersistError, WithingsGrantDeadError, WithingsTokenPersistError, WithingsUnavailableError,
} from '../src/errors.mjs';
import { NOW, memoryStore, scriptedFetch } from './helpers.mjs';
import {
  CLIENT_ID, CLIENT_SECRET, HOUR, MINUTE, storedWithings, withingsStatus, withingsTokens,
} from './withings-helpers.mjs';

const now = () => NOW;
const retry = { delays: [1, 1], wait: async () => {} };
const run = (store, fetchImpl, extra = {}) => getWithingsAccessToken({
  store, fetchImpl, now, retry, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, ...extra,
});

// --- the 15-minute threshold ------------------------------------------------

test('a token with more than 15 minutes left is returned as-is, without a refresh', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: 15 * MINUTE + 1 }));
  const { fetchImpl, calls } = scriptedFetch([]);
  const res = await run(store, fetchImpl);
  assert.deepEqual(res, { accessToken: 'wt-access-0-xxxxxxxx', userid: '1234567', refreshed: false });
  assert.equal(calls.length, 0);
  assert.deepEqual(store.events, ['load']);
});

test('a token with 15 minutes or less left is refreshed with grant_type=refresh_token', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: 15 * MINUTE }));
  const { fetchImpl, calls } = scriptedFetch([withingsTokens(1)]);
  const res = await run(store, fetchImpl);
  assert.equal(res.refreshed, true);
  assert.equal(res.accessToken, 'wt-access-1-xxxxxxxx');
  assert.deepEqual(calls[0].form, {
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: 'wt-refresh-0-xxxxxxxx',
  });
});

test('an expired token is refreshed, and force refreshes a fresh one', async () => {
  assert.equal((await run(memoryStore(storedWithings({ expiresInMs: -HOUR })), scriptedFetch([withingsTokens(1)]).fetchImpl)).refreshed, true);
  assert.equal((await run(memoryStore(storedWithings({ expiresInMs: 2 * HOUR })), scriptedFetch([withingsTokens(1)]).fetchImpl, { force: true })).refreshed, true);
});

// --- persist before use -----------------------------------------------------

test('the rotated set is written to Drive before the access token is returned', async () => {
  let savedBeforeReturn = null;
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }), {
    onSave: async (next) => { savedBeforeReturn = next; },
  });
  const res = await run(store, scriptedFetch([withingsTokens(1)]).fetchImpl);
  assert.equal(savedBeforeReturn.access_token, res.accessToken);
  assert.deepEqual(store.tokens, {
    userid: '1234567',
    access_token: 'wt-access-1-xxxxxxxx',
    refresh_token: 'wt-refresh-1-xxxxxxxx',
    access_expires_at: new Date(NOW + 3 * HOUR).toISOString(),
    updated_at: new Date(NOW).toISOString(),
  });
  assert.deepEqual(store.events, ['load', 'save']);
});

test('a failed Drive write is a TokenPersistError naming Withings, and the new token is not handed out', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }), {
    onSave: async () => { throw new Error('Drive 500: backend error'); },
  });
  await assert.rejects(run(store, scriptedFetch([withingsTokens(1)]).fetchImpl), (err) => {
    assert.ok(err instanceof WithingsTokenPersistError);
    assert.ok(err instanceof TokenPersistError);
    assert.match(err.message, /Withings/);
    assert.match(err.message, /withings-authorize\.mjs/);
    assert.doesNotMatch(err.message, /COROS|wt-access-1|wt-refresh-1/);
    return true;
  });
});

// --- a refused refresh --------------------------------------------------------

test('a refused refresh with a newer token in Drive retries once with that token', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }));
  const { fetchImpl, calls } = scriptedFetch([withingsStatus(503, 'Invalid Params: invalid refresh_token'), withingsTokens(2)]);
  const realLoad = store.load;
  let loads = 0;
  store.load = async () => {
    loads += 1;
    if (loads === 2) store.tokens = { ...store.tokens, refresh_token: 'wt-refresh-9-xxxxxxxx' };
    return realLoad();
  };
  const res = await run(store, fetchImpl);
  assert.equal(res.refreshed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].form.refresh_token, 'wt-refresh-9-xxxxxxxx');
  assert.equal(store.tokens.refresh_token, 'wt-refresh-2-xxxxxxxx');
});

test('a refused refresh with the same token still in Drive is a dead grant, with no second attempt', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }));
  const { fetchImpl, calls } = scriptedFetch([withingsStatus(401, 'invalid_token')]);
  await assert.rejects(run(store, fetchImpl), (err) => {
    assert.ok(err instanceof WithingsGrantDeadError);
    assert.match(err.message, /node sync\/withings-authorize\.mjs/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(store.events, ['load', 'load']);
});

test('a missing token file is a dead grant that says to authorize', async () => {
  await assert.rejects(run(memoryStore(null), scriptedFetch([]).fetchImpl), /withings-authorize\.mjs/);
});

test('missing client credentials are named, not reported as a dead grant', async () => {
  await assert.rejects(
    run(memoryStore(storedWithings({ expiresInMs: MINUTE })), scriptedFetch([]).fetchImpl, { clientSecret: '' }),
    (err) => !(err instanceof WithingsGrantDeadError) && /WITHINGS_CLIENT_SECRET/.test(err.message),
  );
});

// --- AC4: an outage is not a dead grant -------------------------------------

test('rate limiting and Withings errors are retried with backoff, then reported unavailable', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }));
  const waits = [];
  const { fetchImpl, calls } = scriptedFetch([withingsStatus(601, 'Too Many Requests'), withingsStatus(5001), { status: 503, body: '' }]);
  await assert.rejects(
    run(store, fetchImpl, { retry: { delays: [10, 20], wait: async (ms) => { waits.push(ms); } } }),
    WithingsUnavailableError,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.deepEqual(store.events, ['load'], 'an outage never triggers the dead-grant re-read');
});

test('a network failure followed by success refreshes normally', async () => {
  const store = memoryStore(storedWithings({ expiresInMs: MINUTE }));
  const { fetchImpl, calls } = scriptedFetch([new TypeError('fetch failed'), withingsTokens(1)]);
  assert.equal((await run(store, fetchImpl)).refreshed, true);
  assert.equal(calls.length, 2);
});
