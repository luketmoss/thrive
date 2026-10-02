// SyncRequests poller (#314) — the server half of on-demand sync (#232 route c).
//
// The SPA (#315) appends one `requested` row per vendor to the SyncRequests
// tab. pollSyncRequests, an installable time-driven trigger on the bot account,
// reads the open rows and starts the EXISTING coros-sync.yml / withings-sync.yml
// through GitHub's workflow-dispatch API, then closes every row it started.
// It never runs run.mjs itself: those workflows' concurrency groups are what
// stop two runs presenting the same rotating refresh token.
//
// What reaches GitHub is fixed here, never taken from the row: the owner, repo,
// ref and workflow file are constants, the body is always {"ref":"main"} with
// no `inputs` key (so force_refresh, backfill and max_deletions keep their
// defaults), and the row's vendor only selects a key in SYNC_VENDOR_CONFIG.
//
// None of this is reachable from the web app: main.js has no `case` for any
// function here, so doGet answers "Unknown action" for them. The trigger runs
// the project's latest PUSHED code, not a deployment.
//
// The GitHub token lives only in the script property named below, is read only
// here, and goes only into the Authorization header. No sheet cell, log line or
// thrown message may carry it, nor GitHub's response body.

var SYNC_REQUESTS_SHEET = 'SyncRequests';

var SYNC_GITHUB_OWNER = 'luketmoss';
var SYNC_GITHUB_REPO = 'thrive';
var SYNC_GITHUB_REF = 'main';
var SYNC_GITHUB_API_VERSION = '2026-03-10';
var SYNC_DISPATCH_TOKEN_PROPERTY = 'GITHUB_DISPATCH_TOKEN';

/** vendor -> the workflow it dispatches, the tab its runs log to, its name in words. */
var SYNC_VENDOR_CONFIG = {
  coros: { workflow: 'coros-sync.yml', logTab: 'SyncLog', name: 'COROS' },
  withings: { workflow: 'withings-sync.yml', logTab: 'WithingsSyncLog', name: 'Withings' },
};

/** The trigger's interval. ClockTriggerBuilder allows 1, 5, 10, 15, 30; #331 decides 1 vs 5. */
var SYNC_POLL_MINUTES = 5;
/** A vendor whose newest run started less than this ago is not dispatched again. */
var SYNC_COOLDOWN_MINUTES = 10;
/** A `requested` row this old is `expired`; a `started` row this long after dispatch is `not_reported`. */
var SYNC_CEILING_MINUTES = 20;
/** How long a tick waits for the script lock before doing nothing. */
var SYNC_LOCK_WAIT_MS = 5000;

var SYNC_POLL_HANDLER = 'pollSyncRequests';

var SYNC_REQUEST_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

var SYNC_MINUTE_MS = 60 * 1000;

// --- Detail sentences (column I). Each case keeps its own sentence. ----------

var SYNC_PROPERTY_WHERE =
  '(Apps Script → Project Settings → Script Properties, as luketmossbot)';

var SYNC_DETAIL = {
  noRunId: "GitHub started the run but did not return its id, so its result can't be matched.",
  noToken: 'Not started: no GitHub token is set. Store one as the script property ' +
    SYNC_DISPATCH_TOKEN_PROPERTY + ' ' + SYNC_PROPERTY_WHERE + '.',
  refused401: 'Not started: GitHub refused the token (401). It has expired or been revoked. ' +
    'Store a new one as ' + SYNC_DISPATCH_TOKEN_PROPERTY + ' ' + SYNC_PROPERTY_WHERE + '.',
  refused403: 'Not started: GitHub refused the request (403). The token may lack Actions: ' +
    'Read and write on ' + SYNC_GITHUB_OWNER + '/' + SYNC_GITHUB_REPO + ", or GitHub's rate limit was hit.",
  unreachable: 'Not started: GitHub could not be reached. Ask again later.',
  expired: 'Not started: this request was not picked up within ' + SYNC_CEILING_MINUTES +
    ' minutes. The next scheduled sync will run as usual.',
  cancelled: 'GitHub cancelled the run, usually because a scheduled sync took its place.',
  notReported: 'No result ' + SYNC_CEILING_MINUTES +
    ' minutes after the run was started. The next scheduled sync will try again.',
  blankId: 'Not started: request_id is blank.',
  badTime: 'Not started: requested_at is not an ISO 8601 time.',
  rowError: 'The poller hit an unexpected error on this request. Ask again later.',
};

