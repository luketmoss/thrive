// Sets tab (A:J) — reads, slot resolution, and the atomic bulk update.
//
// This module is where #134's shaping principle bites hardest: callers name a
// set by workout, exercise, section, order and set number, and the *server*
// works out which row that is. An API that took a row index would leave every
// caller knowing the sheet shape, and the mirror would survive the refactor.

var SETS_SHEET = 'Sets';

function rowToSet(row, sheetRow) {
  return {
    workout_id: cell(row[0]),
    exercise_id: cell(row[1]),
    exercise_name: cell(row[2]),
    section: cell(row[3]),
    exercise_order: Number(row[4]) || 0,
    set_number: Number(row[5]) || 0,
    planned_reps: cell(row[6]),
    weight: cell(row[7]),
    reps: cell(row[8]),
    effort: cell(row[9]),
    sheetRow: sheetRow,
  };
}

/** Exactly ten cells. #100 removed column K; an eleventh would rewrite it. */
function setToRow(s) {
  var row = [];
  for (var i = 0; i < SET_FIELDS.length; i++) {
    row.push(cell(s[SET_FIELDS[i]]));
  }
  return row;
}

function getSets(filters) {
  var rows = getAllRows(getSheet(SETS_SHEET));
  var sets = [];
  for (var i = 0; i < rows.length; i++) {
    sets.push(rowToSet(rows[i], i + 2));
  }

  if (filters && filters.workout_id) {
    var wid = filters.workout_id;
    sets = sets.filter(function (s) { return s.workout_id === wid; });
  }
  if (filters && filters.exercise_id) {
    var eid = filters.exercise_id;
    sets = sets.filter(function (s) { return s.exercise_id === eid; });
  }
  return sets;
}

/**
 * The same exercise can legitimately appear twice in a workout — a warmup and
 * a primary of the same lift are separate slots with their own set numbering.
 * `exercise_id` alone is therefore not an identity.
 */
function slotKey(s) {
  return s.exercise_id + '__' + s.exercise_order;
}

/** Group a workout's sets into slots, ordered by exercise_order. */
function groupSetsByExercise(sets) {
  var order = [];
  var byKey = {};

  for (var i = 0; i < sets.length; i++) {
    var s = sets[i];
    var key = slotKey(s);
    if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
      byKey[key] = {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
      };
      order.push(key);
    }
    byKey[key].sets.push(s);
  }

  var slots = order.map(function (k) { return byKey[k]; });
  for (var j = 0; j < slots.length; j++) {
    slots[j].sets.sort(function (a, b) { return a.set_number - b.set_number; });
  }
  return slots.sort(function (a, b) { return a.exercise_order - b.exercise_order; });
}

/**
 * Slots for one exercise within one workout, optionally narrowed.
 *
 * Returns *every* match, so the caller can refuse to guess when an exercise
 * appears in two sections.
 */
function findSetSlots(sets, query) {
  var mine = sets.filter(function (s) {
    return s.workout_id === query.workout_id && s.exercise_id === query.exercise_id;
  });
  var slots = groupSetsByExercise(mine);

  if (query.section) {
    var q = String(query.section).toLowerCase();
    slots = slots.filter(function (g) { return String(g.section).toLowerCase() === q; });
  }
  if (query.exercise_order !== undefined && query.exercise_order !== null && query.exercise_order !== '') {
    var ord = Number(query.exercise_order);
    slots = slots.filter(function (g) { return g.exercise_order === ord; });
  }
  return slots;
}

/** Describe repeated slots so a caller can pick one. */
function describeSlots(slots) {
  return slots.map(function (g) {
    return '[' + (g.section || 'no section') + '] exercise_order ' + g.exercise_order +
      ', ' + g.sets.length + ' sets';
  }).join('; ');
}

/**
 * The one set row an update means, or a thrown error saying how to narrow it.
 *
 * Never falls back to a guess, and never appends when nothing matches —
 * silently creating a set the caller did not ask for is worse than refusing.
 */
