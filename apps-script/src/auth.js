// Who is calling, and what they may do (#130, #144).
//
// Two kinds of caller:
//
// - A **key caller** sends `key`: the MCP server and the COROS sync. Full
//   access, exactly as before #144.
// - A **token caller** sends `access_token`, a Google access token from
//   almanac's own sign-in. almanac is a browser app on GitHub Pages, so it
//   cannot hold the key — a key in a public bundle is not a secret. A token
//   caller may run only the reads named in TOKEN_READ_ACTIONS.
//
// `access_token` present makes a token caller whatever else is sent, `key`
// included: privilege must never rise by adding a parameter.
//
// The token is a live credential. It must never reach a cache key, a log line,
// an error message or a response — so it is hashed before it touches the
// cache, nothing here logs, and every message below is fixed text.

/**
 * The reads a token caller may run. An allow-list, never a deny-list: an
 * action added to the dispatcher later is refused to token callers until
 * someone names it here. `token-auth.test.ts` fails when a `case` in main.js
 * is on neither this list nor the test's list of key-only actions.
 *
 * `previewSetUpdates` is deliberately absent although it writes nothing: it is
 * the dry run of a write, and takes a write payload.
 */
var TOKEN_READ_ACTIONS = [
  'getWorkouts',
  'getWorkout',
  'getPlannedWorkouts',
  'getExercises',
  'getExercise',
  'getExerciseHistory',
  'getTemplates',
  'getTemplate',
  'getSets',
  'getWorkoutSets',
  'getDailySummary',
  'getHistoryDateRange',
  'getDailyHealth',
  'getSyncLog',
  'getBodyMeasurements',
];

var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** Namespace for cached verdicts, so they cannot collide with anything else. */
var TOKEN_CACHE_PREFIX = 'thrive_tok:';

/** A refusal is remembered for five minutes, so a bad token cannot burn quota. */
var TOKEN_REFUSED_TTL_S = 300;

/** An acceptance is forgotten a minute before the token itself expires... */
var TOKEN_EXPIRY_MARGIN_S = 60;

/** ...and never kept longer than an hour, the life of a Google access token. */
var TOKEN_ACCEPTED_TTL_CAP_S = 3600;

/**
 * What a refused token caller is told. One sentence per code, so a verdict
 * read back from the cache says exactly what a fresh one would. None of them
 * quotes the token, the email or anything else tokeninfo said.
 */
var TOKEN_REFUSAL_MESSAGES = {
  token_invalid: 'Access token is invalid or expired. Sign in again.',
  token_forbidden:
    'Access token is not permitted: it was issued to a different OAuth client or a ' +
    'different Google account than TOKEN_CLIENT_ID / TOKEN_ALLOWED_EMAIL allow.',
  token_unavailable: 'Could not reach Google to verify the access token. Try again.',
  unauthorized_scope:
    'The script is not yet allowed to call Google to verify tokens: its owner must ' +
    're-authorize it for the script.external_request scope.',
  unconfigured:
    'Token access is not configured: TOKEN_CLIENT_ID and TOKEN_ALLOWED_EMAIL must both ' +
    'be set in script properties.',
};

/**
 * The key lives in script properties, never in source — this file is in a
 * public repo. An unconfigured key is an error, not an open door.
 */
function validateApiKey(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected) throw new Error('API_KEY not configured in script properties');
  return key === expected;
}

/**
 * Decide who is calling. Returns `{ mode: 'key' }`, `{ mode: 'token' }`, or
 * `{ refusal }` — a failure envelope to send back as it is.
 */
function resolveCaller(params) {
  if (params.access_token !== undefined && params.access_token !== null) {
    var verdict = verifyAccessToken(params.access_token);
    if (verdict === 'ok') return { mode: 'token' };
    // Both are the owner's to fix, and reconnecting cannot: "set up wrong".
    var code = verdict === 'unconfigured' || verdict === 'unauthorized_scope'
      ? 'token_forbidden' : verdict;
    return { refusal: fail(TOKEN_REFUSAL_MESSAGES[verdict], code) };
  }
  if (!validateApiKey(params.key)) return { refusal: fail('Invalid or missing API key') };
  return { mode: 'key' };
}

function isTokenReadAction(action) {
  return TOKEN_READ_ACTIONS.indexOf(action) !== -1;
}

function trimmedProperty(props, name) {
  var value = props.getProperty(name);
  return value ? String(value).trim() : '';
}

