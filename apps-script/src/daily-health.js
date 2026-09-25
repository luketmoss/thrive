// DailyHealth tab (A:R) — one row per local calendar day of COROS health
// metrics (#165). Written only by the sync, through upsertDailyHealth; read by
// the DailySummary rollup (getDailyHealth in daily-summary.js) and by callers
// through the getDailyHealth action (getDailyHealthRows, #158).
//
// The sync sends domain objects keyed by field name and holds no column
// indices. DAILY_HEALTH_FIELDS in types.js is the only place the layout lives.

var DAILY_HEALTH_SHEET = 'DailyHealth';

/**
 * Fields whose value, when present, must be a plain non-negative number.
 * Checked so a parser bug upstream fails here, loudly, instead of landing a
 * string like "7h 15min" in a column the rollup sums.
 */
var DAILY_HEALTH_NUMERIC_FIELDS = [
  'resting_hr', 'hrv', 'steps', 'calories',
  'sleep_total_s', 'sleep_deep_s', 'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s',
  'sleep_score', 'vo2max', 'recovery', 'training_load',
];

var DAILY_HEALTH_TIME_FIELDS = ['bed_time', 'wake_time'];

/** A DailyHealth row -> an object with all 18 fields, '' where unset. */
function rowToDailyHealth(row, sheetRow) {
  var health = {};
  for (var i = 0; i < DAILY_HEALTH_FIELDS.length; i++) {
    health[DAILY_HEALTH_FIELDS[i]] = cell(row[i]);
  }
  if (sheetRow !== undefined) health.sheetRow = sheetRow;
  return health;
}

/** An object -> exactly 18 cells, so a short row never leaves stale cells. */
function dailyHealthToRow(health) {
  var row = [];
  for (var i = 0; i < DAILY_HEALTH_FIELDS.length; i++) {
    row.push(cell(health[DAILY_HEALTH_FIELDS[i]]));
  }
  return row;
}

/**
 * Every DailyHealth row with a date, in sheet order, read in one call. The tab
 * may not exist yet: the sync brings it, and until then every day is
 * legitimately health-less, which is not the same as a day of zeros (#131 AC2).
 */
function readDailyHealthRows() {
  var sheet = getSpreadsheet().getSheetByName(DAILY_HEALTH_SHEET);
  if (!sheet) return [];

  var rows = getAllRows(sheet);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var health = rowToDailyHealth(rows[i]);
    if (health.date) out.push(health);
  }
  return out;
}

/**
 * DailyHealth rows for an inclusive date range, oldest first (#158, #147).
 *
 * The action behind `getDailyHealth`. `from` and `to` are optional and
 * validated exactly as getDailySummaries validates them. Every one of the 18
 * fields is present on every object, a blank cell as '' and never 0, and no
 * `sheetRow`: callers address a day by its date.
 *
 * A read, so it belongs on #144's token allow-list when that lands.
 */
function getDailyHealthRows(filters) {
  var from = validateDate('from', filters && filters.from);
  var to = validateDate('to', filters && filters.to);

  var rows = readDailyHealthRows().filter(function (h) {
    if (from && h.date < from) return false;
    if (to && h.date > to) return false;
    return true;
  });
  // Appended in sync order, which is not date order after a backfill.
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return rows;
}

/**
 * Validate one incoming row, returning only the keys it names.
 *
 * Omitted and `''` are different claims, and the upsert keeps them apart: an
 * omitted field is left as it is (vo2max on every day but the run date), a
 * field sent as `''` is written blank.
 */
