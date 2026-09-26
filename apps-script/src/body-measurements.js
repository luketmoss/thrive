// BodyMeasurements tab (A:T) — one row per Withings measure group (#198).
// Written only by the Withings sync, through upsertBodyMeasurements; read by
// readBodyMeasurementRows(), which the read action (#201) and the
// DailySummary rollup (#203) build on.
//
// The sync sends domain objects keyed by field name and holds no column
// indices. BODY_MEASUREMENT_FIELDS in types.js is the only place the layout
// lives.

var BODY_MEASUREMENTS_SHEET = 'BodyMeasurements';

/**
 * The measure columns, G:P. When present each must be a plain non-negative
 * number, so a normalizer bug upstream fails here, loudly, instead of landing
 * "81.2 kg" or a negative mass in a column a chart plots.
 */
var BODY_MEASUREMENT_MEASURE_FIELDS = [
  'weight_kg', 'fat_ratio_pct', 'fat_mass_kg', 'fat_free_mass_kg', 'muscle_mass_kg',
  'hydration_kg', 'bone_mass_kg', 'systolic_mmhg', 'diastolic_mmhg', 'pulse_bpm',
];

/** A BodyMeasurements row -> an object with all 20 fields, '' where unset. */
function rowToBodyMeasurement(row, sheetRow) {
  var m = {};
  for (var i = 0; i < BODY_MEASUREMENT_FIELDS.length; i++) {
    m[BODY_MEASUREMENT_FIELDS[i]] = cell(row[i]);
  }
  if (sheetRow !== undefined) m.sheetRow = sheetRow;
  return m;
}

/** An object -> exactly 20 cells, so a short row never leaves stale cells. */
function bodyMeasurementToRow(m) {
  var row = [];
  for (var i = 0; i < BODY_MEASUREMENT_FIELDS.length; i++) {
    row.push(cell(m[BODY_MEASUREMENT_FIELDS[i]]));
  }
  return row;
}

/**
 * Every BodyMeasurements row with a grpid, in sheet order, read in one call.
 * The tab may not exist yet: the migration brings it, and until then there
 * are legitimately no measurements, which is not a tab of zeros.
 */
function readBodyMeasurementRows() {
  var sheet = getSpreadsheet().getSheetByName(BODY_MEASUREMENTS_SHEET);
  if (!sheet) return [];

  var rows = getAllRows(sheet);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var m = rowToBodyMeasurement(rows[i]);
    if (m.grpid) out.push(m);
  }
  return out;
}

/**
 * BodyMeasurements rows for an inclusive local-date range and optional kind,
 * oldest first by `measured_at_utc` (#201).
 *
 * The action behind `getBodyMeasurements`. `from` and `to` are optional and
 * validated exactly as getDailyHealthRows validates them, filtering on the
 * local `date` column, not the UTC instant. `kind`, when given, must be
 * `scale` or `bp`. Every one of the 20 fields is present on every object, a
 * blank cell as '' and never 0, and no `sheetRow`.
 *
 * Sorted on `measured_at_utc` parsed as an instant, not on sheet order, which
 * a backfill scrambles.
 *
 * A read, so it belongs on TOKEN_READ_ACTIONS (#144).
 */
function getBodyMeasurementsRows(filters) {
  var from = validateDate('from', filters && filters.from);
  var to = validateDate('to', filters && filters.to);
  var kind = (filters && filters.kind) || '';
  if (kind && BODY_MEASUREMENT_KINDS.indexOf(kind) === -1) {
    throw new Error('kind must be one of ' + BODY_MEASUREMENT_KINDS.join(', ') + ', got "' + kind + '"');
  }

  var rows = readBodyMeasurementRows().filter(function (m) {
    if (from && m.date < from) return false;
    if (to && m.date > to) return false;
    if (kind && m.kind !== kind) return false;
    return true;
  });
  rows.sort(function (a, b) {
    var ta = Date.parse(a.measured_at_utc);
    var tb = Date.parse(b.measured_at_utc);
    return ta - tb;
  });
  return rows;
}

/**
 * Validate one incoming row, returning every one of the 19 row fields (all
 * but synced_at). A field the row does not name is '', because an upsert
 * rewrites the row whole: a measure removed in a Withings edit becomes blank.
 */
