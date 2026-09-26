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

// --- Withings (#196) --------------------------------------------------------

/**
 * Withings' authorization page and its one API host. The token endpoint and
 * the data endpoints both answer HTTP 200 and report failure in the body's
 * `status` (see `WITHINGS_STATUS` in withings-oauth.mjs).
 */
export const WITHINGS_ENDPOINTS = {
  authorize: 'https://account.withings.com/oauth2_user/authorize2',
  token: 'https://wbsapi.withings.net/v2/oauth2',
  measure: 'https://wbsapi.withings.net/measure',
};

/** Comma-separated, as Withings wants them. */
export const WITHINGS_SCOPES = 'user.metrics,user.info';

/**
 * The static page that shows the code for pasting back into the terminal.
 * Withings refuses localhost and IP redirects, so there is no loopback option,
 * and the URL must match the developer app's registered callback exactly.
 */
export const WITHINGS_REDIRECT_URI = 'https://luketmoss.github.io/thrive/withings-callback.html';

/**
 * Refresh when the access token has less than this left. Withings access
 * tokens live 3 hours, so with runs 6 hours apart nearly every run rotates:
 * persist-before-use is what keeps that safe, not rarity.
 */
export const WITHINGS_REFRESH_WITHIN_MS = 15 * 60 * 1000;

/**
 * Withings keeps its own Drive root. `drive.file` sees only the sync's own
 * files, and a separate root with its own tags means no lookup can ever match
 * a COROS file.
 */
export const WITHINGS_DRIVE_ROOT_FOLDER = 'Thrive Withings';
export const WITHINGS_APP_PROPERTY_ROOT = { kind: 'thrive-withings-root' };
export const WITHINGS_APP_PROPERTY_TOKEN = { kind: 'withings-token' };
export const WITHINGS_TOKEN_FILE_NAME = 'withings-token.json';

/** Folders under `Thrive Withings`, found again by this property plus their path (#197). */
export const WITHINGS_APP_PROPERTY_FOLDER_KIND = 'thrive-withings-folder';

/**
 * The measures window (#197): local D − 30 days to D + 1, in SYNC_TIME_ZONE.
 * Re-reading 30 days, rather than asking for changes since the last run with
 * `lastupdate`, is what picks up edits made in the Withings app. A scale and a
 * cuff produce a few groups a day, so that is one or two pages.
 */
export const WITHINGS_WINDOW_DAYS_BACK = 30;
export const WITHINGS_WINDOW_DAYS_AHEAD = 1;

/** `getmeas` category 1: real measurements, not user objectives. */
export const WITHINGS_MEASURE_CATEGORY = 1;

/**
 * The measure types asked for (#197): weight (1), fat-free mass (5), fat ratio
 * (6), fat mass (8), diastolic (9) and systolic (10) blood pressure, heart
 * pulse (11, the cuff's and the scale's standing heart rate alike), muscle
 * mass (76), hydration (77) and bone mass (88). All are in the free plan. A
 * listed type keeps any paid-plan type out even if the account gains one.
 */
export const WITHINGS_MEASURE_TYPES = [1, 5, 6, 8, 9, 10, 11, 76, 77, 88];
