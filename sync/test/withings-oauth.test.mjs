// #196 AC2 and AC4: the authorize URL, the code exchange, the paste parser,
// and the status → class table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WITHINGS_STATUS, buildWithingsAuthorizeUrl, classifyWithingsStatus, countRecentMeasureGroups,
  exchangeWithingsCode, isWithingsInvalidGrant, isWithingsTransient, parseWithingsPaste,
  refreshWithings,
} from '../src/withings-oauth.mjs';
import { classifyWithingsError } from '../src/withings-tokens.mjs';
import {
  WithingsApiError, WithingsGrantDeadError, WithingsRequestError, WithingsUnavailableError,
} from '../src/errors.mjs';
import { NOW, scriptedFetch } from './helpers.mjs';
import { CLIENT_ID, CLIENT_SECRET, withingsStatus, withingsTokens } from './withings-helpers.mjs';

// --- the authorize URL and the exchange -------------------------------------

test('the authorize URL asks for user.metrics,user.info and returns to the Pages callback', () => {
  const url = new URL(buildWithingsAuthorizeUrl(CLIENT_ID, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://account.withings.com/oauth2_user/authorize2');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), 'user.metrics,user.info');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://luketmoss.github.io/thrive/withings-callback.html');
  assert.equal(url.searchParams.get('state'), 'state-1');
});

test('the exchange POSTs requesttoken with the code and stores the nested tokens with an absolute expiry', async () => {
  const { fetchImpl, calls } = scriptedFetch([withingsTokens(1)]);
  const set = await exchangeWithingsCode(fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: 'code-abcdefgh' }, NOW);
  assert.equal(calls[0].url, 'https://wbsapi.withings.net/v2/oauth2');
  assert.deepEqual(calls[0].form, {
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: 'code-abcdefgh',
    redirect_uri: 'https://luketmoss.github.io/thrive/withings-callback.html',
  });
  assert.deepEqual(Object.keys(set), ['userid', 'access_token', 'refresh_token', 'access_expires_at', 'updated_at']);
  assert.equal(set.userid, '1234567');
  assert.equal(set.refresh_token, 'wt-refresh-1-xxxxxxxx');
  assert.equal(set.access_expires_at, new Date(NOW + 3 * 3600 * 1000).toISOString());
  assert.equal(set.updated_at, new Date(NOW).toISOString());
});

test('the refresh POSTs requesttoken with grant_type=refresh_token', async () => {
  const { fetchImpl, calls } = scriptedFetch([withingsTokens(2)]);
  await refreshWithings(fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: 'wt-refresh-1-xxxxxxxx' }, NOW);
  assert.equal(calls[0].form.action, 'requesttoken');
  assert.equal(calls[0].form.grant_type, 'refresh_token');
  assert.equal(calls[0].form.refresh_token, 'wt-refresh-1-xxxxxxxx');
});

test('a refused code at HTTP 200 is an invalid grant, classified from status', async () => {
  const { fetchImpl } = scriptedFetch([withingsStatus(503, 'Invalid Params: invalid code')]);
  await assert.rejects(
    exchangeWithingsCode(fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: 'code-old-xxxx' }),
    (err) => err instanceof WithingsApiError && err.status === 503 && isWithingsInvalidGrant(err),
  );
});

test('the grant check counts only the measure groups, sent with the bearer token', async () => {
  const { fetchImpl, calls } = scriptedFetch([{ body: { status: 0, body: { measuregrps: [{}, {}, {}] } } }]);
  assert.equal(await countRecentMeasureGroups(fetchImpl, 'wt-access-1-xxxxxxxx', NOW), 3);
  assert.equal(calls[0].url, 'https://wbsapi.withings.net/measure');
  assert.equal(calls[0].form.action, 'getmeas');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer wt-access-1-xxxxxxxx');
});

// --- the paste ---------------------------------------------------------------

test('the callback page\'s text, the whole URL and a bare code all parse', () => {
  assert.deepEqual(parseWithingsPaste('code=abc123&state=s1'), { code: 'abc123', state: 's1', error: null });
  assert.deepEqual(
    parseWithingsPaste('  https://luketmoss.github.io/thrive/withings-callback.html?code=abc123&state=s1 \n'),
    { code: 'abc123', state: 's1', error: null },
  );
  assert.deepEqual(parseWithingsPaste('abc123'), { code: 'abc123', state: null, error: null });
  assert.deepEqual(parseWithingsPaste('error=access_denied&state=s1'), { code: null, state: 's1', error: 'access_denied' });
  assert.deepEqual(parseWithingsPaste(''), { code: null, state: null, error: null });
});

