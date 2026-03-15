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
 * Called by auth-provider. The callback should clear cached auth and show login.
 */
export function onReauthFailed(cb: ReauthFailedCallback): () => void {
  _reauthFailedCallback = cb;
  return () => {
    _reauthFailedCallback = null;
  };
}

/**
 * Attempt silent re-authentication. Called by sheets.ts on 401.
 * Returns the new access token on success.
 * Throws on failure (no callback registered, or GIS reauth failed).
 *
 * Deduplicates concurrent reauth attempts — if one is already in progress,
 * subsequent callers wait for the same promise.
 */
export async function attemptReauth(): Promise<string> {
  if (!_reauthCallback) {
    throw new Error('No reauth callback registered');
  }

  // Deduplicate: if a reauth is already in flight, piggyback on it
  if (_reauthInProgress) {
    return _reauthInProgress;
  }

  _reauthInProgress = _reauthCallback()
    .catch((err) => {
      // Reauth failed — notify auth-provider to clear state and show login
      _reauthFailedCallback?.();
      throw new ReauthFailedError(err instanceof Error ? err : undefined);
    })
    .finally(() => {
      _reauthInProgress = null;
    });

  return _reauthInProgress;
}

/** Reset all state. Useful for testing. */
export function _resetForTesting(): void {
  _reauthCallback = null;
  _reauthFailedCallback = null;
  _reauthInProgress = null;
}
