// #151 AC1: registration as a public client, the device grant, and the
// browser fallback's authorize URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorizeUrl, createPkce, pollDeviceToken, registerClient, toTokenSet,
} from '../src/coros-oauth.mjs';
import { OAuthError } from '../src/errors.mjs';
import { NOW, oauthError, scriptedFetch, tokenResponse } from './helpers.mjs';
import { createHash } from 'node:crypto';

test('registration asks for a public client with no secret, and for the device grant', async () => {
  const { fetchImpl, calls } = scriptedFetch([{ status: 201, body: { client_id: 'client-new' } }]);
  assert.equal(await registerClient(fetchImpl), 'client-new');
  assert.equal(calls[0].url, 'https://mcpus.coros.com/connect/register');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']);
  assert.match(body.scope, /offline_access/);
  assert.deepEqual(body.redirect_uris, ['http://127.0.0.1:43123/callback']);
});

test('registration without the device grant asks only for the code grant', async () => {
  const { fetchImpl, calls } = scriptedFetch([{ body: { client_id: 'c' } }]);
  await registerClient(fetchImpl, { deviceGrant: false });
  assert.deepEqual(JSON.parse(calls[0].init.body).grant_types, ['authorization_code', 'refresh_token']);
});

test('a refused registration is an OAuthError carrying the server code', async () => {
  const { fetchImpl } = scriptedFetch([oauthError(400, 'invalid_client_metadata')]);
  await assert.rejects(registerClient(fetchImpl), (err) => err instanceof OAuthError && err.code === 'invalid_client_metadata');
});

test('device polling waits through authorization_pending and backs off on slow_down', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    oauthError(400, 'authorization_pending'),
    oauthError(400, 'slow_down'),
    tokenResponse(1),
  ]);
  const waits = [];
  let clock = NOW;
  const tokens = await pollDeviceToken(fetchImpl, 'client-abc', { device_code: 'dev-code-xxxxxxxx', interval: 5, expires_in: 600 }, {
    wait: async (ms) => { waits.push(ms); clock += ms; },
    now: () => clock,
  });
  assert.deepEqual(waits, [5000, 5000, 10000]);
  assert.equal(calls[0].form.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(tokens.client_id, 'client-abc');
  assert.equal(tokens.refresh_token, 'refresh-token-1-xxxxxxxx');
});

test('a denied device approval is thrown, not polled forever', async () => {
  const { fetchImpl } = scriptedFetch([oauthError(400, 'access_denied')]);
  await assert.rejects(
    pollDeviceToken(fetchImpl, 'c', { device_code: 'd', interval: 1 }, { wait: async () => {} }),
    (err) => err.code === 'access_denied',
  );
});

test('the browser fallback uses PKCE S256 and names the MCP resource', () => {
  const { verifier, challenge } = createPkce();
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const url = new URL(buildAuthorizeUrl('client-abc', challenge, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://mcpus.coros.com/oauth2/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('resource'), 'https://mcpus.coros.com/mcp');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:43123/callback');
});

test('the stored token set has an absolute expiry', () => {
  const set = toTokenSet({ access_token: 'a-xxxxxxxx', refresh_token: 'r-xxxxxxxx', expires_in: 2592000 }, 'c', NOW);
  assert.deepEqual(Object.keys(set), ['client_id', 'access_token', 'refresh_token', 'access_expires_at', 'updated_at']);
  assert.equal(set.access_expires_at, '2026-10-24T09:17:00.000Z');
});