function normalizeBodyMeasurementRow(row, index) {
  var where = 'rows[' + index + ']';
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(where + ' must be an object keyed by field name');
  }

  var out = {};
  for (var f = 0; f < BODY_MEASUREMENT_FIELDS.length; f++) {
    if (BODY_MEASUREMENT_FIELDS[f] !== 'synced_at') out[BODY_MEASUREMENT_FIELDS[f]] = '';
  }
  for (var key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    if (key === 'synced_at') {
      throw new Error(where + ': synced_at is set once per call (payload.synced_at), not per row');
    }
    if (BODY_MEASUREMENT_FIELDS.indexOf(key) === -1) {
      throw new Error(
        where + ': unknown field "' + key + '". Valid fields: ' + BODY_MEASUREMENT_FIELDS.join(', ')
      );
    }
    out[key] = cell(row[key]);
  }

  if (!out.grpid) throw new Error(where + ': grpid is required');
  if (!/^\d+$/.test(out.grpid)) {
    throw new Error(where + ': grpid must be a whole number, got "' + out.grpid + '"');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) {
    throw new Error(where + ': date must be local YYYY-MM-DD, got "' + out.date + '"');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time)) {
    throw new Error(where + ': time must be local HH:mm, got "' + out.time + '"');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.test(out.measured_at_utc)) {
    throw new Error(
      where + ': measured_at_utc must be ISO 8601 with an offset, got "' + out.measured_at_utc + '"'
    );
  }
  if (BODY_MEASUREMENT_KINDS.indexOf(out.kind) === -1) {
    throw new Error(where + ': kind must be one of ' + BODY_MEASUREMENT_KINDS.join(', ') +
      ', got "' + out.kind + '"');
  }
  if (out.source !== 'withings') {
    throw new Error(where + ': source must be "withings", got "' + out.source + '"');
  }
  if (out.attrib && !/^\d+$/.test(out.attrib)) {
    throw new Error(where + ': attrib must be a whole number or blank, got "' + out.attrib + '"');
  }
  for (var i = 0; i < BODY_MEASUREMENT_MEASURE_FIELDS.length; i++) {
    var m = BODY_MEASUREMENT_MEASURE_FIELDS[i];
    if (out[m] && !/^\d+(\.\d+)?$/.test(out[m])) {
      throw new Error(where + ': ' + m + ' must be a non-negative number or blank, got "' + out[m] + '"');
    }
  }
  return out;
}

/**
 * Upsert BodyMeasurements rows by grpid (#198 AC4).
 *
 * A grpid with no row is appended. A grpid with a row is **rewritten whole**:
 * Withings keeps the grpid of an edited group, so a measure removed in the
 * edit must become blank rather than survive. Before each update the row is
 * re-read and its column A confirmed to still hold that grpid, as
 * upsertDailyHealth does: the index is built at the start of the call, and a
 * row that moved since must not be overwritten with another reading.
 *
 * Every row is validated before anything is written, so a bad row rejects the
 * batch untouched rather than half of it. Every value goes through asText().
 *
 * Key-only: this is a write, so it never joins the token read allow-list.
 *
 * @param {Object[]} rows  domain objects keyed by field name, each with `grpid`
 * @param {string} syncedAt  the run's single timestamp, stamped on every row
 */
function upsertBodyMeasurements(rows, syncedAt) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!syncedAt) throw new Error('synced_at is required');

  var incoming = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var fields = normalizeBodyMeasurementRow(rows[i], i);
    if (Object.prototype.hasOwnProperty.call(seen, fields.grpid)) {
      throw new Error('grpid ' + fields.grpid + ' appears twice in rows; send one row per group');
    }
    seen[fields.grpid] = true;
    incoming.push(fields);
  }

  var sheet = getSheet(BODY_MEASUREMENTS_SHEET);
  var rowByGrpid = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var d = 0; d < ids.length; d++) {
      var existing = cell(ids[d][0]);
      // First row wins: a hand-made duplicate is left for a human to resolve.
      if (existing && !Object.prototype.hasOwnProperty.call(rowByGrpid, existing)) {
        rowByGrpid[existing] = d + 2;
      }
    }
  }

  var appended = 0;
  var updated = 0;
  for (var k = 0; k < incoming.length; k++) {
    var m = incoming[k];
    m.synced_at = syncedAt;
    var values = asText(bodyMeasurementToRow(m));

    if (Object.prototype.hasOwnProperty.call(rowByGrpid, m.grpid)) {
      var rowNum = rowByGrpid[m.grpid];
      var current = sheet.getRange(rowNum, 1, 1, 1).getDisplayValues()[0];
      if (cell(current[0]) !== m.grpid) {
        throw new Error(
          'BodyMeasurements row ' + rowNum + ' was expected to hold grpid ' + m.grpid +
          ' but holds "' + cell(current[0]) + '". The sheet changed during the write; nothing ' +
          'further was written. Re-run the sync.'
        );
      }
      sheet.getRange(rowNum, 1, 1, BODY_MEASUREMENT_COLUMN_COUNT).setValues([values]);
      updated += 1;
    } else {
      sheet.appendRow(values);
      rowByGrpid[m.grpid] = sheet.getLastRow();
      appended += 1;
    }
  }

  return { appended: appended, updated: updated, synced_at: syncedAt };
}

/** At most this many rows deleted per call unless the caller says otherwise (#215 AC3). */
var BODY_MEASUREMENTS_DEFAULT_MAX_DELETIONS = 5;

