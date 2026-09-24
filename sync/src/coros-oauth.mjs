// COROS OAuth, as a public client (#133): dynamic registration, PKCE S256,
// no client secret. Every function takes its `fetch` so tests need no network.

import { createHash, randomBytes } from 'node:crypto';
import {
  COROS_ENDPOINTS, COROS_MCP_URL, COROS_REDIRECT_URI, COROS_SCOPES, DEVICE_GRANT,
} from './config.mjs';
import { OAuthError } from './errors.mjs';
import { registerSecret } from './redact.mjs';

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: 'invalid_response', error_description: `non-JSON ${res.status} response` };
  }
}

/** POST, and throw an OAuthError carrying the server's `error` code on non-2xx. */
async function post(fetchImpl, url, { form, json }) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      Accept: 'application/json',
    },
    body: form ? new URLSearchParams(form).toString() : JSON.stringify(json),
  });
  const body = await readJson(res);
  if (!res.ok) throw new OAuthError(res.status, body.error || 'http_error', body.error_description);
  return body;
}

/**
 * Registers a fresh public client and returns its `client_id`.
 *
 * Asks for the device grant as well as the code grant. Some servers refuse
 * to register a grant type they would otherwise allow, so the caller retries
 * with `deviceGrant: false` and uses the browser flow.
 */
export async function registerClient(fetchImpl, { deviceGrant = true } = {}) {
  const grantTypes = ['authorization_code', 'refresh_token'];
  if (deviceGrant) grantTypes.push(DEVICE_GRANT);
  const body = await post(fetchImpl, COROS_ENDPOINTS.register, {
    json: {
      client_name: 'Thrive Sync',
      redirect_uris: [COROS_REDIRECT_URI],
      grant_types: grantTypes,
      response_types: ['code'],
      scope: COROS_SCOPES,
      token_endpoint_auth_method: 'none',
    },
  });
  if (!body.client_id) throw new OAuthError(200, 'invalid_response', 'registration returned no client_id');
  return body.client_id;
}

/**
 * The stored shape (#151 AC1). `access_expires_at` is absolute, so a run can
 * decide whether to refresh without knowing when the token was issued.
 */
export function toTokenSet(response, clientId, now = Date.now()) {
  if (!response.access_token) throw new OAuthError(200, 'invalid_response', 'token response has no access_token');
  const expiresIn = Number(response.expires_in) || 3600;
  registerSecret(response.access_token);
  registerSecret(response.refresh_token);
  return {
    client_id: clientId,
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    access_expires_at: new Date(now + expiresIn * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
}

/**
 * One refresh. Throws OAuthError on a refusal and lets a network failure
 * through untouched; tokens.mjs decides which is which.
 *
 * COROS rotates the refresh token on every use (#133). A response without one
 * would mean it stopped rotating, and the current token stays valid.
 */
export async function refresh(fetchImpl, { clientId, refreshToken }, now = Date.now()) {
  const body = await post(fetchImpl, COROS_ENDPOINTS.token, {
    form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken },
  });
  const set = toTokenSet(body, clientId, now);
  if (!set.refresh_token) set.refresh_token = refreshToken;
  return set;
}

// --- device-code grant (RFC 8628) ------------------------------------------

export async function startDeviceAuthorization(fetchImpl, clientId) {
  const body = await post(fetchImpl, COROS_ENDPOINTS.device, {
    form: { client_id: clientId, scope: COROS_SCOPES, resource: COROS_MCP_URL },
  });
  registerSecret(body.device_code);
  return body;
}

/** Polls until the user approves, honouring `slow_down` and the code's expiry. */
export async function pollDeviceToken(fetchImpl, clientId, device, {
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  let intervalMs = (Number(device.interval) || 5) * 1000;
  const deadline = now() + (Number(device.expires_in) || 600) * 1000;
  while (now() < deadline) {
    await wait(intervalMs);
    try {
      const body = await post(fetchImpl, COROS_ENDPOINTS.token, {
        form: { grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: clientId },
      });
      return toTokenSet(body, clientId, now());
    } catch (err) {
      if (err instanceof OAuthError && err.code === 'authorization_pending') continue;
      if (err instanceof OAuthError && err.code === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      throw err;
    }
  }
  throw new OAuthError(400, 'expired_token', 'the device code expired before it was approved');
}

// --- authorization code + PKCE (the browser fallback) -----------------------

export function createPkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  registerSecret(verifier);
  return { verifier, challenge };
}

export function buildAuthorizeUrl(clientId, challenge, state) {
  const url = new URL(COROS_ENDPOINTS.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: COROS_REDIRECT_URI,
    scope: COROS_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: COROS_MCP_URL,
    state,
  }).toString();
  return url.toString();
}

export async function exchangeCode(fetchImpl, { clientId, code, verifier }, now = Date.now()) {
  const body = await post(fetchImpl, COROS_ENDPOINTS.token, {
    form: {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: COROS_REDIRECT_URI,
      code_verifier: verifier,
    },
  });
  return toTokenSet(body, clientId, now);
}
