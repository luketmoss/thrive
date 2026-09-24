// The failures a run can end in. Each one names the thing a person has to do,
// because the person reading it is looking at a GitHub Actions failure email,
// not at this code.

/**
 * The COROS grant is gone: its refresh token was refused, and re-reading Drive
 * did not turn up a newer one. Only a person can fix it.
 */
export class CorosGrantDeadError extends Error {
  constructor(detail) {
    super(
      `COROS refused the stored refresh token (${detail}). The grant is dead — ` +
      're-run `node sync/authorize.mjs` to authorize again. See sync/README.md.',
    );
    this.name = 'CorosGrantDeadError';
  }
}

/** COROS did not answer usefully after retrying. Not a credential problem. */
export class CorosUnavailableError extends Error {
  constructor(detail) {
    super(
      `COROS is unavailable (${detail}). Nothing needs re-authorizing; the next ` +
      'run retries. COROS has a history of outages (sync plan §2).',
    );
    this.name = 'CorosUnavailableError';
  }
}

/**
 * The bot account's Google credential is missing or refused. Distinct from
 * CorosGrantDeadError, so it is obvious which of the two sign-ins to redo.
 */
export class DriveAuthError extends Error {
  constructor(detail) {
    super(
      `Google refused the sync's Drive credential (${detail}). Re-run ` +
      '`node sync/google-authorize.mjs` as luketmossbot@gmail.com and update the ' +
      'GOOGLE_DRIVE_REFRESH_TOKEN secret. See sync/README.md.',
    );
    this.name = 'DriveAuthError';
  }
}

/**
 * A refreshed token could not be saved. The run stops before using it: the
 * old refresh token is already spent, so the new one exists only in memory
 * and the next run will need `authorize.mjs` unless this one is retried.
 */
export class TokenPersistError extends Error {
  constructor(detail) {
    super(
      `A rotated COROS token could not be written to Drive (${detail}). The run ` +
      'stopped before using it. If the next run reports a dead grant, re-run ' +
      '`node sync/authorize.mjs`.',
    );
    this.name = 'TokenPersistError';
  }
}

/** An OAuth error response, before it is classified. */
export class OAuthError extends Error {
  constructor(status, code, description) {
    super(`${status} ${code}${description ? `: ${description}` : ''}`);
    this.name = 'OAuthError';
    this.status = status;
    this.code = code;
  }
}
