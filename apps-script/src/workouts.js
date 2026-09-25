// Read and write actions for the Workouts tab (A:Z).

var WORKOUTS_SHEET = 'Workouts';

/**
 * Every workout, optionally filtered.
 *
 * `date` and `status` are matched against columns B and K as stored. `date`
 * is never derived by slicing a timestamp — `Workouts!B` already *is* the
 * local calendar date, and re-deriving it from `created` or `started_at_utc`
 * would move a 7pm workout to the next day.
 */
function getWorkouts(filters) {
  var sheet = getSheet(WORKOUTS_SHEET);
  var rows = getAllRows(sheet);
  var workouts = [];

  for (var i = 0; i < rows.length; i++) {
    workouts.push(rowToWorkout(rows[i], i + 2));
  }

  if (!filters) return workouts;

  if (filters.date) {
    var date = validateDate('date', filters.date);
    workouts = workouts.filter(function (w) { return w.date === date; });
  }
  if (filters.from) {
    var from = validateDate('from', filters.from);
    workouts = workouts.filter(function (w) { return w.date && w.date >= from; });
  }
  if (filters.to) {
    var to = validateDate('to', filters.to);
    workouts = workouts.filter(function (w) { return w.date && w.date <= to; });
  }
  if (filters.type) {
    var type = validateEnum('type', filters.type, WORKOUT_TYPES);
    workouts = workouts.filter(function (w) { return w.type === type; });
  }
  if (filters.status !== undefined && filters.status !== '') {
    var status = String(filters.status);
    workouts = workouts.filter(function (w) { return w.status === status; });
  }

  return workouts;
}

/** One workout by id, or null. */
function getWorkout(id) {
  var sheet = getSheet(WORKOUTS_SHEET);
  var rowNum = findWorkoutRow(sheet, id);
  if (rowNum === -1) return null;
  var row = sheet.getRange(rowNum, 1, 1, WORKOUT_COLUMN_COUNT).getDisplayValues()[0];
  return rowToWorkout(row, rowNum);
}

/**
 * Planned workouts for a local calendar date (#130 AC4).
 *
 * Defaults to today in TIMEZONE. A date with nothing planned returns `[]` —
 * an empty day is a normal answer, not an error, and the Journal's day view
 * depends on being able to ask about any date.
 */
function getPlannedWorkouts(date) {
  var target = date ? validateDate('date', date) : todayLocal();
  return getWorkouts({ date: target, status: 'planned' });
}

/**
 * Validate and normalise the fields a caller may set.
 *
 * Returns only the keys actually present, so an update can tell "set this to
 * empty" from "do not touch this" — the distinction AC3 turns on.
 */
function normalizeWorkoutFields(data) {
  var out = {};
  if (!data) return out;

  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    if (WORKOUT_FIELDS.indexOf(key) === -1) {
      throw new Error(
        'Unknown field: "' + key + '". Valid fields: ' + WORKOUT_FIELDS.join(', ')
      );
    }
    out[key] = cell(data[key]);
  }

  if (out.type !== undefined) validateEnum('type', out.type, WORKOUT_TYPES);
  if (out.sub_type !== undefined) validateEnum('sub_type', out.sub_type, SUB_TYPES);
  if (out.effort !== undefined) validateEnum('effort', out.effort, EFFORTS);
  if (out.status !== undefined) validateEnum('status', out.status, WORKOUT_STATUSES);
  if (out.date !== undefined) validateDate('date', out.date);

  return out;
}

/**
 * Append a workout.
 *
 * Every field the caller did not mention is written as '', never a default.
 * `source` blank is not missing information: it positively means the workout
 * was logged by hand rather than synced.
 */
function createWorkout(data) {
  var fields = normalizeWorkoutFields(data);

  if (!fields.type) throw new Error('type is required');
  if (!fields.name) throw new Error('name is required');

  var workout = {};
  for (var i = 0; i < WORKOUT_FIELDS.length; i++) {
    workout[WORKOUT_FIELDS[i]] = '';
  }
  for (var key in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) workout[key] = fields[key];
  }

  if (!workout.id) workout.id = 'w_' + Utilities.getUuid().slice(0, 8);
  if (!workout.date) workout.date = todayLocal();
  // Written and never read — a deliberate forensic trail, per CLAUDE.md.
  if (!workout.created) workout.created = isoNow();

  var sheet = getSheet(WORKOUTS_SHEET);
  sheet.appendRow(asText(workoutToRow(workout)));
  workout.sheetRow = sheet.getLastRow();
  return workout;
}