function syncDetailUnknownVendor(vendor) {
  return 'Not started: "' + vendor + '" is not a vendor Thrive can sync. Use ' +
    SYNC_REQUEST_VENDORS.join(' or ') + '.';
}

function syncDetailHttp(code, workflow) {
  if (code === 401) return SYNC_DETAIL.refused401;
  if (code === 403) return SYNC_DETAIL.refused403;
  if (code === 404) {
    return 'Not started: GitHub could not find ' + workflow + ' (404). The token may not include ' +
      SYNC_GITHUB_OWNER + '/' + SYNC_GITHUB_REPO + '.';
  }
  if (code === 422) {
    return 'Not started: GitHub would not start ' + workflow + ' (422). The workflow may be disabled.';
  }
  return 'Not started: GitHub answered ' + code + '. Ask again later.';
}

function syncDetailAlreadyOpen(vendorName, requestedAtMs) {
  return 'Not started: a ' + vendorName + ' sync asked for at ' + syncClock(requestedAtMs) +
    ' is already under way.';
}

function syncDetailCooldown(vendorName, startedMs) {
  return 'Not started: a ' + vendorName + ' sync started at ' + syncClock(startedMs) +
    '. Ask again after ' + syncClock(startedMs + SYNC_COOLDOWN_MINUTES * SYNC_MINUTE_MS) + '.';
}

function syncDetailDone(logStatus, logTab, runId) {
  return 'Finished: the run logged ' + (logStatus || 'no status') + ' in ' + logTab + ' (' + runId + ').';
}

/** GitHub's conclusion in words. Only a plain lowercase word passes through. */
function syncConclusionInWords(conclusion) {
  var words = { failure: 'failed', timed_out: 'timed out', startup_failure: 'failed to start' };
  if (Object.prototype.hasOwnProperty.call(words, conclusion)) return words[conclusion];
  return /^[a-z_]{1,40}$/.test(conclusion) ? conclusion : 'an unknown conclusion';
}

/** A local `7:12 AM`, as Settings shows "Synced 7:17 AM". */
function syncClock(ms) {
  return Utilities.formatDate(new Date(ms), TIMEZONE, 'h:mm a');
}

// --- Rows -------------------------------------------------------------------

/** A SyncRequests row -> an object with all nine fields, '' where unset, plus sheetRow. */
function rowToSyncRequest(row, sheetRow) {
  var req = {};
  for (var i = 0; i < SYNC_REQUEST_FIELDS.length; i++) {
    req[SYNC_REQUEST_FIELDS[i]] = cell(row[i]);
  }
  req.sheetRow = sheetRow;
  return req;
}

function syncParseInstant(value) {
  if (!SYNC_REQUEST_ISO_INSTANT.test(value)) return NaN;
  return new Date(value).getTime();
}

/**
 * Write E:I of one row, after re-reading its A:C (the row-drift guard): a row
 * moved or edited since the tick read it is left alone. Answers whether it wrote.
 */
function syncWriteRequest(sheet, req, changes) {
  var current = sheet.getRange(req.sheetRow, 1, 1, 3).getDisplayValues()[0];
  if (cell(current[0]) !== req.request_id || cell(current[1]) !== req.vendor ||
      cell(current[2]) !== req.requested_at) {
    Logger.log('pollSyncRequests: row ' + req.sheetRow + ' changed under the poller; left unwritten.');
    return false;
  }
  for (var key in changes) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) req[key] = changes[key];
  }
  var cells = [];
  for (var i = 4; i < SYNC_REQUEST_FIELDS.length; i++) cells.push(req[SYNC_REQUEST_FIELDS[i]]);
  sheet.getRange(req.sheetRow, 5, 1, cells.length).setValues([asText(cells)]);
  return true;
}

function syncFinal(status, detail) {
  return { status: status, finished_at: new Date().toISOString(), detail: detail };
}

/**
 * The vendor's log tab as [{ run_id, started_at, status }], read once a tick,
 * A:L (`status` is L, for the `done` sentence). A missing tab is no runs.
 */
function syncReadLog(logTab) {
  var sheet = getSpreadsheet().getSheetByName(logTab);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var statusCol = SYNC_LOG_FIELDS.indexOf('status');
  var width = Math.min(statusCol + 1, sheet.getLastColumn());
  var rows = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var status = cell(rows[i][statusCol]);
    out.push({
      run_id: cell(rows[i][0]),
      started_at: cell(rows[i][1]),
      status: SYNC_LOG_STATUSES.indexOf(status) !== -1 ? status : '',
    });
  }
  return out;
}