function resolveSetTarget(sets, ex, query) {
  var slots = findSetSlots(sets, {
    workout_id: query.workout_id,
    exercise_id: ex.id,
    section: query.section,
    exercise_order: query.exercise_order,
  });

  if (!slots.length) {
    var all = findSetSlots(sets, { workout_id: query.workout_id, exercise_id: ex.id });
    throw new Error(
      'No ' + ex.name +
      (query.section ? ' in section ' + query.section : '') +
      (query.exercise_order ? ' at exercise_order ' + query.exercise_order : '') +
      ' in workout ' + query.workout_id +
      (all.length ? ' — it appears as ' + describeSlots(all) + '.' : '.')
    );
  }
  if (slots.length > 1) {
    throw new Error(
      ex.name + ' appears ' + slots.length + ' times in workout ' + query.workout_id +
      ' — ' + describeSlots(slots) + '. Pass section or exercise_order to say which set ' +
      query.set_number + ' you mean.'
    );
  }

  var slot = slots[0];
  var wanted = Number(query.set_number);
  var target = null;
  for (var i = 0; i < slot.sets.length; i++) {
    if (slot.sets[i].set_number === wanted) { target = slot.sets[i]; break; }
  }
  if (!target) {
    throw new Error(
      'No set ' + query.set_number + ' of ' + ex.name + ' [' + (slot.section || 'no section') +
      '] in workout ' + query.workout_id + ' — that slot has sets 1..' + slot.sets.length + '.'
    );
  }
  return { slot: slot, target: target };
}

/**
 * Resolve a batch of set corrections against one workout **without writing**.
 *
 * Every entry is checked and every problem collected: a half-applied batch is
 * worse than a rejected one, because the caller cannot tell which sets are
 * live without re-reading.
 *
 * This is also the whole of #134 AC4 — `previewSetUpdates` is this function
 * and nothing else, so a dry run and a real write resolve identically by
 * construction rather than by two code paths agreeing.
 */
function planSetUpdates(sets, workoutId, updates, library) {
  var changes = [];
  var errors = [];
  var claimed = {}; // sheetRow -> index of the entry that took it

  var allowed = ['exercise', 'set_number', 'section', 'exercise_order'].concat(SET_UPDATE_FIELDS);

  updates.forEach(function (u, i) {
    function fail(msg) {
      errors.push('updates[' + i + '] "' + (u.exercise || '') + '" set ' + u.set_number + ': ' + msg);
    }

    var unknown = Object.keys(u).filter(function (k) { return allowed.indexOf(k) === -1; });
    if (unknown.length) {
      return fail(
        'unknown field ' + unknown.map(function (k) { return '"' + k + '"'; }).join(', ') +
        ' — accepted: ' + allowed.join(', ')
      );
    }

    var touches = SET_UPDATE_FIELDS.some(function (f) { return u[f] !== undefined; });
    if (!touches) {
      return fail('nothing to change — pass at least one of ' + SET_UPDATE_FIELDS.join(', '));
    }

    if (u.effort !== undefined && u.effort !== '' && EFFORTS.indexOf(u.effort) === -1) {
      return fail('invalid effort "' + u.effort + '". Expected one of: ' + EFFORTS.join(', '));
    }

    var ex;
    var resolved;
    try {
      ex = resolveExercise(u.exercise, library);
      resolved = resolveSetTarget(sets, ex, {
        workout_id: workoutId,
        set_number: u.set_number,
        section: u.section,
        exercise_order: u.exercise_order,
      });
    } catch (err) {
      return fail(err.message || String(err));
    }

    var row = resolved.target.sheetRow;
    if (Object.prototype.hasOwnProperty.call(claimed, row)) {
      return fail('targets the same set as updates[' + claimed[row] + '] — combine them into one entry');
    }
    claimed[row] = i;

    var after = {};
    for (var key in resolved.target) {
      if (Object.prototype.hasOwnProperty.call(resolved.target, key)) after[key] = resolved.target[key];
    }
    for (var f = 0; f < SET_UPDATE_FIELDS.length; f++) {
      var field = SET_UPDATE_FIELDS[f];
      if (u[field] !== undefined) after[field] = cell(u[field]);
    }

    changes.push({
      index: i,
      exercise: { id: ex.id, name: ex.name },
      slot: { section: resolved.slot.section, exercise_order: resolved.slot.exercise_order },
      before: resolved.target,
      after: after,
    });
  });

  return { changes: changes, errors: errors };
}

/**
 * AC4: what a batch *would* change, writing nothing.
 *
 * Deliberately a thin wrapper rather than a parallel implementation — the
 * preview must resolve exactly as the write does, and the only way to
 * guarantee that is for them to be the same code.
 */
function previewSetUpdates(workoutId, updates) {
  if (!workoutId) throw new Error('workout_id is required');
  if (!updates || !updates.length) throw new Error('updates are required');

  var plan = planSetUpdates(getSets({ workout_id: workoutId }), workoutId, updates, getExercises());
  if (plan.errors.length) throw new Error(plan.errors.join('; '));
  return { changes: plan.changes, applied: false };
}

