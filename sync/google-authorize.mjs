#!/usr/bin/env node
// One-time: sign the sync in to Google Drive as luketmossbot@gmail.com
// (#151 AC0). Prints the refresh token for the GOOGLE_DRIVE_REFRESH_TOKEN
// Actions secret, and saves it to sync/.google-credentials.json (gitignored)
// so authorize.mjs and local runs can use it.
//
//   node google-authorize.mjs --client-json <path to the downloaded client JSON>
//
// or with GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET set.

import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { DRIVE_SCOPE } from './src/config.mjs';
import { LOCAL_CREDENTIALS_PATH } from './src/google.mjs';
import { listenForRedirect, openBrowser } from './src/loopback.mjs';
import { redact } from './src/redact.mjs';

const BOT_ACCOUNT = 'luketmossbot@gmail.com';

function clientFromArgs() {
  const i = process.argv.indexOf('--client-json');
  if (i !== -1) {
    const json = JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
    const c = json.installed ?? json.web ?? json;
    return { client_id: c.client_id, client_secret: c.client_secret };
  }
  return {
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

async function main() {
  const { client_id, client_secret } = clientFromArgs();
  if (!client_id || !client_secret) {
    throw new Error('Pass --client-json <file> (the JSON downloaded when the Desktop client was ' +
      'created), or set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
  }

  const loopback = await listenForRedirect({ port: 0, path: '/' });
  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri: loopback.redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(16).toString('hex');
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always issue a refresh token, even on a re-run
    scope: [DRIVE_SCOPE],
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    login_hint: BOT_ACCOUNT,
  });

  console.log(`Sign in as ${BOT_ACCOUNT}. Opening your browser; if it does not open, visit:\n\n  ${url}\n`);
  console.log('Google will say it has not verified this app. That is expected for a personal app:');
  console.log('click Advanced → Go to Thrive Sync (unsafe) → Continue.\n');
  openBrowser(url);

  const params = await loopback.params;
  loopback.close();
  if (params.get('error')) throw new Error(`Google returned ${params.get('error')}`);
  if (params.get('state') !== state) throw new Error('state mismatch — start again');

  const { tokens } = await client.getToken({
    code: params.get('code'), codeVerifier, redirect_uri: loopback.redirectUri,
  });
  if (!tokens.refresh_token) {
    throw new Error('Google returned no refresh token. Remove Thrive Sync at ' +
      'https://myaccount.google.com/permissions and run this again.');
  }

  // Confirm which account signed in — the one mistake this step invites.
  client.setCredentials(tokens);
  let email = '(unknown)';
  try {
    const res = await client.request({ url: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)' });
    email = res.data?.user?.emailAddress ?? email;
  } catch { /* informational only */ }

  writeFileSync(
    LOCAL_CREDENTIALS_PATH,
    JSON.stringify({ client_id, client_secret, refresh_token: tokens.refresh_token }, null, 2),
    { mode: 0o600 },
  );

  console.log(`Signed in as ${email}.`);
  if (email !== BOT_ACCOUNT && email !== '(unknown)') {
    console.log(`\n  WARNING: that is not ${BOT_ACCOUNT}. Files would be owned by the wrong account.\n`);
  }
  console.log(`Saved for local runs: ${LOCAL_CREDENTIALS_PATH} (gitignored).\n`);
  console.log('Store this refresh token as the GOOGLE_DRIVE_REFRESH_TOKEN Actions secret.');
  console.log('This is the only time it is shown:\n');
  console.log(`  ${tokens.refresh_token}\n`);
  console.log('  gh secret set GOOGLE_DRIVE_REFRESH_TOKEN --repo luketmoss/thrive\n');
  console.log('Next: node authorize.mjs');
}

main().catch((err) => {
  console.error(`google-authorize failed: ${redact(err.message || String(err))}`);
  process.exit(1);
});
