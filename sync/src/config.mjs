// Constants the whole sync shares. Nothing here is a secret.

/**
 * COROS's authorization server. `mcp.coros.com` publishes the same metadata
 * and routes US accounts here (#133), so the issuer is named directly rather
 * than discovered on every run.
 */
export const COROS_ISSUER = 'https://mcpus.coros.com';
export const COROS_MCP_URL = 'https://mcpus.coros.com/mcp';
export const COROS_ENDPOINTS = {
  register: `${COROS_ISSUER}/connect/register`,
  authorize: `${COROS_ISSUER}/oauth2/authorize`,
  device: `${COROS_ISSUER}/oauth2/device_authorization`,
  token: `${COROS_ISSUER}/oauth2/token`,
};

/** `offline_access` is what earns a refresh token. Matches COROS's own client. */
export const COROS_SCOPES = 'openid offline_access mcp.tools';
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** The browser fallback's redirect. Fixed, because it is registered with the client. */
export const COROS_REDIRECT_URI = 'http://127.0.0.1:43123/callback';

/**
 * Refresh only when the access token is this close to expiry (#151 AC2).
 *
 * Access tokens live 30 days, and every refresh rotates the refresh token.
 * Refreshing on each run would rotate several times a day, and each rotation
 * is a window in which a crash between refresh and persist loses the grant.
 * Refreshing near expiry makes that about once a month.
 */
export const REFRESH_WITHIN_MS = 5 * 24 * 60 * 60 * 1000;

/** The only Drive scope the sync holds: files it created, nothing else. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** The sync's Drive folder, and how its files are found again. */
export const DRIVE_ROOT_FOLDER = 'Thrive COROS';
export const APP_PROPERTY_ROOT = { kind: 'thrive-coros-root' };
export const APP_PROPERTY_TOKEN = { kind: 'coros-token' };

/**
 * Every date the sync computes is local to this zone, never the runner's
 * clock: Actions runners are UTC, and 6 pm in Denver is already tomorrow there.
 */
export const SYNC_TIME_ZONE = 'America/Denver';

/**
 * The rolling window (#152): D − 10 days to D + 1 day, where D is the local run
 * date. Ten days back, not sync plan §6's seven, because a multi-day
 * backpacking trip reaches the COROS cloud only when the phone gets signal
 * again (§6, §17 item 2). The extra calls are summary-level, and an unchanged
 * payload is re-read but never re-written. The day ahead is a time-zone guard.
 * #153 and #156 inherit these.
 */
export const WINDOW_DAYS_BACK = 10;
export const WINDOW_DAYS_AHEAD = 1;

/** `querySleepHrv` refuses a range longer than this (#133). */
export const HRV_MAX_DAYS = 7;

/** Well above a 12-day window's worth, so the list is never truncated. */
export const SPORT_RECORDS_LIMIT = 100;

/** Folders under `Thrive COROS`, found again by this property plus their path. */
export const APP_PROPERTY_FOLDER_KIND = 'thrive-coros-folder';
