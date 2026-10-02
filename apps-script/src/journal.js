// Journal tab (A:D) — one free-text note per local calendar day (#233, #234).
//
// The SPA also reads and writes this tab directly (frontend/src/api/
// journal-api.ts); upsertJournal here mirrors its upsertJournalEntry exactly:
// append or rewrite in place keeping `created`, and a blank note deletes the
// day's row. JOURNAL_FIELDS in types.js is the one layout on this side.

var JOURNAL_SHEET = 'Journal';

/** A Journal row -> {date, note, created, updated}, '' where unset. */
function rowToJournal(row) {
  var entry = {};
  for (var i = 0; i < JOURNAL_FIELDS.length; i++) {
    entry[JOURNAL_FIELDS[i]] = cell(row[i]);
  }
  return entry;
}

/** An entry -> exactly 4 cells. */
function journalToRow(entry) {
  var row = [];
  for (var i = 0; i < JOURNAL_FIELDS.length; i++) {
    row.push(cell(entry[JOURNAL_FIELDS[i]]));
  }
  return row;
}

/**
 * Journal entries for an inclusive date range, oldest first (#234).
 *
 * The action behind `getJournal`. `from` and `to` are optional and validated
 * exactly as getDailyHealthRows validates them. No `sheetRow`: callers address
 * a day by its date. The tab may not exist, and that is [], not an error.
 *
 * A read, but key-only: journal text is personal, and no token caller needs
 * it, so it is not on TOKEN_READ_ACTIONS.
 */
function getJournalRows(filters) {
  var from = validateDate('from', filters && filters.from);
  var to = validateDate('to', filters && filters.to);

  var sheet = getSpreadsheet().getSheetByName(JOURNAL_SHEET);
  if (!sheet) return [];

  var rows = getAllRows(sheet);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var entry = rowToJournal(rows[i]);
    if (!entry.date) continue;
    if (from && entry.date < from) continue;
    if (to && entry.date > to) continue;
    out.push(entry);
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/**
 * Create, replace or delete one day's note (#234).
 *
 *  - non-blank note, no row for the date: append (created = updated = now)
 *  - non-blank note, row exists: rewrite it in place, keeping `created`
 *  - blank or whitespace-only note: delete the row if there is one, else no-op
 *
 * The payload is exactly `date` and `note`; anything else is rejected. `note`
 * is free text and stored as given (every write through asText(), so a note
 * starting `=` is text, never a formula).
 *
 * Returns { result: 'created'|'updated'|'deleted'|'unchanged', entry }, where
 * `entry` is the stored row, or null when the day now has no note.
 *
 * Key-only: a write, so never on the token read allow-list.
 */
function upsertJournal(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object with date and note');
  }
  for (var key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    if (key !== 'date' && key !== 'note') {
      throw new Error('unknown field "' + key + '". Valid fields: date, note');
    }
  }
  var date = cell(payload.date);
  if (!date) throw new Error('payload.date field required');
  validateDate('date', date);
  if (typeof payload.note !== 'string') {
    throw new Error('payload.note field required (a string; blank deletes the day\'s note)');
  }
  var note = payload.note;
  var blank = note.trim() === '';

  var sheet = getSheet(JOURNAL_SHEET);
  var rowNum = 0;
  var existing = null;
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, JOURNAL_COLUMN_COUNT).getDisplayValues();
    for (var i = 0; i < rows.length; i++) {
      // First row wins, as everywhere else.
      if (cell(rows[i][0]) === date) {
        rowNum = i + 2;
        existing = rowToJournal(rows[i]);
        break;
      }
    }
  }

  if (blank) {
    if (!existing) return { result: 'unchanged', entry: null };
    sheet.deleteRow(rowNum);
    return { result: 'deleted', entry: null };
  }

  var now = isoNow();
  var entry = {
    date: date,
    note: note,
    created: (existing && existing.created) || now,
    updated: now,
  };
  if (existing) {
    sheet.getRange(rowNum, 1, 1, JOURNAL_COLUMN_COUNT).setValues([asText(journalToRow(entry))]);
    return { result: 'updated', entry: entry };
  }
  sheet.appendRow(asText(journalToRow(entry)));
  return { result: 'created', entry: entry };
}