// --- AC4: the status table, one test per row --------------------------------

const statusTable = [
  ['ok', null],
  ['auth', WithingsGrantDeadError],
  ['params', null], // endpoint-dependent: checked below
  ['unavailable', WithingsUnavailableError],
  ['request', WithingsRequestError],
];

test('every status is in exactly one row', () => {
  const seen = new Map();
  for (const [category, codes] of Object.entries(WITHINGS_STATUS)) {
    for (const code of codes) {
      assert.ok(!seen.has(code), `${code} is in both ${seen.get(code)} and ${category}`);
      seen.set(code, category);
    }
  }
  assert.deepEqual(Object.keys(WITHINGS_STATUS), statusTable.map(([c]) => c));
});

test('row ok: status 0 returns the body', async () => {
  assert.equal(classifyWithingsStatus(0), 'ok');
  const { fetchImpl } = scriptedFetch([withingsTokens(1)]);
  assert.ok(await refreshWithings(fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: 'r-xxxxxxxx' }));
});

for (const [category, errorClass] of statusTable.filter(([, c]) => c)) {
  test(`row ${category}: every status in it becomes ${errorClass.name}`, async () => {
    for (const status of WITHINGS_STATUS[category]) {
      assert.equal(classifyWithingsStatus(status), category, `status ${status}`);
      const { fetchImpl } = scriptedFetch([withingsStatus(status)]);
      const err = await countRecentMeasureGroups(fetchImpl, 'a-xxxxxxxx').catch((e) => e);
      assert.ok(err instanceof WithingsApiError, `status ${status}`);
      assert.ok(classifyWithingsError(err) instanceof errorClass, `status ${status}`);
      assert.equal(isWithingsTransient(err), category === 'unavailable', `status ${status}`);
    }
  });
}

test('row params: a refused grant at the token endpoint, a request error anywhere else', async () => {
  for (const status of WITHINGS_STATUS.params) {
    assert.equal(classifyWithingsStatus(status), 'params');
    const token = scriptedFetch([withingsStatus(status)]);
    const atToken = await refreshWithings(token.fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: 'r-xxxxxxxx' }).catch((e) => e);
    assert.ok(isWithingsInvalidGrant(atToken), `status ${status}`);
    assert.ok(classifyWithingsError(atToken) instanceof WithingsGrantDeadError);

    const data = scriptedFetch([withingsStatus(status)]);
    const atData = await countRecentMeasureGroups(data.fetchImpl, 'a-xxxxxxxx').catch((e) => e);
    assert.ok(!isWithingsInvalidGrant(atData));
    assert.ok(!isWithingsTransient(atData));
    assert.ok(classifyWithingsError(atData) instanceof WithingsRequestError);
  }
});

test('a status Withings has not published is a request error, never an outage or a dead grant', async () => {
  assert.equal(classifyWithingsStatus(987654), 'request');
  const { fetchImpl } = scriptedFetch([withingsStatus(987654)]);
  const err = await countRecentMeasureGroups(fetchImpl, 'a-xxxxxxxx').catch((e) => e);
  assert.ok(classifyWithingsError(err) instanceof WithingsRequestError);
});

test('an HTTP 5xx, a 429, a non-JSON 200 and a network failure are all unavailable', async () => {
  for (const response of [
    { status: 502, body: '<html>Bad gateway</html>' },
    { status: 429, body: '' },
    { status: 200, body: '<html>maintenance</html>' },
    new TypeError('fetch failed'),
  ]) {
    const { fetchImpl } = scriptedFetch([response]);
    const err = await refreshWithings(fetchImpl, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: 'r-xxxxxxxx' }).catch((e) => e);
    assert.ok(isWithingsTransient(err), String(err));
    assert.ok(!isWithingsInvalidGrant(err));
    assert.ok(classifyWithingsError(err) instanceof WithingsUnavailableError);
  }
});

test('the README links the status list the table is built from', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /developer\.withings\.com\/api-reference\/#section\/Response-status/);
});
