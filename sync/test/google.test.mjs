// #151 AC0: the bot account's Google credential, and the error that names it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleTokenProvider, loadGoogleCredentials } from '../src/google.mjs';
import { DriveAuthError } from '../src/errors.mjs';

const noFile = () => { throw new Error('ENOENT'); };

test('missing Google settings are a DriveAuthError naming each one', () => {
  assert.throws(() => loadGoogleCredentials({ GOOGLE_OAUTH_CLIENT_ID: 'id' }, noFile), (err) => {
    assert.ok(err instanceof DriveAuthError);
    assert.match(err.message, /GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN not set/);
    assert.match(err.message, /google-authorize\.mjs/);
    return true;
  });
});

test('environment variables win over the local credentials file', () => {
  const file = () => JSON.stringify({ client_id: 'file-id', client_secret: 'file-secret', refresh_token: 'file-refresh-token' });
  const creds = loadGoogleCredentials({ GOOGLE_OAUTH_CLIENT_ID: 'env-id' }, file);
  assert.deepEqual(creds, { client_id: 'env-id', client_secret: 'file-secret', refresh_token: 'file-refresh-token' });
});

function fakeClient(getAccessToken) {
  return { setCredentials() {}, getAccessToken };
}

test('a revoked Google grant is a DriveAuthError, not a COROS one', async () => {
  const client = fakeClient(async () => {
    const err = new Error('invalid_grant');
    err.response = { data: { error: 'invalid_grant' } };
    throw err;
  });
  const getToken = googleTokenProvider({ client_id: 'i', client_secret: 's', refresh_token: 'r' }, { client });
  await assert.rejects(getToken(), DriveAuthError);
});

test('a Google outage passes through unchanged rather than blaming the credential', async () => {
  const client = fakeClient(async () => { throw new Error('ECONNRESET'); });
  const getToken = googleTokenProvider({ client_id: 'i', client_secret: 's', refresh_token: 'r' }, { client });
  await assert.rejects(getToken(), (err) => !(err instanceof DriveAuthError) && /ECONNRESET/.test(err.message));
});

test('the provider returns the access token', async () => {
  const client = fakeClient(async () => ({ token: 'ya29.token-value' }));
  const getToken = googleTokenProvider({ client_id: 'i', client_secret: 's', refresh_token: 'r' }, { client });
  assert.equal(await getToken(), 'ya29.token-value');
});
