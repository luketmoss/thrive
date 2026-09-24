// #151 AC2–AC3: when to refresh, persist before use, and when a rejected
// refresh means a dead grant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken } from '../src/tokens.mjs';
import {
  CorosGrantDeadError, CorosUnavailableError, TokenPersistError,
} from '../src/errors.mjs';
import {
  DAY, NOW, memoryStore, oauthError, scriptedFetch, storedTokens, tokenResponse,
} from './helpers.mjs';

const now = () => NOW;
const retry = { delays: [1, 1], wait: async () => {} };
const run = (store, fetchImpl, extra = {}) => getAccessToken({ store, fetchImpl, now, retry, ...extra });

// --- AC2: the 5-day threshold -----------------------------------------------

test('a token more than 5 days from expiry is returned without refreshing', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: 5 * DAY + 1 }));
  const { fetchImpl, calls } = scriptedFetch([]);
  const res = await run(store, fetchImpl);
  assert.equal(res.refreshed, false);
  assert.equal(res.accessToken, 'access-token-0-xxxxxxxx');
  assert.equal(calls.length, 0);
  assert.deepEqual(store.events, ['load']);
});

test('a token within 5 days of expiry is refreshed', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: 5 * DAY - 1 }));
  const { fetchImpl, calls } = scriptedFetch([tokenResponse(1)]);
  const res = await run(store, fetchImpl);
  assert.equal(res.refreshed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].form, {
    grant_type: 'refresh_token', client_id: 'client-abc', refresh_token: 'refresh-token-0-xxxxxxxx',
  });
});

test('an expired token is refreshed', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: -DAY }));
  const { fetchImpl } = scriptedFetch([tokenResponse(1)]);
  assert.equal((await run(store, fetchImpl)).refreshed, true);
});

test('force refreshes a fresh token', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: 20 * DAY }));
  const { fetchImpl } = scriptedFetch([tokenResponse(1)]);
  assert.equal((await run(store, fetchImpl, { force: true })).refreshed, true);
});

// --- AC2: persist before use ------------------------------------------------

test('the rotated token set is written to Drive before the access token is returned', async () => {
  let savedBeforeReturn = null;
  const store = memoryStore(storedTokens({ expiresInMs: DAY }), {
    onSave: async (next) => { savedBeforeReturn = next; },
  });
  const { fetchImpl } = scriptedFetch([tokenResponse(1)]);
  const res = await run(store, fetchImpl);

  assert.ok(savedBeforeReturn, 'save ran before getAccessToken resolved');
  assert.equal(savedBeforeReturn.access_token, res.accessToken);
  assert.equal(store.tokens.refresh_token, 'refresh-token-1-xxxxxxxx');
  assert.equal(store.tokens.client_id, 'client-abc');
  assert.equal(store.tokens.access_expires_at, new Date(NOW + 30 * DAY).toISOString());
  assert.equal(store.tokens.updated_at, new Date(NOW).toISOString());
});

test('a failed Drive write stops the run and never hands out the new token', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }), {
    onSave: async () => { throw new Error('Drive 500: backend error'); },
  });
  const { fetchImpl } = scriptedFetch([tokenResponse(1)]);
  await assert.rejects(run(store, fetchImpl), (err) => {
    assert.ok(err instanceof TokenPersistError);
    assert.doesNotMatch(err.message, /access-token-1/);
    return true;
  });
});

test('a refresh response without a new refresh token keeps the current one', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl } = scriptedFetch([tokenResponse(1, { rotate: false })]);
  await run(store, fetchImpl);
  assert.equal(store.tokens.refresh_token, 'refresh-token-0-xxxxxxxx');
  assert.equal(store.tokens.access_token, 'access-token-1-xxxxxxxx');
});

// --- AC3: a rejected refresh ------------------------------------------------

test('invalid_grant with a newer token in Drive retries once with that token', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([oauthError(400, 'invalid_grant'), tokenResponse(2)]);
  // Another process rotated between our load and our refresh.
  const realLoad = store.load;
  let loads = 0;
  store.load = async () => {
    loads += 1;
    if (loads === 2) store.tokens = { ...store.tokens, refresh_token: 'refresh-token-9-xxxxxxxx' };
    return realLoad();
  };

  const res = await run(store, fetchImpl);
  assert.equal(res.refreshed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].form.refresh_token, 'refresh-token-9-xxxxxxxx');
  assert.equal(store.tokens.refresh_token, 'refresh-token-2-xxxxxxxx');
});

test('invalid_grant with the same token still in Drive is a dead grant, with no second attempt', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([oauthError(400, 'invalid_grant')]);
  await assert.rejects(run(store, fetchImpl), (err) => {
    assert.ok(err instanceof CorosGrantDeadError);
    assert.match(err.message, /authorize\.mjs/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(store.events, ['load', 'load']);
});

test('invalid_grant on the retry too is a dead grant after exactly two attempts', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([oauthError(400, 'invalid_grant'), oauthError(400, 'invalid_grant')]);
  const realLoad = store.load;
  store.load = async () => {
    const t = await realLoad();
    store.tokens = { ...store.tokens, refresh_token: `refresh-token-${store.events.length}-xxxxxxxx` };
    return t;
  };
  await assert.rejects(run(store, fetchImpl), CorosGrantDeadError);
  assert.equal(calls.length, 2);
});

test('another 4xx refusal is a dead grant without re-reading Drive', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([oauthError(401, 'invalid_client')]);
  await assert.rejects(run(store, fetchImpl), CorosGrantDeadError);
  assert.equal(calls.length, 1);
  assert.deepEqual(store.events, ['load']);
});

test('a missing token file is a dead grant that says to authorize', async () => {
  const { fetchImpl } = scriptedFetch([]);
  await assert.rejects(run(memoryStore(null), fetchImpl), /authorize\.mjs/);
});

// --- AC3: an outage is not a dead grant --------------------------------------

test('a 5xx is retried three times in all, then reported as COROS unavailable', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([oauthError(503, 'server_error'), oauthError(502, 'bad_gateway'), oauthError(500, 'server_error')]);
  await assert.rejects(run(store, fetchImpl), CorosUnavailableError);
  assert.equal(calls.length, 3);
  assert.deepEqual(store.events, ['load'], 'an outage never triggers the dead-grant re-read');
});

test('a network failure followed by success refreshes normally', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const { fetchImpl, calls } = scriptedFetch([new TypeError('fetch failed'), tokenResponse(1)]);
  assert.equal((await run(store, fetchImpl)).refreshed, true);
  assert.equal(calls.length, 2);
});

// --- redaction --------------------------------------------------------------

test('no error a run can end in carries a token value', async () => {
  const store = memoryStore(storedTokens({ expiresInMs: DAY }));
  const leak = 'refresh-token-0-xxxxxxxx';
  const { fetchImpl } = scriptedFetch([
    new Error(`socket hang up while sending ${leak}`),
    new Error(`socket hang up while sending ${leak}`),
    new Error(`socket hang up while sending ${leak}`),
  ]);
  await assert.rejects(run(store, fetchImpl), (err) => {
    assert.ok(err instanceof CorosUnavailableError);
    assert.doesNotMatch(err.message, /refresh-token-0/);
    return true;
  });
});
