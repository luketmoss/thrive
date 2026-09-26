// Withings OAuth 2.0 (#196): authorization code with a client ID and secret,
// the code exchange, the refresh, and how a Withings answer is classified.
// Every function takes its `fetch` so tests need no network.
//
// Withings answers HTTP 200 for most failures and puts the verdict in the
// body's `status`. So the verdict is read from `status`, through the one table
// below, and HTTP is only consulted when there is no body to read.

import {
  WITHINGS_ENDPOINTS, WITHINGS_REDIRECT_URI, WITHINGS_SCOPES,
} from './config.mjs';
import { WithingsApiError } from './errors.mjs';
import { redact, registerSecret } from './redact.mjs';

// --- status classification --------------------------------------------------

/**
 * Withings' published response statuses
 * (https://developer.withings.com/api-reference/#section/Response-status),
 * grouped by what the sync does about them. The groups follow Withings' own
 * labels for each status.
 *
 * - `ok`: success.
 * - `auth`: "Authentication failed" and "Unauthorized". The grant or the
 *   access token was refused: a dead grant once Drive holds nothing newer.
 * - `params`: "Invalid params". At the token endpoint this is how an expired,
 *   spent or unknown code or refresh token is refused, so there it counts as a
 *   refused grant; anywhere else it is a request the sync built wrongly.
 * - `unavailable`: "An error occurred", "Timeout", "Too many requests" and
 *   "An unknown error occurred". Retried with backoff, never a dead grant.
 * - `request`: "Bad state" and "Wrong action or wrong webservice". A bug in
 *   the sync; retrying and re-authorizing are both pointless.
 *
 * A status not listed here is treated as `request`: it is reported with its
 * number, never guessed to be an outage or a dead grant.
 */
export const WITHINGS_STATUS = Object.freeze({
  ok: [0],
  auth: [100, 101, 102, 200, 214, 277, 401],
  params: [
    201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 216, 217, 218, 220, 221,
    223, 225, 227, 228, 229, 230, 234, 235, 236, 238, 240, 241, 242, 243, 244, 245, 246, 247,
    248, 249, 250, 251, 252, 254, 260, 261, 262, 263, 264, 265, 266, 267, 271, 272, 275, 276,
    283, 284, 285, 286, 287, 288, 290, 293, 294, 295, 297, 300, 301, 302, 303, 304, 321, 323,
    324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341,
    342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 380, 381, 382, 400, 501, 502,
    503, 504, 505, 506, 509, 510, 511, 523, 532, 3017, 3018, 3019,
  ],
  unavailable: [
    215, 219, 222, 224, 226, 231, 233, 237, 253, 255, 256, 257, 258, 259, 268, 269, 270, 273,
    274, 278, 279, 280, 281, 282, 289, 291, 292, 296, 298, 305, 306, 308, 309, 310, 311, 312,
    313, 314, 315, 316, 317, 318, 319, 320, 322, 370, 371, 372, 373, 374, 375, 383, 391, 402,
    516, 517, 518, 519, 520, 521, 522, 525, 526, 527, 528, 529, 530, 531, 533, 601, 602, 700,
    1051, 1052, 1053, 1054, 2551, 2552, 2555, 2556, 2557, 2558, 2559, 3000, 3001, 3002, 3003,
    3004, 3005, 3006, 3007, 3008, 3009, 3010, 3011, 3012, 3013, 3014, 3015, 3016, 3020, 3021,
    3022, 3023, 3024, 5000, 5001, 5005, 5006, 6000, 6010, 6011, 9000, 10000,
  ],
  request: [524, 2553, 2554],
});

const CATEGORY_BY_STATUS = new Map(
  Object.entries(WITHINGS_STATUS).flatMap(([category, codes]) => codes.map((c) => [c, category])),
);

/** The WITHINGS_STATUS row a status belongs to; `request` for an unknown one. */
export function classifyWithingsStatus(status) {
  return CATEGORY_BY_STATUS.get(Number(status)) ?? 'request';
}

/** The refresh token or authorization code itself was refused. */
export const isWithingsInvalidGrant = (err) =>
  err instanceof WithingsApiError &&
  (err.category === 'auth' || (err.category === 'params' && err.endpoint === 'token'));

/** Worth another attempt: the network, an HTTP 5xx or 429, or an `unavailable` status. */
export const isWithingsTransient = (err) =>
  !(err instanceof WithingsApiError) || err.category === 'unavailable';

// --- requests ---------------------------------------------------------------