/**
 * Merge `changes` onto an existing workout.
 *
 * Only the keys present in `changes` are touched (#130 AC3). This is the
 * difference between an update and an overwrite, and it is why the whole row
 * is read first: a 26-cell write built from `changes` alone would blank every
 * column the caller happened not to mention. #122 is that bug, in the MCP
 * server, and it is worth not shipping twice.
 */
function updateWorkout(id, changes) {
  if (!id) throw new Error('id is required');

  var sheet = getSheet(WORKOUTS_SHEET);
  var rowNum = findWorkoutRow(sheet, id);
  if (rowNum === -1) throw new Error('Workout "' + id + '" not found');

  var fields = normalizeWorkoutFields(changes);
  if (fields.id !== undefined && fields.id !== id) {
    throw new Error('id cannot be changed');
  }

  var existing = rowToWorkout(
    sheet.getRange(rowNum, 1, 1, WORKOUT_COLUMN_COUNT).getDisplayValues()[0],
    rowNum
  );

  for (var key in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) existing[key] = fields[key];
  }

  sheet.getRange(rowNum, 1, 1, WORKOUT_COLUMN_COUNT).setValues([asText(workoutToRow(existing))]);
  return existing;
}

/**
 * Validate an activity's merged fields as a sync sent them (#166).
 *
 * Only SYNC_MERGED_FIELDS may appear: a sync that tried to set `effort` or
 * `notes` is refused rather than quietly obeyed. A field left out is ''.
 * `required` also demands the fields an append needs.
 */
function normalizeSyncedFields(data, where, required) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(where + ' must be an object keyed by field name');
  }
  var out = {};
  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    if (SYNC_MERGED_FIELDS.indexOf(key) === -1) {
      throw new Error(
        where + ': "' + key + '" is not a synced field. Valid fields: ' + SYNC_MERGED_FIELDS.join(', ')
      );
    }
  }
  for (var i = 0; i < SYNC_MERGED_FIELDS.length; i++) {
    var f = SYNC_MERGED_FIELDS[i];
    out[f] = cell(data[f]);
  }
  if (!required) return out;

  if (!out.type) throw new Error(where + '.type is required');
  if (!out.name) throw new Error(where + '.name is required');
  if (!out.date) throw new Error(where + '.date is required');
  validateEnum(where + '.type', out.type, WORKOUT_TYPES);
  validateEnum(where + '.sub_type', out.sub_type, SUB_TYPES);
  validateDate(where + '.date', out.date);
  if (out.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time)) {
    throw new Error(where + '.time must be local HH:MM or blank, got "' + out.time + '"');
  }
  if (out.started_at_utc && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(out.started_at_utc)) {
    throw new Error(where + '.started_at_utc must be ISO 8601 with an offset, got "' + out.started_at_utc + '"');
  }
  for (var j = 0; j < SYNC_INTEGER_FIELDS.length; j++) {
    var n = SYNC_INTEGER_FIELDS[j];
    if (out[n] && !/^\d+$/.test(out[n])) {
      throw new Error(where + '.' + n + ' must be a whole number or blank, got "' + out[n] + '"');
    }
  }
  return out;
}

/**
 * Upsert one synced activity by vendor ID, with sync plan §8's three-way
 * merge (#166 AC3, AC4).
 *
 * The merge runs here rather than in the sync, so reading the row, comparing
 * and writing happen in one execution: an edit made in the SPA between a
 * separate read and write could otherwise be lost. Comparison is string
 * against string, because every read is a display value and every write
 * went through asText().
 *
 * - No row with `(source, source_activity_id)`, and `last_written` null:
 *   append one through createWorkout. Every field not sent is blank.
 * - No row, and `last_written` not null: the user deleted it. Not recreated;
 *   reported as `deleted`.
 * - One row: for each merged field, write the incoming value if the sheet
 *   still holds `last_written`'s, else keep the sheet's (the user edited it).
 *   With `last_written` null (an earlier run wrote the row but not the
 *   archive), fill blanks only. Sync-owned fields are always overwritten.
 *
 * An edit is sticky. `written` records what the sheet now holds, so the next
 * run compares against the truth — but an edited field's recorded value then
 * equals the sheet's, and on its own would read as untouched on the following
 * run, which would overwrite the edit a run late. So `written.edited` names
 * every field the user has changed, `last_written.edited` carries it back, and
 * a field named there is never written again: once you edit a field, it stops
 * tracking the vendor for that activity (sync plan §8).
 * - Two or more rows: refused, naming them. Picking one would be a guess.
 *
 * Source-generic: #159's Garmin import comes through here too.
 * Key-only: a write, so it never joins #144's token read allow-list.
 *
 * @returns {{ status: string, id?: string, sheetRow?: number,
 *   written?: Object, kept?: string[] }}  `written` is every merged field as
 *   the sheet now holds it, plus `edited`, for the sync to store as the next
 *   `last_written`. `kept` is the fields this call declined to overwrite.
 */
