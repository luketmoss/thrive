// Sheet access and row <-> object mapping.

function getSpreadsheetId() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID not set in script properties');
  return id;
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(getSpreadsheetId());
}

function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found');
  return sheet;
}

function isoNow() {
  return new Date().toISOString();
}

/** Today's date in TIMEZONE as YYYY-MM-DD. Never slice an ISO timestamp. */
function todayLocal() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

/**
 * All data rows from a sheet, header row skipped, as the cells DISPLAY.
 *
 * Display values, not getValues(): that is what the SPA reads (the REST API's
 * default FORMATTED_VALUE), so both sides see the same thing. getValues()
 * hands back a Date object for any cell Sheets parsed as a date, and
 * String(date) is "Thu Jan 01 2099 00:00:00 GMT-0700" — which an update then
 * wrote back over the date. Every read in this project goes through display
 * values for that reason (#132).
 */
function getAllRows(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
}

/**
 * A row made safe to hand to appendRow / setValues: every value stored as
 * literal text.
 *
 * Those two methods behave like typing into the cell, not like the RAW writes
 * the SPA makes through the REST API. Typed, "2026-03-04" becomes a date,
 * "07:00" a time, "3720" a number and "=anything" a live formula. A leading
 * apostrophe is Sheets' own escape: the rest is stored exactly as given and
 * the apostrophe is not part of the value, so a later read sees "2026-03-04".
 *
 * That also closes formula injection — a note beginning with "=" is text.
 *
 * '' stays '' — an escaped empty string would be a cell holding "", which
 * reads back as unset anyway, but there is no reason to write one.
 */
function asText(values) {
  return values.map(function (v) {
    var s = cell(v);
    return s === '' ? '' : "'" + s;
  });
}

/**
 * A cell as a string, with unset meaning ''.
 *
 * The whole nullable discipline rests here (#101, #128 AC2/AC3): a row
 * written before a column existed comes back short, so the cell is
 * `undefined`; an empty cell comes back as `''`. Neither may become `0`, and
 * `String(undefined)` must never be allowed to produce "undefined".
 *
 * A genuine `0` in the sheet survives as `'0'`, which is the distinction the
 * activity columns exist to preserve — nobody said is not the same as zero.
 */
function cell(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

/**
 * A Workouts row -> the API's workout object, all 26 fields present.
 *
 * Derived from WORKOUT_FIELDS rather than written out, so the read and write
 * mappers cannot disagree about which columns exist.
 */
function rowToWorkout(row, sheetRow) {
  var workout = {};
  for (var i = 0; i < WORKOUT_FIELDS.length; i++) {
    workout[WORKOUT_FIELDS[i]] = cell(row[i]);
  }
  // Not a column — the 1-based sheet row, so a caller can write back to the
  // row it read without re-scanning. Mirrors `sheetRow` in the other two.
  workout.sheetRow = sheetRow;
  return workout;
}

/**
 * A workout object -> a 26-cell row.
 *
 * Always exactly WORKOUT_COLUMN_COUNT cells: Sheets writes every value it is
 * handed regardless of the range, so a short row leaves stale cells behind
 * and an `undefined` writes the string "undefined".
 */
function workoutToRow(workout) {
  var row = [];
  for (var i = 0; i < WORKOUT_FIELDS.length; i++) {
    row.push(cell(workout[WORKOUT_FIELDS[i]]));
  }
  return row;
}

/** The 1-based sheet row holding this workout id, or -1. */
function findWorkoutRow(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

/** Rejects a value not in `allowed`. '' is always permitted — unset is legal. */
function validateEnum(field, value, allowed) {
  if (value === undefined || value === '') return '';
  var v = String(value);
  if (allowed.indexOf(v) === -1) {
    throw new Error(
      'Invalid ' + field + ': "' + v + '". Expected one of: ' + allowed.join(', ')
    );
  }
  return v;
}

/** A local calendar date, or throws. Format only — any real date is allowed. */
function validateDate(field, value) {
  var v = String(value === undefined ? '' : value);
  if (v === '') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error('Invalid ' + field + ': "' + v + '". Expected YYYY-MM-DD.');
  }
  return v;
}
