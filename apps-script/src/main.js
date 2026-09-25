// Entry point for the Thrive Apps Script web app.
//
// Everything goes through doGet, including writes: Apps Script answers POST
// with a redirect, which breaks anonymous callers. Writes pass their data as
// a URL-encoded `payload` query parameter, which is why that parameter has a
// length ceiling — see MAX_PAYLOAD_CHARS in types.js.
//
// Read examples:
//   ?action=getWorkouts&key=...
//   ?action=getWorkouts&key=...&from=2026-09-01&to=2026-09-30&type=bike
//   ?action=getWorkout&key=...&id=w_1a2b3c4d
//   ?action=getPlannedWorkouts&key=...&date=2026-09-21
//
// Write examples:
//   ?action=createWorkout&key=...&payload={"data":{"type":"bike","name":"Evening Ride"}}
//   ?action=updateWorkout&key=...&payload={"id":"w_1a2b3c4d","changes":{"effort":"Hard"}}
//
// Sets are addressed by domain identifiers, never by row (#134):
//   ?action=updateSets&key=...&payload={"workout_id":"w_1","updates":[
//     {"exercise":"Bench Press","set_number":1,"weight":"185","reps":"6"}]}
//   ?action=previewSetUpdates&key=...&payload={...}   — resolves, writes nothing
//
// DailyHealth rows are read and addressed by date (#165, #158):
//   ?action=getDailyHealth&key=...&from=2026-09-01&to=2026-09-30   — oldest first
//   ?action=upsertDailyHealth&key=...&payload={"rows":[{"date":"2026-09-23",
//     "steps":"2617","raw_ref":"<drive id>"}],"synced_at":"2026-09-24T13:25:32.000Z"}
//
// Synced activities are addressed by vendor ID, and merged (#166):
//   ?action=upsertSyncedWorkout&key=...&payload={"source":"coros",
//     "source_activity_id":"471166302945817201","incoming":{"date":"2026-09-24",
//     "type":"bike","sub_type":"gravel","name":"Gravel Bike",...},
//     "last_written":null,"raw_ref":"<drive id>","synced_at":"2026-09-24T17:41:10.000Z"}
//
// A strength session enriches its hand-logged weight row (#155):
//   ?action=enrichWorkout&key=...&payload={"source_activity_id":"471093115402967310",
//     "activity":{"date":"2026-09-23","time":"07:30","avg_hr":"88",...},
//     "last_written":null,"raw_ref":"<drive id>","synced_at":"..."}
//
// One row per sync run (#156):
//   ?action=appendSyncLog&key=...&payload={"row":{"run_id":"schedule-123-1",
//     "started_at":"...","finished_at":"...","status":"ok",...}}
//   ?action=getSyncLog&key=...&limit=1   — newest first by started_at

/**
 * Every response uses this shape — success, rejection and thrown error alike
 * (#130 AC1), so a caller never has to guess which of three shapes it got.
 */
function envelope(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(message) {
  return { success: false, error: message };
}

/**
 * The key lives in script properties, never in source — this file is in a
 * public repo. An unconfigured key is an error, not an open door.
 */
function validateApiKey(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected) throw new Error('API_KEY not configured in script properties');
  return key === expected;
}

/**
 * Parse the `payload` parameter, refusing one too long to have survived the
 * URL intact (#130 AC5).
 *
 * The check is on the way in rather than after parsing because the dangerous
 * case is not a parse failure — it is a truncated payload that still parses,
 * into an object missing its last fields. Refusing by length catches that
 * before it can be written.
 */