/**
 * Remove the BodyMeasurements rows in `from`..`to` whose grpid Withings no
 * longer returns: the reading was deleted in the app (#215).
 *
 * `getmeas` silently omits a deleted group, so absence from a **complete**
 * fetch is the only signal. The sync calls this only after such a fetch; the
 * compare and the delete happen here, in one call under the script lock, so
 * no other writer can move a row between them.
 *
 * - Only rows whose local `date` lies in `from`..`to` inclusive are
 *   considered. Every other row is never touched, however many there are.
 * - The cap refuses a suspicious sweep, deleting nothing: more than
 *   `max_deletions` rows, or an empty `present_grpids` against a window that
 *   holds rows (a Withings fault answering `status 0` with an empty list must
 *   not empty the tab). `allow_empty: true` lifts the second rule; the sync
 *   sends it only for a run whose owner set the cap by hand after checking
 *   Withings, since a window whose every reading was really deleted is
 *   otherwise refused for ever.
 * - Before any delete, every target row is re-read and its column A confirmed
 *   to still hold that grpid (the row-drift guard); each is checked again
 *   just before its own delete. Rows go bottom-up, so a delete never shifts a
 *   row still to be deleted.
 *
 * Key-only: a write, so it never joins the token read allow-list.
 *
 * @param {{ from: string, to: string, present_grpids: string[],
 *   max_deletions?: number, allow_empty?: boolean }} payload
 * @returns {{ deleted: string[], refused: boolean, would_delete?: number }}
 */
function reconcileBodyMeasurements(payload) {
  var p = payload || {};
  var from = validateDate('from', p.from);
  var to = validateDate('to', p.to);
  if (!from || !to) throw new Error('from and to are required (local YYYY-MM-DD)');
  if (from > to) throw new Error('from (' + from + ') is after to (' + to + ')');

  if (!Array.isArray(p.present_grpids)) {
    throw new Error('present_grpids must be an array of grpids (numeric strings)');
  }
  var present = {};
  for (var i = 0; i < p.present_grpids.length; i++) {
    var g = p.present_grpids[i];
    if (typeof g !== 'string' || !/^\d+$/.test(g)) {
      throw new Error('present_grpids[' + i + '] must be a numeric string, got ' + JSON.stringify(g));
    }
    present[g] = true;
  }

  var max = BODY_MEASUREMENTS_DEFAULT_MAX_DELETIONS;
  if (p.max_deletions !== undefined && p.max_deletions !== null) {
    if (typeof p.max_deletions !== 'number' || p.max_deletions % 1 !== 0 || p.max_deletions < 1) {
      throw new Error('max_deletions must be a positive integer, got ' + JSON.stringify(p.max_deletions));
    }
    max = p.max_deletions;
  }
  if (p.allow_empty !== undefined && typeof p.allow_empty !== 'boolean') {
    throw new Error('allow_empty must be true or false, got ' + JSON.stringify(p.allow_empty));
  }

  var sheet = getSpreadsheet().getSheetByName(BODY_MEASUREMENTS_SHEET);
  if (!sheet) return { deleted: [], refused: false };

  var rows = getAllRows(sheet);
  var inWindow = 0;
  var targets = [];
  for (var r = 0; r < rows.length; r++) {
    var grpid = cell(rows[r][0]);
    var date = cell(rows[r][BODY_MEASUREMENT_FIELDS.indexOf('date')]);
    if (!grpid || !date || date < from || date > to) continue;
    inWindow += 1;
    if (!Object.prototype.hasOwnProperty.call(present, grpid)) {
      targets.push({ rowNum: r + 2, grpid: grpid });
    }
  }

  var emptySweep = p.present_grpids.length === 0 && inWindow > 0 && p.allow_empty !== true;
  if (targets.length > max || emptySweep) {
    return { deleted: [], refused: true, would_delete: targets.length };
  }
  if (!targets.length) return { deleted: [], refused: false };

  var holds = function (t) {
    return cell(sheet.getRange(t.rowNum, 1, 1, 1).getDisplayValues()[0][0]) === t.grpid;
  };
  // Every target confirmed first, so a moved sheet costs no row at all.
  for (var c = 0; c < targets.length; c++) {
    if (!holds(targets[c])) throw driftError(targets[c], 0);
  }
  var deleted = [];
  for (var d = targets.length - 1; d >= 0; d--) {
    if (!holds(targets[d])) throw driftError(targets[d], deleted.length);
    sheet.deleteRow(targets[d].rowNum);
    deleted.unshift(targets[d].grpid);
  }
  return { deleted: deleted, refused: false };

  function driftError(t, n) {
    return new Error(
      'BodyMeasurements row ' + t.rowNum + ' was expected to hold grpid ' + t.grpid + ' but no longer ' +
      'does. The sheet changed during the reconcile; ' + n + ' row(s) had been deleted and nothing ' +
      'further was. Re-run the sync.'
    );
  }
}