function upsertSyncedWorkout(payload) {
  payload = payload || {};
  var source = cell(payload.source);
  var activityId = cell(payload.source_activity_id);
  var syncedAt = cell(payload.synced_at);
  var rawRef = cell(payload.raw_ref);
  if (!/^[a-z][a-z0-9_]*$/.test(source)) {
    throw new Error('source is required: a lowercase vendor name such as "coros", got "' + source + '"');
  }
  if (!activityId) throw new Error('source_activity_id is required');
  if (!syncedAt) throw new Error('synced_at is required');

  var incoming = normalizeSyncedFields(payload.incoming, 'incoming', true);
  var lastWritten = null;
  var edited = [];
  if (payload.last_written !== null && payload.last_written !== undefined) {
    var previous = {};
    for (var p in payload.last_written) {
      if (Object.prototype.hasOwnProperty.call(payload.last_written, p) && p !== 'edited') {
        previous[p] = payload.last_written[p];
      }
    }
    lastWritten = normalizeSyncedFields(previous, 'last_written', false);
    edited = normalizeEditedFields(payload.last_written.edited);
  }

  var owned = {
    source: source,
    source_activity_id: activityId,
    raw_ref: rawRef,
    synced_at: syncedAt,
  };
  var fit = normalizeSyncedFit(payload);
  if (fit) {
    owned.fit_ref = fit.fit_ref;
    owned.fit_fetched_at = fit.fit_fetched_at;
  }

  var sheet = getSheet(WORKOUTS_SHEET);
  var rows = getAllRows(sheet);
  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    if (cell(rows[i][COL.SOURCE]) === source && cell(rows[i][COL.SOURCE_ACTIVITY_ID]) === activityId) {
      matches.push({ rowNum: i + 2, id: cell(rows[i][COL.ID]) });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      matches.length + ' Workouts rows are ' + source + ' activity ' + activityId + ' (' +
      matches.map(function (m) { return m.id + ' at row ' + m.rowNum; }).join(', ') +
      '). Delete all but one in Thrive; nothing was written.'
    );
  }

  if (matches.length === 0) {
    if (lastWritten) {
      return { status: 'deleted', source: source, source_activity_id: activityId };
    }
    var data = {};
    for (var k in incoming) {
      if (Object.prototype.hasOwnProperty.call(incoming, k)) data[k] = incoming[k];
    }
    for (var o in owned) {
      if (Object.prototype.hasOwnProperty.call(owned, o)) data[o] = owned[o];
    }
    var created = createWorkout(data);
    return {
      status: 'created', id: created.id, sheetRow: created.sheetRow,
      written: pickSynced(created, []), kept: [],
    };
  }

  // Row-index drift (sync plan §10): the scan and this write are one
  // execution, but confirm the row still is this activity before touching it.
  var rowNum = matches[0].rowNum;
  var current = rowToWorkout(
    sheet.getRange(rowNum, 1, 1, WORKOUT_COLUMN_COUNT).getDisplayValues()[0],
    rowNum
  );
  if (current.source !== source || current.source_activity_id !== activityId) {
    throw new Error(
      'Workouts row ' + rowNum + ' was expected to hold ' + source + ' activity ' + activityId +
      ' but holds "' + current.source + '" / "' + current.source_activity_id + '". The sheet ' +
      'changed during the write; nothing was written. Re-run the sync.'
    );
  }

  var kept = [];
  for (var m = 0; m < SYNC_MERGED_FIELDS.length; m++) {
    var f = SYNC_MERGED_FIELDS[m];
    var sheetValue = current[f];
    var untouched = edited.indexOf(f) === -1 &&
      (lastWritten ? sheetValue === lastWritten[f] : sheetValue === '');
    if (untouched) {
      current[f] = incoming[f];
      continue;
    }
    if (sheetValue !== incoming[f]) kept.push(f);
    // With no last_written, a value that differs from COROS's may be the
    // user's or a vendor change; either way it is not overwritten, so it is
    // recorded as edited and stays so.
    if (edited.indexOf(f) === -1 && sheetValue !== incoming[f]) edited.push(f);
  }
  for (var w in owned) {
    if (Object.prototype.hasOwnProperty.call(owned, w)) current[w] = owned[w];
  }

  sheet.getRange(rowNum, 1, 1, WORKOUT_COLUMN_COUNT).setValues([asText(workoutToRow(current))]);
  return {
    status: 'updated', id: current.id, sheetRow: rowNum,
    written: pickSynced(current, edited), kept: kept,
  };
}

