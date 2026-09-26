// The COROS access token a run uses, and the rules rotation puts on getting
// it (sync plan §4, #151 AC2–AC3):
//
// - Refresh only near expiry. Access tokens live 30 days; refreshing within 5
//   days of expiry rotates about monthly instead of on every run.
// - Persist before use. The old refresh token is spent the moment COROS
//   answers, so the new one is written to Drive before anything else happens.
// - A rejected refresh is not proof the grant is dead. Replaying a superseded
//   token fails without revoking the chain (#133), so the likeliest cause is
//   another process that rotated first: re-read Drive and retry once.

import { refresh } from './coros-oauth.mjs';
import { REFRESH_WITHIN_MS } from './config.mjs';
import {
  CorosGrantDeadError, CorosUnavailableError, DriveAuthError, OAuthError, TokenPersistError,
} from './errors.mjs';
import { redact, registerSecret } from './redact.mjs';
import { withRetry } from './retry.mjs';

const isInvalidGrant = (err) => err instanceof OAuthError && err.code === 'invalid_grant';

/** Worth another attempt: the network, a 5xx, or throttling. Never a refusal. */
export const isTransient = (err) =>
  !(err instanceof OAuthError) || err.status >= 500 || err.status === 429;

/** Anything that is not an invalid_grant, as the error a run ends in. */
function classify(err) {
  if (err instanceof OAuthError && !isTransient(err)) return new CorosGrantDeadError(err.code);
  return new CorosUnavailableError(redact(err.message || String(err)));
}

/**
 * @returns {Promise<{ accessToken: string, clientId: string, refreshed: boolean }>}
 */
export async function getAccessToken({
  store,
  fetchImpl = fetch,
  now = () => Date.now(),
  force = false,
  retry = {},
}) {
  const current = await store.load();
  if (!current?.refresh_token || !current?.client_id) {
    throw new CorosGrantDeadError('no COROS token file in Drive');
  }
  registerSecret(current.access_token);
  registerSecret(current.refresh_token);

  const expiresAt = Date.parse(current.access_expires_at);
  if (!force && current.access_token && expiresAt - now() > REFRESH_WITHIN_MS) {
    return { accessToken: current.access_token, clientId: current.client_id, refreshed: false };
  }

  const next = await rotateAndPersist({
    store,
    current,
    refresh: (tokens) => withRetry(
      () => refresh(fetchImpl, { clientId: tokens.client_id, refreshToken: tokens.refresh_token }, now()),
      { isRetryable: isTransient, ...retry },
    ),
    isInvalidGrant,
    classify,
    grantDead: (err) => new CorosGrantDeadError(err.code),
    persistError: (detail) => new TokenPersistError(detail),
  });
  return { accessToken: next.access_token, clientId: next.client_id, refreshed: true };
}

/**
 * The rotation rules both vendors share (#196): one refresh, a single re-read
 * of Drive when the refresh token is refused, and persist before use.
 *
 * - `refresh(tokens)` makes one refresh, with its own retries, and returns the
 *   new set or throws.
 * - `isInvalidGrant(err)` says the refresh token itself was refused.
 * - `classify(err)` turns any other failure into the error the run ends in.
 * - `grantDead(err)` and `persistError(detail)` build the vendor's errors.
 *
 * Only a *different* refresh token in Drive is worth presenting after a
 * refusal: the same one would be refused the same way.
 */
export async function rotateAndPersist({
  store, current, refresh: refreshOnce, isInvalidGrant: invalid, classify: toRunError,
  grantDead, persistError,
}) {
  let next;
  try {
    next = await refreshOnce(current);
  } catch (err) {
    if (!invalid(err)) throw toRunError(err);

    // Someone else may have rotated first.
    const latest = await store.load();
    if (!latest?.refresh_token || latest.refresh_token === current.refresh_token) {
      throw grantDead(err);
    }
    try {
      next = await refreshOnce(latest);
    } catch (retryErr) {
      if (invalid(retryErr)) throw grantDead(retryErr);
      throw toRunError(retryErr);
    }
  }

  try {
    await store.save(next);
  } catch (err) {
    if (err instanceof DriveAuthError) throw err;
    throw persistError(redact(err.message || String(err)));
  }
  return next;
}