function normalizeDailyHealthRow(row, index) {
  var where = 'rows[' + index + ']';
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(where + ' must be an object keyed by field name');
  }

  var out = {};
  for (var key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    if (key === 'synced_at') {
      throw new Error(where + ': synced_at is set once per call (payload.synced_at), not per row');
    }
    if (DAILY_HEALTH_FIELDS.indexOf(key) === -1) {
      throw new Error(
        where + ': unknown field "' + key + '". Valid fields: ' + DAILY_HEALTH_FIELDS.join(', ')
      );
    }
    out[key] = cell(row[key]);
  }

  if (!out.date) throw new Error(where + ': date is required');
  validateDate(where + '.date', out.date);

  for (var i = 0; i < DAILY_HEALTH_NUMERIC_FIELDS.length; i++) {
    var f = DAILY_HEALTH_NUMERIC_FIELDS[i];
    if (out[f] && !/^\d+(\.\d+)?$/.test(out[f])) {
      throw new Error(where + ': ' + f + ' must be a number or blank, got "' + out[f] + '"');
    }
  }
  for (var j = 0; j < DAILY_HEALTH_TIME_FIELDS.length; j++) {
    var t = DAILY_HEALTH_TIME_FIELDS[j];
    if (out[t] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[t])) {
      throw new Error(where + ': ' + t + ' must be local HH:mm or blank, got "' + out[t] + '"');
    }
  }
  return out;
}

/**
 * Upsert DailyHealth rows by date (#165 AC4).
 *
 * A date with no row is appended. A date with a row is updated in place, and
 * only in the fields the incoming row names. Before each update the row is
 * re-read and its column A confirmed to still hold that date: the index is
 * built at the start of the call, and a row that moved since (sync plan §10,
 * row-index drift) must not be overwritten with another day's numbers.
 *
 * Every row is validated before anything is written, so a bad row rejects the
 * batch untouched rather than half of it. Every value goes through asText().
 *
 * Key-only: this is a write, so it never joins #144's token read allow-list.
 *
 * @param {Object[]} rows  domain objects keyed by field name, each with `date`
 * @param {string} syncedAt  the run's single timestamp, stamped on every row
 */
function upsertDailyHealth(rows, syncedAt) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!syncedAt) throw new Error('synced_at is required');

  var incoming = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var fields = normalizeDailyHealthRow(rows[i], i);
    if (Object.prototype.hasOwnProperty.call(seen, fields.date)) {
      throw new Error('date ' + fields.date + ' appears twice in rows; send one row per date');
    }
    seen[fields.date] = true;
    incoming.push(fields);
  }

  var sheet = getSheet(DAILY_HEALTH_SHEET);
  var rowByDate = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var d = 0; d < dates.length; d++) {
      var existingDate = cell(dates[d][0]);
      // First row wins: a hand-made duplicate is left for a human to resolve.
      if (existingDate && !Object.prototype.hasOwnProperty.call(rowByDate, existingDate)) {
        rowByDate[existingDate] = d + 2;
      }
    }
  }

  var appended = 0;
  var updated = 0;
  for (var k = 0; k < incoming.length; k++) {
    var row = incoming[k];
    var health;

    if (Object.prototype.hasOwnProperty.call(rowByDate, row.date)) {
      var rowNum = rowByDate[row.date];
      var current = sheet.getRange(rowNum, 1, 1, DAILY_HEALTH_COLUMN_COUNT).getDisplayValues()[0];
      if (cell(current[0]) !== row.date) {
        throw new Error(
          'DailyHealth row ' + rowNum + ' was expected to hold ' + row.date + ' but holds "' +
          cell(current[0]) + '". The sheet changed during the write; nothing further was ' +
          'written. Re-run the sync.'
        );
      }
      health = rowToDailyHealth(current);
      for (var key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) health[key] = row[key];
      }
      health.synced_at = syncedAt;
      sheet.getRange(rowNum, 1, 1, DAILY_HEALTH_COLUMN_COUNT).setValues([asText(dailyHealthToRow(health))]);
      updated += 1;
    } else {
      health = rowToDailyHealth([]);
      for (var key2 in row) {
        if (Object.prototype.hasOwnProperty.call(row, key2)) health[key2] = row[key2];
      }
      health.synced_at = syncedAt;
      sheet.appendRow(asText(dailyHealthToRow(health)));
      rowByDate[row.date] = sheet.getLastRow();
      appended += 1;
    }
  }

  return { appended: appended, updated: updated, synced_at: syncedAt };
}
