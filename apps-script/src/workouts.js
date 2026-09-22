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