/**
 * Verify a Google access token. Returns `'ok'`, `'token_invalid'`,
 * `'token_forbidden'`, `'token_unavailable'`, `'unconfigured'` or
 * `'unauthorized_scope'`.
 *
 * Either property unset refuses every token call before anything is fetched,
 * exactly as validateApiKey treats a missing API_KEY: unconfigured is an
 * error, not an open door.
 */
function verifyAccessToken(token) {
  var props = PropertiesService.getScriptProperties();
  var clientId = trimmedProperty(props, 'TOKEN_CLIENT_ID');
  var allowedEmail = trimmedProperty(props, 'TOKEN_ALLOWED_EMAIL').toLowerCase();
  if (!clientId || !allowedEmail) return 'unconfigured';

  if (typeof token !== 'string' || token === '') return 'token_invalid';

  // The properties are folded into the digest, so correcting a mis-set one
  // invalidates every verdict cached under the old value at once.
  var cacheKey = TOKEN_CACHE_PREFIX + sha256Hex(token + '|' + clientId + '|' + allowedEmail);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached === 'ok' || cached === 'token_invalid' || cached === 'token_forbidden') {
    return cached;
  }

  var checked = checkTokenInfo(token, clientId, allowedEmail);
  // Unreachable is not a verdict on the token, and a missing scope is the
  // owner's to fix, so neither is remembered.
  if (checked.ttl > 0) {
    cache.put(cacheKey, checked.verdict, checked.ttl);
  }
  return checked.verdict;
}

/**
 * Ask Google about the token. Returns `{ verdict, ttl }`, `ttl` in seconds.
 *
 * Google answers 400 `invalid_token` for an expired, revoked or bogus token
 * alike, so all three are `token_invalid` — there is no telling them apart.
 */
function checkTokenInfo(token, clientId, allowedEmail) {
  var refused = function (verdict) { return { verdict: verdict, ttl: TOKEN_REFUSED_TTL_S }; };

  var response;
  try {
    response = UrlFetchApp.fetch(
      TOKENINFO_URL + '?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    // UrlFetchApp's own message quotes the URL, and so the token. It is only
    // inspected here, never passed on: the caller gets fixed text.
    //
    // appsscript.json pins no scopes, so UrlFetchApp's arrived inferred, and
    // until the owner re-authorizes the script every fetch is refused. That
    // is a setup fault, not an outage, and it should say so.
    if (/permission/i.test(String((err && err.message) || err))) {
      return { verdict: 'unauthorized_scope', ttl: 0 };
    }
    return { verdict: 'token_unavailable', ttl: 0 };
  }

  var status = response.getResponseCode();
  // Google's own trouble is not a verdict on the token either.
  if (status === 429 || status >= 500) return { verdict: 'token_unavailable', ttl: 0 };
  if (status !== 200) return refused('token_invalid');

  var info;
  try {
    info = JSON.parse(response.getContentText());
  } catch (err) {
    return refused('token_invalid');
  }
  if (!info || typeof info !== 'object' || Array.isArray(info)) return refused('token_invalid');

  if (info.aud !== clientId) return refused('token_forbidden');
  if (info.azp !== undefined && info.azp !== null && info.azp !== clientId) {
    return refused('token_forbidden');
  }

  var email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
  if (!email || email !== allowedEmail) return refused('token_forbidden');
  // tokeninfo sends the string "true"; a boolean is accepted too.
  if (info.email_verified !== true && info.email_verified !== 'true') {
    return refused('token_forbidden');
  }

  var expiresIn = parseExpiresIn(info.expires_in);
  if (!(expiresIn > 0)) return refused('token_invalid');

  // Not cached at all when it would outlive the token (ttl <= 0): the next
  // call simply asks again.
  return {
    verdict: 'ok',
    ttl: Math.min(expiresIn - TOKEN_EXPIRY_MARGIN_S, TOKEN_ACCEPTED_TTL_CAP_S),
  };
}

/** tokeninfo sends `expires_in` as a string of digits. Anything else is NaN. */
function parseExpiresIn(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
function sha256Hex(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    // computeDigest returns signed bytes, -128..127.
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * Belt and braces for handleRequest: if any error message on its way out
 * contains the caller's token — a thrown error, or an action echoing a
 * parameter — the token is cut out of it.
 */
function withoutToken(message, token) {
  if (typeof token !== 'string' || token === '') return message;
  // Both spellings: a URL quoted in an error carries the encoded one.
  return String(message)
    .split(token).join('[redacted]')
    .split(encodeURIComponent(token)).join('[redacted]');
}
