// The Withings access token a run uses (#196 AC3). The rules are COROS's
// (tokens.mjs), shared through `rotateAndPersist`, with one difference:
//
// - Refresh within 15 minutes of expiry, not 5 days. Withings access tokens
//   live 3 hours, so with runs 6 hours apart nearly every run rotates. That
//   makes persist-before-use, and one run at a time, load-bearing.

import { WITHINGS_REFRESH_WITHIN_MS } from './config.mjs';
import {
  WithingsApiError, WithingsGrantDeadError, WithingsRequestError, WithingsTokenPersistError,
  WithingsUnavailableError,
} from './errors.mjs';
import { redact, registerSecret } from './redact.mjs';
import { withRetry } from './retry.mjs';
import { rotateAndPersist } from './tokens.mjs';
import { isWithingsInvalidGrant, isWithingsTransient, refreshWithings } from './withings-oauth.mjs';

/** Any Withings failure, as the error a run ends in. */
export function classifyWithingsError(err) {
  const detail = redact(err?.message || String(err));
  if (isWithingsInvalidGrant(err)) return new WithingsGrantDeadError(detail);
  if (err instanceof WithingsApiError && err.category !== 'unavailable') return new WithingsRequestError(detail);
  return new WithingsUnavailableError(detail);
}

/**
 * @returns {Promise<{ accessToken: string, userid: string|null, refreshed: boolean }>}
 */
export async function getWithingsAccessToken({
  store,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = () => Date.now(),
  force = false,
  retry = {},
}) {
  if (!clientId || !clientSecret) {
    throw new Error('WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET are not both set. See sync/README.md.');
  }
  registerSecret(clientSecret);
  const current = await store.load();
  if (!current?.refresh_token) {
    throw new WithingsGrantDeadError('no Withings token file in Drive');
  }
  registerSecret(current.access_token);
  registerSecret(current.refresh_token);

  const expiresAt = Date.parse(current.access_expires_at);
  if (!force && current.access_token && expiresAt - now() > WITHINGS_REFRESH_WITHIN_MS) {
    return { accessToken: current.access_token, userid: current.userid ?? null, refreshed: false };
  }

  const next = await rotateAndPersist({
    store,
    current,
    refresh: (tokens) => withRetry(
      () => refreshWithings(fetchImpl, { clientId, clientSecret, refreshToken: tokens.refresh_token }, now()),
      { isRetryable: isWithingsTransient, ...retry },
    ),
    isInvalidGrant: isWithingsInvalidGrant,
    classify: classifyWithingsError,
    grantDead: (err) => new WithingsGrantDeadError(redact(err.message)),
    persistError: (detail) => new WithingsTokenPersistError(detail),
  });
  return { accessToken: next.access_token, userid: next.userid ?? null, refreshed: true };
}
