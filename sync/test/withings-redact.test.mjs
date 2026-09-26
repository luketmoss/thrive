// #196 AC5: no Withings access token, refresh token, client secret or
// authorization code reaches output, an error or a log — proven against a
// fake Withings that echoes them back inside its error bodies.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeWithings } from '../withings-authorize.mjs';
import { clearSecrets, redact } from '../src/redact.mjs';
import { createWithingsTokenStore } from '../src/token-store.mjs';
import { getWithingsAccessToken } from '../src/withings-tokens.mjs';
import { NOW, memoryDrive, memoryStore, scriptedFetch } from './helpers.mjs';
import { CLIENT_ID, CLIENT_SECRET, MINUTE, storedWithings, withingsTokens } from './withings-helpers.mjs';

beforeEach(() => clearSecrets());

const SECRETS = /wt-access-\d|wt-refresh-\d|withings-client-secret|code-leak/;

/** A fake Withings that answers every request by echoing it back in `error`. */
function echoingWithings(status, { then = [] } = {}) {
  const calls = [];
  const queue = [...then];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (queue.length) {
      const next = queue.shift();
      return { ok: true, status: 200, text: async () => JSON.stringify(next.body) };
    }
    const echo = `you sent ${init.body} with ${init.headers.Authorization ?? 'no header'}; ` +
      JSON.stringify({ access_token: 'wt-access-9-unseen-xx', refresh_token: 'wt-refresh-9-unseen-xx' });
    return { ok: true, status: 200, text: async () => JSON.stringify({ status, body: {}, error: echo }) };
  };
  return { fetchImpl, calls };
}

test('redact masks Withings credentials as JSON fields and as parameters, code= included', () => {
  const out = redact(
    '{"access_token":"a1","refresh_token":"r1","client_secret":"s1"} ' +
    'action=requesttoken&grant_type=authorization_code&code=abc123&client_secret=s2&refresh_token=r2 ' +
    'https://luketmoss.github.io/thrive/withings-callback.html?code=zzz999&state=st',
  );
  assert.doesNotMatch(out, /a1|r1|s1|abc123|s2|r2|zzz999/);
  assert.match(out, /grant_type=authorization_code/);
  assert.match(out, /state=st/);
  assert.equal(redact('code=abc123&state=s1'), 'code=[redacted]&state=s1');
});

test('a refused refresh that echoes every credential leaks none of them into the error', async () => {
  for (const status of [401, 503, 601, 2554, 987654]) {
    const store = memoryStore(storedWithings({ expiresInMs: MINUTE }));
    const { fetchImpl } = echoingWithings(status);
    const err = await getWithingsAccessToken({
      store, fetchImpl, now: () => NOW, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
      retry: { delays: [1, 1], wait: async () => {} },
    }).catch((e) => e);
    assert.ok(err instanceof Error, `status ${status}`);
    assert.doesNotMatch(err.message, SECRETS, `status ${status}: ${err.message}`);
    assert.doesNotMatch(err.message, /unseen/, `status ${status}`);
  }
});

test('the authorize script prints no credential, whether the code is refused or accepted', async () => {
  for (const scenario of ['refused', 'accepted-then-check-fails']) {
    clearSecrets();
    const out = [];
    const { fetchImpl } = scenario === 'refused'
      ? echoingWithings(503)
      : echoingWithings(401, { then: [withingsTokens(1)] });
    const err = await authorizeWithings({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      store: createWithingsTokenStore(memoryDrive()),
      readPaste: (() => { let n = 0; return async () => (n++ < 4 ? `code=code-leak-${n}-xxxx&state=s` : null); })(),
      fetchImpl,
      print: (line) => out.push(line),
      open: () => {},
      now: () => NOW,
      state: 's',
    }).catch((e) => e);
    assert.ok(err instanceof Error, scenario);
    const everything = [...out, err.message].join('\n');
    assert.doesNotMatch(everything, SECRETS, `${scenario}: ${everything}`);
    assert.doesNotMatch(everything, /unseen/, scenario);
  }
});
