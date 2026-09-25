// SyncLog tab (A:N) — one row per COROS sync run (#156, sync plan §5; N is #155).
// Appended by the sync through appendSyncLog; read newest first by getSyncLog,
// which the dead-man's switch (sync/deadman.mjs) and #157's Settings line use.
//
// SYNC_LOG_FIELDS in types.js is the only place the layout lives.

var SYNC_LOG_SHEET = 'SyncLog';

var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** A SyncLog row -> an object with all 14 fields, '' where unset. */
function rowToSyncLog(row) {
  var entry = {};
  for (var i = 0; i < SYNC_LOG_FIELDS.length; i++) {
    entry[SYNC_LOG_FIELDS[i]] = cell(row[i]);
  }
  return entry;
}

/**
 * Validate a whole row before anything is written (#156 AC1). Every field is
 * named explicitly by the sync, so unknown ones are refused rather than
 * dropped: a typo would otherwise land as a blank column.
 */
function normalizeSyncLogRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('row must be an object keyed by field name');
  }
  var out = {};
  for (var key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    if (SYNC_LOG_FIELDS.indexOf(key) === -1) {
      throw new Error('unknown field "' + key + '". Valid fields: ' + SYNC_LOG_FIELDS.join(', '));
    }
    out[key] = cell(row[key]);
  }
  for (var f = 0; f < SYNC_LOG_FIELDS.length; f++) {
    if (!Object.prototype.hasOwnProperty.call(out, SYNC_LOG_FIELDS[f])) out[SYNC_LOG_FIELDS[f]] = '';
  }

  if (!out.run_id) throw new Error('run_id is required');
  ['started_at', 'finished_at'].forEach(function (k) {
    if (!ISO_INSTANT.test(out[k])) {
      throw new Error(k + ' must be an ISO 8601 instant, got "' + out[k] + '"');
    }
  });
  validateDate('window_start', out.window_start);
  validateDate('window_end', out.window_end);
  if (!out.window_start || !out.window_end) throw new Error('window_start and window_end are required');
  for (var c = 0; c < SYNC_LOG_COUNT_FIELDS.length; c++) {
    var n = SYNC_LOG_COUNT_FIELDS[c];
    if (!/^\d+$/.test(out[n])) {
      throw new Error(n + ' must be a non-negative integer, got "' + out[n] + '"');
    }
  }
  if (SYNC_LOG_STATUSES.indexOf(out.status) === -1) {
    throw new Error('status must be one of ' + SYNC_LOG_STATUSES.join(', ') + ', got "' + out.status + '"');
  }
  return out;
}

/**
 * Append one run's row. A run_id already in the tab is not appended again, so
 * a write that landed but whose answer was lost cannot double a run.
 * Every value goes through asText(): error_detail can begin with anything.
 */
function appendSyncLog(row) {
  var entry = normalizeSyncLogRow(row);
  var sheet = getSheet(SYNC_LOG_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) {
      if (cell(ids[i][0]) === entry.run_id) {
        return { status: 'exists', run_id: entry.run_id, sheetRow: i + 2 };
      }
    }
  }
  var cells = [];
  for (var f = 0; f < SYNC_LOG_FIELDS.length; f++) cells.push(entry[SYNC_LOG_FIELDS[f]]);
  sheet.appendRow(asText(cells));
  return { status: 'appended', run_id: entry.run_id, sheetRow: sheet.getLastRow() };
}

/**
 * The newest `limit` rows, newest first by started_at, never by position: a
 * tab sorted by hand must not make an old run look like the latest.
 * ISO instants in UTC sort as strings; anything else sorts by parsed time.
 */
function getSyncLog(options) {
  var raw = options && options.limit;
  var limit = raw === undefined || raw === null || raw === '' ? 10 : Number(raw);
  if (!(limit >= 1 && limit <= 100 && Math.floor(limit) === limit)) {
    throw new Error('limit must be a whole number from 1 to 100, got "' + raw + '"');
  }
  var sheet = getSheet(SYNC_LOG_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  // A tab migrated before #155 has no column N; read what it has, and the
  // missing fields come back ''.
  var width = Math.min(SYNC_LOG_COLUMN_COUNT, sheet.getLastColumn());
  var rows = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    var entry = rowToSyncLog(rows[i]);
    if (entry.run_id) entries.push(entry);
  }
  var time = function (e) {
    var t = Date.parse(e.started_at);
    return isNaN(t) ? -Infinity : t;
  };
  entries.sort(function (a, b) { return time(b) - time(a); });
  return entries.slice(0, limit);
}