/**
 * POSTs a form and returns the body's `body`. Throws WithingsApiError for a
 * non-zero `status` or an HTTP failure, and lets a network failure through
 * untouched (it is transient). Withings' `error` text is redacted before it is
 * kept, because it can echo what was sent.
 */
async function post(fetchImpl, endpoint, form, { accessToken } = {}) {
  const res = await fetchImpl(WITHINGS_ENDPOINTS[endpoint], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* handled below */ }

  if (!res.ok && (res.status >= 500 || res.status === 429 || !parsed?.status)) {
    throw new WithingsApiError({
      httpStatus: res.status,
      category: res.status >= 500 || res.status === 429 ? 'unavailable' : 'request',
      endpoint,
      detail: redact(text.slice(0, 200)),
    });
  }
  if (typeof parsed?.status !== 'number') {
    // A 200 that is not Withings JSON: a proxy or maintenance page.
    throw new WithingsApiError({
      httpStatus: res.status, category: 'unavailable', endpoint, detail: 'response is not Withings JSON',
    });
  }
  if (parsed.status !== 0) {
    throw new WithingsApiError({
      httpStatus: res.status,
      status: parsed.status,
      category: classifyWithingsStatus(parsed.status),
      endpoint,
      detail: redact(String(parsed.error ?? '').slice(0, 200)),
    });
  }
  return parsed.body ?? {};
}

// --- OAuth ------------------------------------------------------------------

export function buildWithingsAuthorizeUrl(clientId, state) {
  const url = new URL(WITHINGS_ENDPOINTS.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: WITHINGS_SCOPES,
    redirect_uri: WITHINGS_REDIRECT_URI,
    state,
  }).toString();
  return url.toString();
}

/**
 * The stored shape (#196 AC2). `access_expires_at` is absolute, so a run can
 * decide whether to refresh without knowing when the token was issued.
 */
export function toWithingsTokenSet(body, now = Date.now()) {
  if (!body.access_token || !body.refresh_token) {
    throw new WithingsApiError({
      httpStatus: 200, status: 0, category: 'request', endpoint: 'token',
      detail: 'token response is missing a token',
    });
  }
  registerSecret(body.access_token);
  registerSecret(body.refresh_token);
  const expiresIn = Number(body.expires_in) || 10800;
  return {
    userid: body.userid === undefined ? null : String(body.userid),
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    access_expires_at: new Date(now + expiresIn * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
}

/** Exchanges an authorization code. It is valid for 30 s, so call this at once. */
export async function exchangeWithingsCode(fetchImpl, { clientId, clientSecret, code }, now = Date.now()) {
  registerSecret(clientSecret);
  registerSecret(code);
  const body = await post(fetchImpl, 'token', {
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: WITHINGS_REDIRECT_URI,
  });
  return toWithingsTokenSet(body, now);
}

/** One refresh. The response carries the rotated refresh token. */
export async function refreshWithings(fetchImpl, { clientId, clientSecret, refreshToken }, now = Date.now()) {
  registerSecret(clientSecret);
  registerSecret(refreshToken);
  const body = await post(fetchImpl, 'token', {
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return toWithingsTokenSet(body, now);
}

/**
 * One authenticated `user.metrics` call, to prove a new grant works: the
 * measure groups of the last 30 days. Returns only how many there were.
 */
export async function countRecentMeasureGroups(fetchImpl, accessToken, now = Date.now()) {
  const body = await post(fetchImpl, 'measure', {
    action: 'getmeas',
    startdate: String(Math.floor(now / 1000) - 30 * 86400),
    enddate: String(Math.floor(now / 1000)),
  }, { accessToken });
  return Array.isArray(body.measuregrps) ? body.measuregrps.length : 0;
}

/**
 * What the user pasted: the callback page's `code=…&state=…`, the whole
 * callback URL, or a bare code. Returns `{ code, state, error }`, each null
 * when absent.
 */
export function parseWithingsPaste(text) {
  const raw = String(text ?? '').trim();
  let params = null;
  if (/^https?:\/\//i.test(raw)) {
    try { params = new URL(raw).searchParams; } catch { params = null; }
  } else if (/(^|[?&])(code|error|state)=/.test(raw)) {
    params = new URLSearchParams(raw.replace(/^\?/, ''));
  }
  if (!params) return { code: raw || null, state: null, error: null };
  return {
    code: params.get('code') || null,
    state: params.get('state') || null,
    error: params.get('error') || null,
  };
}
