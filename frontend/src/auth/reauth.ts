/**
 * Module-level reauth callback registry.
 *
 * sheets.ts is a plain module (not a component) and cannot access Preact context.
 * auth-provider.tsx registers a reauth callback here at mount time, and sheets.ts
 * calls it when it encounters a 401 from the Sheets API.
 *
 * Flow:
 *   1. sheets.ts gets a 401 -> calls attemptReauth()
 *   2. attemptReauth() invokes the callback registered by auth-provider
 *   3. The callback calls GIS requestAccessToken({ prompt: '' }) for silent re-auth
 *   4. On success -> returns the new token; sheets.ts retries the failed call
 *   5. On failure -> throws; sheets.ts propagates the error
 */

/**
 * Error thrown when silent re-auth fails. Callers can check for this to
 * avoid showing duplicate error toasts (the onReauthFailed callback already
 * shows a toast and forces the user back to the login screen).
 */
export class ReauthFailedError extends Error {
  declare cause?: Error;
  constructor(cause?: Error) {
    super('Silent re-auth failed');
    this.name = 'ReauthFailedError';
    this.cause = cause;
  }
}

type ReauthCallback = () => Promise<string>;
type ReauthFailedCallback = () => void;

let _reauthCallback: ReauthCallback | null = null;
let _reauthFailedCallback: ReauthFailedCallback | null = null;

/** Track whether a reauth is already in progress to avoid concurrent attempts. */
let _reauthInProgress: Promise<string> | null = null;

/**
 * Register the reauth callback. Called once by auth-provider at mount time.
 * Returns a cleanup function to unregister.
 */
export function registerReauthCallback(cb: ReauthCallback): () => void {
  _reauthCallback = cb;
  return () => {
    _reauthCallback = null;
  };
}

/**
 * Register a callback for when reauth fails (user must re-login).
 * Called by auth-provider. The callback drops the token (keeping the remembered
 * user, #353) so the Continue screen shows.
 */
export function onReauthFailed(cb: ReauthFailedCallback): () => void {
  _reauthFailedCallback = cb;
  return () => {
    _reauthFailedCallback = null;
  };
}

/**
 * Attempt silent re-authentication. Called by sheets.ts on 401, and (quietly)
 * by the touch-armed renewal in auth-provider (#353).
 * Returns the new access token on success.
 * Throws on failure (no callback registered, or GIS reauth failed).
 *
 * Deduplicates concurrent reauth attempts — if one is already in progress,
 * subsequent callers wait for the same promise.
 *
 * `quiet` renewals run ahead of expiry while the old token still works, so a
 * failure must not sign the user out: it throws without calling the
 * reauth-failed callback. A non-quiet caller (the 401 path) always does.
 */
export async function attemptReauth({ quiet = false }: { quiet?: boolean } = {}): Promise<string> {
  if (!_reauthCallback) {
    throw new Error('No reauth callback registered');
  }

  if (!_reauthInProgress) {
    _reauthInProgress = _reauthCallback()
      .catch((err) => {
        throw new ReauthFailedError(err instanceof Error ? err : undefined);
      })
      .finally(() => {
        _reauthInProgress = null;
      });
  }

  try {
    return await _reauthInProgress;
  } catch (err) {
    if (!quiet) _reauthFailedCallback?.();
    throw err;
  }
}

/** Reset all state. Useful for testing. */
export function _resetForTesting(): void {
  _reauthCallback = null;
  _reauthFailedCallback = null;
  _reauthInProgress = null;
}