/**
 * Rows whose freshly read A..F no longer hold the workout, exercise and set
 * number they were resolved with — a row above was deleted and the index now
 * points at a different set (cf. #95).
 */
function findStaleSetRows(sets, freshRows) {
  return sets.filter(function (s, i) {
    var r = freshRows[i] || [];
    return cell(r[0]) !== s.workout_id ||
      cell(r[1]) !== s.exercise_id ||
      Number(r[5]) !== s.set_number;
  });
}

/**
 * Apply a batch of set corrections, all or nothing (#134 AC2).
 *
 * Resolution happens first and must succeed for *every* entry — one bad
 * target rejects the batch untouched. Each target row is then re-read and
 * checked before any write: within a single Apps Script execution the sheet
 * is unlikely to move underneath us, but "unlikely" is not the standard this
 * codebase holds for a write that could land on someone else's row.
 */
function applySetUpdates(workoutId, updates) {
  if (!workoutId) throw new Error('workout_id is required');
  if (!updates || !updates.length) throw new Error('updates are required');

  var sheet = getSheet(SETS_SHEET);
  var plan = planSetUpdates(getSets({ workout_id: workoutId }), workoutId, updates, getExercises());
  if (plan.errors.length) throw new Error(plan.errors.join('; '));

  var targets = plan.changes.map(function (c) { return c.after; });

  var fresh = targets.map(function (t) {
    return sheet.getRange(t.sheetRow, 1, 1, SET_IDENTITY_COLUMN_COUNT).getValues()[0];
  });
  var stale = findStaleSetRows(targets, fresh);
  if (stale.length) {
    throw new Error(
      stale.length + ' set row' + (stale.length > 1 ? 's' : '') + ' moved since ' +
      (stale.length > 1 ? 'they were' : 'it was') + ' read (sheet rows ' +
      stale.map(function (s) { return s.sheetRow; }).join(', ') + ') — the sheet changed ' +
      'underneath this call. Nothing was written; re-read the workout and retry.'
    );
  }

  for (var i = 0; i < targets.length; i++) {
    sheet.getRange(targets[i].sheetRow, 1, 1, SET_COLUMN_COUNT).setValues([setToRow(targets[i])]);
  }

  return { changes: plan.changes, applied: true };
}

/** Append set rows. Used when a workout is scheduled or built. */
function appendSets(sets) {
  if (!sets || !sets.length) throw new Error('sets are required');
  var sheet = getSheet(SETS_SHEET);
  var appended = [];
  for (var i = 0; i < sets.length; i++) {
    sheet.appendRow(setToRow(sets[i]));
    var s = rowToSet(setToRow(sets[i]), sheet.getLastRow());
    appended.push(s);
  }
  return appended;
}

/**
 * Every logged set of one exercise, newest workout first (#134 AC6).
 *
 * Served as an action rather than by fetching whole ranges and filtering
 * client-side: `thrive_exercise_history` is the query, and answering it here
 * is what stops the caller needing the sheet shape.
 */
function getExerciseHistory(ref, options) {
  var opts = options || {};
  var ex = resolveExercise(ref, getExercises());
  var mine = getSets({ exercise_id: ex.id });

  var workouts = getWorkouts();
  var byId = {};
  for (var i = 0; i < workouts.length; i++) byId[workouts[i].id] = workouts[i];

  var sessions = {};
  var order = [];
  for (var j = 0; j < mine.length; j++) {
    var s = mine[j];
    var w = byId[s.workout_id];
    if (!w) continue; // an orphaned set row has no session to report
    var key = s.workout_id + '__' + s.exercise_order;
    if (!Object.prototype.hasOwnProperty.call(sessions, key)) {
      sessions[key] = {
        workout_id: w.id,
        date: w.date,
        workout_name: w.name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
      };
      order.push(key);
    }
    sessions[key].sets.push(s);
  }

  var history = order.map(function (k) { return sessions[k]; });
  for (var n = 0; n < history.length; n++) {
    history[n].sets.sort(function (a, b) { return a.set_number - b.set_number; });
  }
  history.sort(function (a, b) { return b.date.localeCompare(a.date); });

  var limit = Number(opts.limit);
  if (isFinite(limit) && limit > 0) history = history.slice(0, limit);

  return { exercise: { id: ex.id, name: ex.name }, history: history };
}
