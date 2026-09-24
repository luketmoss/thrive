#!/usr/bin/env node
// One-time: authorize Thrive against COROS and write the first token set to
// Drive (#151 AC1). Re-run it whenever a run fails with CorosGrantDeadError.
//
//   node authorize.mjs
//
// Needs the Google credential from google-authorize.mjs first.

import { randomBytes } from 'node:crypto';
import {
  buildAuthorizeUrl, createPkce, exchangeCode, pollDeviceToken, registerClient,
  startDeviceAuthorization,
} from './src/coros-oauth.mjs';
import { COROS_REDIRECT_URI } from './src/config.mjs';
import { createDrive } from './src/drive.mjs';
import { OAuthError } from './src/errors.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { listenForRedirect, openBrowser } from './src/loopback.mjs';
import { connectCoros } from './src/mcp.mjs';
import { redact } from './src/redact.mjs';
import { createTokenStore } from './src/token-store.mjs';

/** Registers a client, preferring one that may use the device grant. */
async function register() {
  try {
    return { clientId: await registerClient(fetch, { deviceGrant: true }), deviceGrant: true };
  } catch (err) {
    if (!(err instanceof OAuthError) || err.status >= 500) throw err;
    console.log(`COROS would not register the device grant (${err.code}); using the browser flow.`);
    return { clientId: await registerClient(fetch, { deviceGrant: false }), deviceGrant: false };
  }
}

async function deviceFlow(clientId) {
  const device = await startDeviceAuthorization(fetch, clientId);
  const url = device.verification_uri_complete ?? device.verification_uri;
  console.log(`Approve Thrive Sync in COROS. Opening your browser; if it does not open, visit:\n\n  ${url}\n`);
  if (!device.verification_uri_complete) console.log(`and enter the code: ${device.user_code}\n`);
  console.log('Waiting for approval…');
  openBrowser(url);
  return pollDeviceToken(fetch, clientId, device);
}

async function browserFlow(clientId) {
  const redirect = new URL(COROS_REDIRECT_URI);
  const loopback = await listenForRedirect({ port: Number(redirect.port), path: redirect.pathname });
  const { verifier, challenge } = createPkce();
  const state = randomBytes(16).toString('hex');
  const url = buildAuthorizeUrl(clientId, challenge, state);
  console.log(`Sign in to COROS. Opening your browser; if it does not open, visit:\n\n  ${url}\n`);
  openBrowser(url);
  const params = await loopback.params;
  loopback.close();
  if (params.get('error')) throw new OAuthError(400, params.get('error'), params.get('error_description'));
  if (params.get('state') !== state) throw new Error('state mismatch — start again');
  return exchangeCode(fetch, { clientId, code: params.get('code'), verifier });
}

async function main() {
  const drive = createDrive({ getToken: googleTokenProvider(loadGoogleCredentials()) });
  const store = createTokenStore(drive);

  const { clientId, deviceGrant } = await register();
  let tokens;
  if (deviceGrant) {
    try {
      tokens = await deviceFlow(clientId);
    } catch (err) {
      // A refusal to *start* the device grant falls back; a user who denied
      // it, or a code that expired, does not.
      if (!(err instanceof OAuthError) || ['access_denied', 'expired_token'].includes(err.code)) throw err;
      console.log(`The device grant was refused (${err.code}); using the browser flow.`);
      tokens = await browserFlow(clientId);
    }
  } else {
    tokens = await browserFlow(clientId);
  }
  if (!tokens.refresh_token) throw new Error('COROS returned no refresh token.');

  const fileId = await store.save(tokens);
  console.log(`\nSaved the COROS token set to Drive (Thrive COROS/coros-token.json, file ${fileId}).`);
  console.log(`Access token valid until ${tokens.access_expires_at}.`);

  const client = await connectCoros(tokens.access_token);
  const { tools } = await client.listTools();
  await client.close();
  console.log(`Checked: an authenticated MCP call lists ${tools.length} COROS tools.`);
}

main().catch((err) => {
  console.error(`authorize failed: ${err.name}: ${redact(err.message || String(err))}`);
  process.exit(1);
});
