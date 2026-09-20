// Exercises tab (A:E), plus the rename propagation the denormalization needs.

var EXERCISES_SHEET = 'Exercises';

function rowToExercise(row, sheetRow) {
  var ex = {};
  for (var i = 0; i < EXERCISE_FIELDS.length; i++) {
    ex[EXERCISE_FIELDS[i]] = cell(row[i]);
  }
  ex.sheetRow = sheetRow;
  return ex;
}

function exerciseToRow(ex) {
  var row = [];
  for (var i = 0; i < EXERCISE_FIELDS.length; i++) {
    row.push(cell(ex[EXERCISE_FIELDS[i]]));
  }
  return row;
}

function getExercises(filters) {
  var rows = getAllRows(getSheet(EXERCISES_SHEET));
  var exercises = [];
  for (var i = 0; i < rows.length; i++) {
    exercises.push(rowToExercise(rows[i], i + 2));
  }

  if (filters && filters.tag) {
    var tag = String(filters.tag).toLowerCase();
    exercises = exercises.filter(function (e) {
      return e.tags.split(',').some(function (t) {
        return t.trim().toLowerCase() === tag;
      });
    });
  }
  return exercises;
}

/**
 * An exercise by id or name.
 *
 * Mirrors `resolveExercise` in mcp-server/index.js exactly — id, then a
 * unique exact name, then a unique partial — because #132 deletes that copy
 * and callers must not notice a change in which references resolve.
 *
 * Every ambiguity throws with the candidates named. Guessing between two
 * exercises with the same name is how the wrong set gets logged.
 */
function resolveExercise(ref, exercises) {
  var q = String(ref === undefined ? '' : ref).trim().toLowerCase();
  if (q === '') throw new Error('An exercise reference is required.');

  var list = exercises || getExercises();

  for (var i = 0; i < list.length; i++) {
    if (list[i].id.toLowerCase() === q) return list[i];
  }

  var exact = list.filter(function (e) { return e.name.toLowerCase() === q; });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      '"' + ref + '" matches ' + exact.length + ' exercises with the same name. ' +
      'Use an id: ' + exact.map(function (e) { return e.id; }).join(', ')
    );
  }

  var partial = list.filter(function (e) { return e.name.toLowerCase().indexOf(q) !== -1; });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      '"' + ref + '" is ambiguous — matches: ' +
      partial.map(function (e) { return e.name + ' (' + e.id + ')'; }).join(', ')
    );
  }

  throw new Error('No exercise matching "' + ref + '".');
}

function createExercise(data) {
  if (!data || !data.name) throw new Error('name is required');

  var ex = {
    id: data.id || 'ex_' + Utilities.getUuid().slice(0, 8),
    name: cell(data.name),
    tags: cell(data.tags),
    notes: cell(data.notes),
    // Written and never read — a deliberate forensic trail, per CLAUDE.md.
    created: isoNow(),
  };
  var sheet = getSheet(EXERCISES_SHEET);
  sheet.appendRow(exerciseToRow(ex));
  ex.sheetRow = sheet.getLastRow();
  return ex;
}

/**
 * Templates and Sets rows cache `exercise_name` beside `exercise_id`.
 *
 * Returns rows whose cached name no longer matches the library (`stale`, with
 * the current `name`), and rows whose id is not in the library at all
 * (`orphans`) — a name refresh fixes the first and never the second.
 *
 * Deliberately identical to `findStaleExerciseNames` in mcp-server/domain.js
 * so this API and `scripts/sync-exercise-names.mjs` cannot disagree about
 * what "stale" means (#120, #134 AC5).
 */
function findStaleExerciseNames(rows, exercises) {
  var byId = {};
  for (var i = 0; i < exercises.length; i++) byId[exercises[i].id] = exercises[i].name;

  var stale = [];
  var orphans = [];
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var name = Object.prototype.hasOwnProperty.call(byId, row.exercise_id)
      ? byId[row.exercise_id]
      : undefined;
    if (name === undefined) orphans.push(row);
    else if (name !== row.exercise_name) stale.push({ row: row, name: name });
  }
  return { stale: stale, orphans: orphans };
}

/**
 * Update an exercise, cascading a rename into the copies.
 *
 * `Templates!E` and `Sets!C` hold a denormalized copy of the name. #120 is
 * the bug that caused: a rename left them behind, and a template expanded
 * later wrote the *old* name into a fresh workout. The cascade is part of the
 * rename, not a follow-up chore — so it happens in the same call.
 */
function updateExercise(id, changes) {
  if (!id) throw new Error('id is required');
  if (!changes) throw new Error('changes are required');

  var sheet = getSheet(EXERCISES_SHEET);
  var rows = getAllRows(sheet);
  var rowNum = -1;
  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (cell(rows[i][0]) === id) {
      rowNum = i + 2;
      existing = rowToExercise(rows[i], rowNum);
      break;
    }
  }
  if (rowNum === -1) throw new Error('Exercise "' + id + '" not found');

  for (var key in changes) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    if (EXERCISE_FIELDS.indexOf(key) === -1) {
      throw new Error(
        'Unknown field: "' + key + '". Valid fields: ' + EXERCISE_FIELDS.join(', ')
      );
    }
    if (key === 'id') throw new Error('id cannot be changed');
    if (key === 'created') throw new Error('created cannot be changed — it is a forensic trail');
    existing[key] = cell(changes[key]);
  }

  sheet.getRange(rowNum, 1, 1, EXERCISE_COLUMN_COUNT).setValues([exerciseToRow(existing)]);

  var cascaded = { templates: 0, sets: 0 };
  if (changes.name !== undefined) {
    cascaded = cascadeExerciseName(existing.id, existing.name);
  }

  existing.cascaded = cascaded;
  return existing;
}

/**
 * Rewrite the cached name in Templates!E and Sets!C for one exercise.
 *
 * Detection goes through `findStaleExerciseNames`, so the API agrees with
 * `scripts/sync-exercise-names.mjs` by construction rather than by having
 * been written to match.
 */
function cascadeExerciseName(exerciseId, name) {
  var library = [{ id: exerciseId, name: name }];

  var templateSheet = getSheet(TEMPLATES_SHEET);
  var templateRows = getTemplateRows().filter(function (r) {
    return r.exercise_id === exerciseId;
  });
  var templateStale = findStaleExerciseNames(templateRows, library).stale;
  for (var i = 0; i < templateStale.length; i++) {
    templateSheet
      .getRange(templateStale[i].row.sheetRow, TEMPLATE_FIELDS.indexOf('exercise_name') + 1, 1, 1)
      .setValues([[name]]);
  }

  var setsSheet = getSheet(SETS_SHEET);
  var setRows = getSets().filter(function (r) { return r.exercise_id === exerciseId; });
  var setsStale = findStaleExerciseNames(setRows, library).stale;
  for (var j = 0; j < setsStale.length; j++) {
    setsSheet
      .getRange(setsStale[j].row.sheetRow, SET_FIELDS.indexOf('exercise_name') + 1, 1, 1)
      .setValues([[name]]);
  }

  return { templates: templateStale.length, sets: setsStale.length };
}