function parsePayload(raw) {
  if (!raw) return {};
  if (raw.length > MAX_PAYLOAD_CHARS) {
    throw new Error(
      'payload is ' + raw.length + ' characters, over the ' + MAX_PAYLOAD_CHARS +
      ' limit. Writes travel in the URL, so an over-long payload is truncated ' +
      'in transit rather than delivered. Split the request into batches.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'payload is not valid JSON (' + (err.message || String(err)) + '). ' +
      'If it is near the ' + MAX_PAYLOAD_CHARS + ' character limit it may have ' +
      'been truncated in transit.'
    );
  }
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action;
  var result;

  try {
    if (!validateApiKey(params.key)) {
      return envelope(fail('Invalid or missing API key'));
    }

    var payload = parsePayload(params.payload);

    switch (action) {
      // --- Reads ---
      case 'getWorkouts':
        result = {
          success: true,
          data: getWorkouts({
            date: params.date,
            from: params.from,
            to: params.to,
            type: params.type,
            status: params.status,
          }),
        };
        break;

      case 'getWorkout':
        if (!params.id) {
          result = fail('id parameter required');
          break;
        }
        var found = getWorkout(params.id);
        result = found
          ? { success: true, data: found }
          : fail('Workout "' + params.id + '" not found');
        break;

      // A date with nothing planned returns [], not an error.
      case 'getPlannedWorkouts':
        result = { success: true, data: getPlannedWorkouts(params.date) };
        break;

      // --- Writes ---
      case 'createWorkout':
        if (!payload.data) {
          result = fail('payload.data field required');
          break;
        }
        result = { success: true, data: createWorkout(payload.data) };
        break;

      case 'updateWorkout':
        if (!payload.id) {
          result = fail('payload.id field required');
          break;
        }
        if (!payload.changes) {
          result = fail('payload.changes field required');
          break;
        }
        result = { success: true, data: updateWorkout(payload.id, payload.changes) };
        break;

      // Dry-run lives in the caller: the MCP tool previews from reads, and only
      // calls this once confirmed (#132 AC6).
      case 'deleteWorkout':
        if (!payload.id) {
          result = fail('payload.id field required');
          break;
        }
        result = { success: true, data: deleteWorkout(payload.id) };
        break;

      // --- Exercises (#134) ---
      case 'getExercises':
        result = { success: true, data: getExercises({ tag: params.tag }) };
        break;

      case 'getExercise':
        if (!params.ref) {
          result = fail('ref parameter required');
          break;
        }
        result = { success: true, data: resolveExercise(params.ref, getExercises()) };
        break;

      case 'createExercise':
        if (!payload.data) {
          result = fail('payload.data field required');
          break;
        }
        result = { success: true, data: createExercise(payload.data) };
        break;

      // A rename cascades into Templates!E and Sets!C in the same call — #120.
      case 'updateExercise':
        if (!payload.id) {
          result = fail('payload.id field required');
          break;
        }
        if (!payload.changes) {
          result = fail('payload.changes field required');
          break;
        }
        result = { success: true, data: updateExercise(payload.id, payload.changes) };
        break;

      // Library row only; referencing rows are left in place (#132 AC6).
      case 'deleteExercise':
        if (!payload.id) {
          result = fail('payload.id field required');
          break;
        }
        result = { success: true, data: deleteExercise(payload.id) };
        break;

      case 'getExerciseHistory':
        if (!params.ref) {
          result = fail('ref parameter required');
          break;
        }
        result = { success: true, data: getExerciseHistory(params.ref, { limit: params.limit }) };
        break;

      // --- Templates (#134) ---
      case 'getTemplates':
        result = { success: true, data: getTemplates() };
        break;

      case 'getTemplate':
        if (!params.ref) {
          result = fail('ref parameter required');
          break;
        }
        result = { success: true, data: resolveTemplate(params.ref, getTemplates()) };
        break;

      case 'createTemplate':
        if (!payload.data) {
          result = fail('payload.data field required');
          break;
        }
        result = { success: true, data: createTemplate(payload.data) };
        break;

      case 'replaceTemplate':
        if (!payload.template_id) {
          result = fail('payload.template_id field required');
          break;
        }
        if (!payload.data) {
          result = fail('payload.data field required');
          break;
        }
        result = { success: true, data: replaceTemplate(payload.template_id, payload.data) };
        break;

      // --- Sets (#134) ---
      case 'getSets':
        result = {
          success: true,
          data: getSets({ workout_id: params.workout_id, exercise_id: params.exercise_id }),
        };
        break;

      case 'getWorkoutSets':
        if (!params.workout_id) {
          result = fail('workout_id parameter required');
          break;
        }
        result = {
          success: true,
          data: groupSetsByExercise(getSets({ workout_id: params.workout_id })),
        };
        break;

      case 'appendSets':
        if (!payload.sets) {
          result = fail('payload.sets field required');
          break;
        }
        result = { success: true, data: appendSets(payload.sets) };
        break;

      // AC4: resolution without writing, for a destructive-by-default dry run.
      case 'previewSetUpdates':
        if (!payload.workout_id) {
          result = fail('payload.workout_id field required');
          break;
        }
        if (!payload.updates) {
          result = fail('payload.updates field required');
          break;
        }
        result = { success: true, data: previewSetUpdates(payload.workout_id, payload.updates) };
        break;

      // AC2: all-or-nothing. One bad target rejects the batch untouched.
      case 'updateSets':
        if (!payload.workout_id) {
          result = fail('payload.workout_id field required');
          break;
        }
        if (!payload.updates) {
          result = fail('payload.updates field required');
          break;
        }
        result = { success: true, data: applySetUpdates(payload.workout_id, payload.updates) };
        break;

      // --- DailySummary (#131) ---
      case 'getDailySummary':
        result = {
          success: true,
          data: getDailySummaries({ from: params.from, to: params.to }),
        };
        break;

      // The range is a parameter: the nightly job and the historical backfill
      // are the same call with different bounds.
      case 'rebuildDailySummary':
        if (!payload.from || !payload.to) {
          result = fail('payload.from and payload.to are required (YYYY-MM-DD)');
          break;
        }
        result = {
          success: true,
          data: rebuildDailySummary(payload.from, payload.to, { computed_at: payload.computed_at }),
        };
        break;

      case 'getHistoryDateRange':
        result = { success: true, data: historyDateRange() };
        break;

      // --- DailyHealth (#165) ---
      // A read: from/to exactly as getDailySummary. A missing tab is [], not an
      // error. It belongs on #144's token read allow-list when that lands.
      case 'getDailyHealth':
        result = {
          success: true,
          data: getDailyHealthRows({ from: params.from, to: params.to }),
        };
        break;

      // Written by the COROS sync alone. A write, so key-only: it must never be
      // added to #144's token read allow-list when that lands.
      case 'upsertDailyHealth':
        if (!Array.isArray(payload.rows)) {
          result = fail('payload.rows field required (an array of rows keyed by field name)');
          break;
        }
        if (!payload.synced_at) {
          result = fail('payload.synced_at field required');
          break;
        }
        result = {
          success: true,
          data: withScriptLock(function () { return upsertDailyHealth(payload.rows, payload.synced_at); }),
        };
        break;

      // --- Synced workouts (#166) ---
      // The COROS sync's merge, by (source, source_activity_id). A write, so
      // key-only: it must never be added to #144's token read allow-list.
      case 'upsertSyncedWorkout':
        if (!payload.incoming) {
          result = fail('payload.incoming field required');
          break;
        }
        if (!Object.prototype.hasOwnProperty.call(payload, 'last_written')) {
          result = fail('payload.last_written field required (null when nothing was written before)');
          break;
        }
        result = {
          success: true,
          data: withScriptLock(function () { return upsertSyncedWorkout(payload); }),
        };
        break;

      // --- Strength enrichment (#155) ---
      // A COROS strength session fills blanks on its hand-logged weight row.
      // A write, so key-only, like the sync's others.
      case 'enrichWorkout':
        if (!payload.activity) {
          result = fail('payload.activity field required');
          break;
        }
        if (!Object.prototype.hasOwnProperty.call(payload, 'last_written')) {
          result = fail('payload.last_written field required (null when nothing was written before)');
          break;
        }
        result = {
          success: true,
          data: withScriptLock(function () { return enrichWorkout(payload); }),
        };
        break;

      // --- SyncLog (#156) ---
      // One row per sync run. A write, so key-only, like the sync's others.
      case 'appendSyncLog':
        if (!payload.row) {
          result = fail('payload.row field required (the run, keyed by field name)');
          break;
        }
        result = {
          success: true,
          data: withScriptLock(function () { return appendSyncLog(payload.row); }),
        };
        break;

      // Newest first by started_at. The dead-man's switch reads limit=1.
      case 'getSyncLog':
        result = { success: true, data: getSyncLog({ limit: params.limit }) };
        break;

      default:
        result = fail('Unknown action: "' + (action || '') + '"');
    }
  } catch (err) {
    result = fail(err.message || String(err));
  }

  return envelope(result);
}