// --- GitHub -----------------------------------------------------------------

function syncGitHubHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': SYNC_GITHUB_API_VERSION,
  };
}

/**
 * POST the dispatch. Answers { ok, runId } or { ok: false, detail }. Never
 * throws, and never lets GitHub's body or the token into the answer.
 */
function syncDispatch(token, workflow) {
  var url = 'https://api.github.com/repos/' + SYNC_GITHUB_OWNER + '/' + SYNC_GITHUB_REPO +
    '/actions/workflows/' + workflow + '/dispatches';
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: syncGitHubHeaders(token),
      payload: JSON.stringify({ ref: SYNC_GITHUB_REF }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (err) {
    return { ok: false, detail: SYNC_DETAIL.unreachable };
  }
  var code = response.getResponseCode();
  if (code < 200 || code > 299) return { ok: false, detail: syncDetailHttp(code, workflow) };
  var runId = '';
  try {
    var body = JSON.parse(response.getContentText());
    var id = body && body.workflow_run_id;
    if (typeof id === 'number' && isFinite(id) && id > 0 && Math.floor(id) === id) runId = String(id);
    else if (typeof id === 'string' && /^\d{1,20}$/.test(id)) runId = id;
  } catch (err) {
    // A 2xx without a parseable body still started the run.
  }
  return { ok: true, runId: runId };
}

/**
 * GET a run's state. Answers { status, conclusion } on a 200, else null:
 * anything else leaves the row open for the next tick or the ceiling.
 */
function syncRunState(token, runId) {
  var url = 'https://api.github.com/repos/' + SYNC_GITHUB_OWNER + '/' + SYNC_GITHUB_REPO +
    '/actions/runs/' + runId;
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'get', headers: syncGitHubHeaders(token), muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) return null;
    var body = JSON.parse(response.getContentText());
    return { status: String(body.status || ''), conclusion: String(body.conclusion || '') };
  } catch (err) {
    return null;
  }
}

/** Every occurrence of the token, in either spelling, replaced. */
function syncScrub(message, token) {
  var text = String(message);
  if (!token) return text;
  return text.split(token).join('[redacted]').split(encodeURIComponent(token)).join('[redacted]');
}

// --- The tick ---------------------------------------------------------------

/**
 * The trigger handler. Under the script lock (tryLock, at most 5 s; busy means
 * this tick does nothing), reads SyncRequests once. With no open row it stops
 * there: no fetch, no token read, no other tab, no write.
 */
function pollSyncRequests() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    Logger.log('pollSyncRequests: the script lock is busy; nothing done this tick.');
    return;
  }
  var tokenRef = { read: false, value: '' };
  try {
    syncPollLocked(tokenRef);
  } catch (err) {
    // Propagate, so Google's failure email to the bot still fires, but never
    // with the token in the message, whether or not this tick had read it.
    var token = tokenRef.value;
    if (!tokenRef.read) {
      try {
        token = PropertiesService.getScriptProperties().getProperty(SYNC_DISPATCH_TOKEN_PROPERTY) || '';
      } catch (ignored) {
        token = '';
      }
    }
    throw new Error(syncScrub((err && err.message) || err, String(token).trim()));
  } finally {
    lock.releaseLock();
  }
}

