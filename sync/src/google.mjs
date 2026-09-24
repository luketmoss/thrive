// The bot account's Google credential (#151 AC0).
//
// The sync uses no service account: a service account has no Drive storage
// quota, and a free Gmail account has no shared drives, so files the sync
// creates must be owned by luketmossbot@gmail.com. It signs in as that account
// with its own OAuth client and `drive.file`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { DriveAuthError } from './errors.mjs';
import { registerSecret } from './redact.mjs';

/**
 * Written by google-authorize.mjs for local runs. Gitignored. In Actions the
 * same three values come from secrets instead.
 */
export const LOCAL_CREDENTIALS_PATH = fileURLToPath(new URL('../.google-credentials.json', import.meta.url));

/** Environment first, then the local file. Missing pieces are a DriveAuthError. */
export function loadGoogleCredentials(env = process.env, readFile = readFileSync) {
  let local = {};
  try {
    local = JSON.parse(readFile(LOCAL_CREDENTIALS_PATH, 'utf8'));
  } catch { /* no local file — fine in Actions */ }

  const creds = {
    client_id: env.GOOGLE_OAUTH_CLIENT_ID || local.client_id,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET || local.client_secret,
    refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN || local.refresh_token,
  };
  const missing = [
    ['GOOGLE_OAUTH_CLIENT_ID', creds.client_id],
    ['GOOGLE_OAUTH_CLIENT_SECRET', creds.client_secret],
    ['GOOGLE_DRIVE_REFRESH_TOKEN', creds.refresh_token],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new DriveAuthError(`${missing.join(', ')} not set`);

  registerSecret(creds.client_secret);
  registerSecret(creds.refresh_token);
  return creds;
}

/**
 * A `getToken()` for createDrive. google-auth-library caches the access token
 * and refreshes it itself; Google refresh tokens do not rotate, so nothing is
 * written back.
 */
export function googleTokenProvider(creds, { client } = {}) {
  const oauth = client ?? new OAuth2Client({ clientId: creds.client_id, clientSecret: creds.client_secret });
  oauth.setCredentials({ refresh_token: creds.refresh_token });
  return async function getToken() {
    try {
      const { token } = await oauth.getAccessToken();
      if (!token) throw new Error('no access token returned');
      registerSecret(token);
      return token;
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client') {
        throw new DriveAuthError(code);
      }
      throw err;
    }
  };
}