/**
 * The FIT step's two sync-owned fields (#154), or null when the payload sends
 * neither, so a caller that predates them leaves V and W alone. When sent they
 * are always overwritten, never merged, and they travel together.
 *
 * `fit_ref` is a Drive file ID and nothing else. A FIT download URL is an
 * unauthenticated secret (sync plan §2), so a value with `:`, `/` or `.` in it
 * is refused before it can reach the sheet, and the refusal does not echo it.
 * `fit_fetched_at` set with `fit_ref` blank means "no FIT will be fetched";
 * both blank means "not yet".
 */
function normalizeSyncedFit(payload) {
  var hasRef = payload.fit_ref !== undefined;
  var hasAt = payload.fit_fetched_at !== undefined;
  if (!hasRef && !hasAt) return null;
  if (hasRef !== hasAt) throw new Error('fit_ref and fit_fetched_at are sent together or not at all');
  var ref = cell(payload.fit_ref);
  var at = cell(payload.fit_fetched_at);
  if (ref && !/^[A-Za-z0-9_-]+$/.test(ref)) {
    throw new Error('fit_ref must be a Drive file ID (letters, digits, "-" and "_"); the value sent was not one');
  }
  if (at && !ISO_INSTANT.test(at)) {
    throw new Error('fit_fetched_at must be an ISO 8601 instant or blank, got "' + at + '"');
  }
  if (ref && !at) throw new Error('fit_ref needs fit_fetched_at');
  return { fit_ref: ref, fit_fetched_at: at };
}

/** `last_written.edited`: merged field names, or nothing. */
function normalizeEditedFields(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('last_written.edited must be an array of field names');
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var f = cell(value[i]);
    if (SYNC_MERGED_FIELDS.indexOf(f) === -1) {
      throw new Error('last_written.edited: "' + f + '" is not a synced field');
    }
    if (out.indexOf(f) === -1) out.push(f);
  }
  return out;
}

/**
 * The merged fields of a workout as the sheet holds them, and which of them
 * the user has edited, in SYNC_MERGED_FIELDS order so a re-run is identical.
 */
function pickSynced(workout, edited) {
  var out = {};
  for (var i = 0; i < SYNC_MERGED_FIELDS.length; i++) {
    out[SYNC_MERGED_FIELDS[i]] = cell(workout[SYNC_MERGED_FIELDS[i]]);
  }
  out.edited = SYNC_MERGED_FIELDS.filter(function (f) { return (edited || []).indexOf(f) !== -1; });
  return out;
}

/**
 * Delete a workout and every one of its set rows (#132 AC6).
 *
 * Addressed by id, never by row. The set rows go first and bottom-to-top:
 * removing a row shifts every row below it up, so descending order is what
 * keeps the remaining indices valid. Sets before the workout for the same
 * reason the MCP server appends them first — if the second step fails, stray
 * set rows are invisible orphans, whereas a workout row without its sets
 * would show up as an empty session.
 *
 * No preview mode: the MCP tool builds its dry run from reads, so this only
 * ever runs when the caller has already confirmed.
 */
function deleteWorkout(id) {
  if (!id) throw new Error('id is required');

  var workoutsSheet = getSheet(WORKOUTS_SHEET);
  var rowNum = findWorkoutRow(workoutsSheet, id);
  if (rowNum === -1) throw new Error('Workout "' + id + '" not found');

  var setRows = getSets({ workout_id: id })
    .map(function (s) { return s.sheetRow; })
    .sort(function (a, b) { return b - a; });

  var setsSheet = getSheet(SETS_SHEET);
  for (var i = 0; i < setRows.length; i++) {
    setsSheet.deleteRow(setRows[i]);
  }

  workoutsSheet.deleteRow(rowNum);
  return { workout_id: id, sets_deleted: setRows.length };
}