function syncPollLocked(tokenRef) {
  var sheet = getSpreadsheet().getSheetByName(SYNC_REQUESTS_SHEET);
  if (!sheet) {
    Logger.log('pollSyncRequests: no SyncRequests tab; nothing to poll.');
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var raw = sheet.getRange(2, 1, lastRow - 1, SYNC_REQUEST_COLUMN_COUNT).getDisplayValues();

  var all = [];
  var open = 0;
  for (var i = 0; i < raw.length; i++) {
    var req = rowToSyncRequest(raw[i], i + 2);
    all.push(req);
    if (req.status === 'requested' || req.status === 'started') open++;
  }
  if (open === 0) return;

  var nowMs = new Date().getTime();
  var token = function () {
    if (!tokenRef.read) {
      tokenRef.read = true;
      var value = PropertiesService.getScriptProperties().getProperty(SYNC_DISPATCH_TOKEN_PROPERTY);
      tokenRef.value = value === null || value === undefined ? '' : String(value).trim();
    }
    return tokenRef.value;
  };
  var logs = {};
  var logFor = function (vendor) {
    if (!logs[vendor]) logs[vendor] = syncReadLog(SYNC_VENDOR_CONFIG[vendor].logTab);
    return logs[vendor];
  };
  var counts = { started: 0, closed: 0 };

  // Requests that cannot be read are failed first, with no fetch.
  var requested = { coros: [], withings: [] };
  var started = { coros: [], withings: [] };
  all.forEach(function (req) {
    syncGuardRow(sheet, req, tokenRef, counts, function () {
      if (req.status === 'started') {
        if (SYNC_REQUEST_VENDORS.indexOf(req.vendor) !== -1) started[req.vendor].push(req);
        else syncCloseStarted(sheet, req, nowMs, null, null, counts);
        return;
      }
      if (req.status !== 'requested') return;
      var invalid = !req.request_id ? SYNC_DETAIL.blankId
        : SYNC_REQUEST_VENDORS.indexOf(req.vendor) === -1 ? syncDetailUnknownVendor(req.vendor)
        : isNaN(syncParseInstant(req.requested_at)) ? SYNC_DETAIL.badTime
        : '';
      if (invalid) {
        if (syncWriteRequest(sheet, req, syncFinal('failed', invalid))) counts.closed++;
        return;
      }
      requested[req.vendor].push(req);
    });
  });

  SYNC_REQUEST_VENDORS.forEach(function (vendor) {
    if (!requested[vendor].length && !started[vendor].length) return;
    syncPollVendor(sheet, vendor, all, requested[vendor], started[vendor], nowMs, token, logFor, tokenRef, counts);
  });

  Logger.log('pollSyncRequests: ' + counts.started + ' started, ' + counts.closed + ' closed.');
}

/** Run one row's work, recording an unexpected error on that row alone. */
function syncGuardRow(sheet, req, tokenRef, counts, work) {
  try {
    work();
  } catch (err) {
    Logger.log('pollSyncRequests: row ' + req.sheetRow + ' failed: ' +
      syncScrub((err && err.message) || err, tokenRef.value));
    if (syncWriteRequest(sheet, req, syncFinal('failed', SYNC_DETAIL.rowError))) counts.closed++;
  }
}

function syncPollVendor(sheet, vendor, all, requested, started, nowMs, token, logFor, tokenRef, counts) {
  var config = SYNC_VENDOR_CONFIG[vendor];

  // AC5: close what it started, before deciding what to start.
  var stillOpen = null;
  started.forEach(function (req) {
    syncGuardRow(sheet, req, tokenRef, counts, function () {
      if (!syncCloseStarted(sheet, req, nowMs, logFor(vendor), token, counts) && !stillOpen) stillOpen = req;
    });
  });

  if (!requested.length) return;

  requested.sort(function (a, b) {
    return syncParseInstant(a.requested_at) - syncParseInstant(b.requested_at);
  });

  var newestRun = syncNewestRun(vendor, all, logFor(vendor));
  var dispatched = null;
  var failedDetail = '';

  requested.forEach(function (req) {
    syncGuardRow(sheet, req, tokenRef, counts, function () {
      var requestedMs = syncParseInstant(req.requested_at);
      var outcome;
      if (nowMs - requestedMs >= SYNC_CEILING_MINUTES * SYNC_MINUTE_MS) {
        outcome = syncFinal('expired', SYNC_DETAIL.expired);
      } else if (stillOpen || dispatched) {
        var openReq = stillOpen || dispatched;
        outcome = syncFinal('skipped', syncDetailAlreadyOpen(config.name, syncParseInstant(openReq.requested_at)));
      } else if (newestRun !== null && nowMs - newestRun < SYNC_COOLDOWN_MINUTES * SYNC_MINUTE_MS) {
        outcome = syncFinal('skipped', syncDetailCooldown(config.name, newestRun));
      } else if (failedDetail) {
        // This tick's one attempt for the vendor failed: a duplicate press
        // gets the same answer, not a second dispatch.
        outcome = syncFinal('failed', failedDetail);
      } else if (!token()) {
        failedDetail = SYNC_DETAIL.noToken;
        outcome = syncFinal('failed', failedDetail);
      } else {
        var result = syncDispatch(token(), config.workflow);
        if (result.ok) {
          dispatched = req;
          counts.started++;
          outcome = {
            status: 'started', workflow_run_id: result.runId, dispatched_at: new Date().toISOString(),
            finished_at: '', detail: result.runId ? '' : SYNC_DETAIL.noRunId,
          };
        } else {
          failedDetail = result.detail;
          outcome = syncFinal('failed', failedDetail);
        }
      }
      if (syncWriteRequest(sheet, req, outcome) && outcome.status !== 'started') counts.closed++;
    });
  });
}

/**
 * The later of the vendor's newest dispatch (a SyncRequests row with a run id)
 * and the newest started_at in its log tab, as ms; null when neither has one.
 */
function syncNewestRun(vendor, all, log) {
  var newest = null;
  var consider = function (ms) {
    if (!isNaN(ms) && (newest === null || ms > newest)) newest = ms;
  };
  all.forEach(function (req) {
    if (req.vendor === vendor && req.workflow_run_id) consider(syncParseInstant(req.dispatched_at));
  });
  log.forEach(function (entry) { consider(syncParseInstant(entry.started_at)); });
  return newest;
}

/**
 * AC5, in order: the run's log row; GitHub's run state; the ceiling. Answers
 * whether the row is now closed. `log` and `token` are null for a row whose
 * vendor is unknown, which only the ceiling can close.
 */
function syncCloseStarted(sheet, req, nowMs, log, token, counts) {
  var config = SYNC_VENDOR_CONFIG[req.vendor];
  var runId = /^\d+$/.test(req.workflow_run_id) ? req.workflow_run_id : '';

  if (runId && log) {
    var pattern = new RegExp('^workflow_dispatch-' + runId + '-\\d+$');
    var match = null;
    log.forEach(function (entry) { if (pattern.test(entry.run_id)) match = entry; });
    if (match) {
      if (syncWriteRequest(sheet, req, syncFinal('done', syncDetailDone(match.status, config.logTab, match.run_id)))) {
        counts.closed++;
      }
      return true;
    }
  }

  if (runId && token && token()) {
    var state = syncRunState(token(), runId);
    if (state && state.status === 'completed') {
      var outcome = state.conclusion === 'cancelled'
        ? syncFinal('cancelled', SYNC_DETAIL.cancelled)
        : syncFinal('failed', 'The run ended without logging a result (GitHub: ' +
          syncConclusionInWords(state.conclusion) + ').');
      if (syncWriteRequest(sheet, req, outcome)) counts.closed++;
      return true;
    }
  }

  var since = syncParseInstant(req.dispatched_at);
  if (isNaN(since)) since = syncParseInstant(req.requested_at);
  if (isNaN(since) || nowMs - since >= SYNC_CEILING_MINUTES * SYNC_MINUTE_MS) {
    if (syncWriteRequest(sheet, req, syncFinal('not_reported', SYNC_DETAIL.notReported))) counts.closed++;
    return true;
  }
  return false;
}

// --- Setup: the owner runs these once from the editor, as luketmossbot -----

/** Delete every project trigger whose handler is pollSyncRequests. Answers how many. */
function syncDeletePollTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === SYNC_POLL_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/**
 * Replace any pollSyncRequests trigger with exactly one, every
 * SYNC_POLL_MINUTES. Running it is also what grants `script.scriptapp`.
 */
function installSyncRequestTrigger() {
  if (SYNC_POLL_MINUTES !== 1 && SYNC_POLL_MINUTES !== 5) {
    throw new Error('SYNC_POLL_MINUTES must be 1 or 5, got ' + SYNC_POLL_MINUTES);
  }
  var replaced = syncDeletePollTriggers();
  ScriptApp.newTrigger(SYNC_POLL_HANDLER).timeBased().everyMinutes(SYNC_POLL_MINUTES).create();
  Logger.log('Installed 1 trigger: ' + SYNC_POLL_HANDLER + ' every ' + SYNC_POLL_MINUTES +
    (SYNC_POLL_MINUTES === 1 ? ' minute' : ' minutes') + ' (replaced ' + replaced + ').');
  var token = PropertiesService.getScriptProperties().getProperty(SYNC_DISPATCH_TOKEN_PROPERTY);
  if (token === null || token === undefined || String(token).trim() === '') {
    Logger.log(SYNC_DISPATCH_TOKEN_PROPERTY + ' is not set: every request will be marked failed until it is.');
  }
}

/** Stop the poller. Triggers for any other handler are never touched. */
function removeSyncRequestTrigger() {
  var removed = syncDeletePollTriggers();
  Logger.log('Removed ' + removed + ' ' + SYNC_POLL_HANDLER + ' trigger(s). Other triggers untouched.');
}
