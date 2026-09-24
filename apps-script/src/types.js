// Thrive data types — column constants and valid values.
//
// IMPORTANT: this is one of the two copies of the row layout, alongside
// frontend/src/api/types.ts. Per CLAUDE.md, a column added to a tab is added
// in both. There were three until #132 moved the MCP server onto this API;
// every consumer arriving later (the COROS sync, the Journal) calls the API
// instead of adding another copy.

// Column indices for the Workouts sheet (0-based), A:Z after #128/#129.
var COL = {
  ID: 0,                  // A
  DATE: 1,                // B  local calendar date, YYYY-MM-DD
  TIME: 2,                // C  local wall clock, HH:MM
  TYPE: 3,                // D
  NAME: 4,                // E
  TEMPLATE_ID: 5,         // F
  NOTES: 6,               // G
  ELAPSED_SECONDS: 7,     // H  seconds, never minutes
  CREATED: 8,             // I
  COPIED_FROM: 9,         // J
  STATUS: 10,             // K  '' = active/complete, 'planned' = saved for later
  MOVING_SECONDS: 11,     // L
  EFFORT: 12,             // M
  DISTANCE_M: 13,         // N
  ASCENT_M: 14,           // O
  DESCENT_M: 15,          // P
  AVG_HR: 16,             // Q
  SUB_TYPE: 17,           // R  venue/terrain (#129)
  SOURCE: 18,             // S  '' = logged by hand
  SOURCE_ACTIVITY_ID: 19, // T
  RAW_REF: 20,            // U
  FIT_REF: 21,            // V
  FIT_FETCHED_AT: 22,     // W
  SYNCED_AT: 23,          // X
  STARTED_AT_UTC: 24,     // Y
  CALORIES: 25,           // Z
};

var WORKOUT_COLUMN_COUNT = 26;

/**
 * The field name for each column, in sheet order. The read and write mappers
 * both derive from this, so a column cannot be present in one and missing
 * from the other — the failure mode #100 nearly shipped.
 */
var WORKOUT_FIELDS = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes',
  'elapsed_seconds', 'created', 'copied_from', 'status',
  'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
];

var WORKOUT_TYPES = ['weight', 'stretch', 'bike', 'hike', 'run', 'walk'];

/**
 * A synced activity's fields, as `upsertSyncedWorkout` treats them (#166,
 * sync plan §8).
 *
 * Merged: three-way. The incoming value is written only while the sheet still
 * holds what the sync last wrote; once the user edits a field in Thrive, that
 * field stops tracking the vendor for that activity.
 *
 * Sync-owned: always overwritten. Not user-editable.
 *
 * Every other column is never set by the action: `effort`, `notes`,
 * `status`, `template_id`, `copied_from` stay the user's, and `fit_ref` /
 * `fit_fetched_at` belong to #154's FIT step.
 */
var SYNC_MERGED_FIELDS = [
  'date', 'time', 'type', 'sub_type', 'name',
  'elapsed_seconds', 'moving_seconds', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'calories', 'started_at_utc',
];

var SYNC_OWNED_FIELDS = ['source', 'source_activity_id', 'raw_ref', 'synced_at'];

/** Merged fields that hold a whole number (seconds, meters, bpm, kcal) or ''. */
var SYNC_INTEGER_FIELDS = [
  'elapsed_seconds', 'moving_seconds', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'calories',
];

/**
 * Venue/terrain values the API will accept.
 *
 * Note the tension with #129, which made `sub_type` a free string in the SPA
 * so a new terrain needs no code change. #130 AC3 requires the API validate
 * it, so this list is the one place a new terrain has to be named. That is a
 * deliberate trade: the API is the write path for the COROS sync, and an
 * unrecognised venue arriving from a vendor mapping should fail loudly here
 * rather than land in the sheet and be discovered later by a report.
 */
var SUB_TYPES = ['mountain', 'gravel', 'indoor', 'outdoor'];

var EFFORTS = ['Easy', 'Medium', 'Hard'];

/** '' is a legitimate permanent state for status — 'planned' is the only flag. */
var WORKOUT_STATUSES = ['planned', 'active', 'complete'];

/**
 * The zone every naive `Date`/`Time` pair is in, and the zone "today" is
 * resolved in. Mirrors HOME_TZ in mcp-server/domain.js.
 *
 * No code path may slice an ISO timestamp to get a local date — a 7pm workout
 * would land on tomorrow.
 */
var TIMEZONE = 'America/Denver';

/**
 * Longest `payload` this API will accept, in characters (#130 AC5).
 *
 * Writes travel as a URL-encoded query parameter on `doGet`, because Apps
 * Script's redirect on POST breaks anonymous callers. That caps a request at
 * the URL length Apps Script will accept — roughly 8KB for the whole URL,
 * shared with the action, key and the percent-encoding overhead, which can
 * triple the size of a JSON payload full of quotes and braces.
 *
 * 6000 leaves headroom for that overhead. The alternative to refusing is
 * worse: an over-long URL is truncated in transit, and a truncated JSON
 * payload either fails to parse or — the dangerous case — parses into
 * something shorter that looks valid. #134's bulk actions are the first that
 * will hit this, and they must batch rather than hope.
 */
var MAX_PAYLOAD_CHARS = 6000;

// --- Exercises (A:E), Templates (A:H), Sets (A:J) — #134 ------------

var EXERCISE_FIELDS = ['id', 'name', 'tags', 'notes', 'created'];
var EXERCISE_COLUMN_COUNT = 5;

var TEMPLATE_FIELDS = [
  'template_id', 'template_name', 'order',
  'exercise_id', 'exercise_name', 'section', 'sets', 'reps',
];
var TEMPLATE_COLUMN_COUNT = 8;

// Ten cells. #100 removed column K "Notes"; a row wider than ten would write
// it back, because Sheets writes every value it is handed.
var SET_FIELDS = [
  'workout_id', 'exercise_id', 'exercise_name', 'section',
  'exercise_order', 'set_number', 'planned_reps', 'weight', 'reps', 'effort',
];
var SET_COLUMN_COUNT = 10;

/** Columns A..F of a Sets row — the identity a staleness check re-reads. */
var SET_IDENTITY_COLUMN_COUNT = 6;

var SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'];

/** The fields a set correction may change. Mirrors SET_UPDATE_FIELDS. */
var SET_UPDATE_FIELDS = ['weight', 'reps', 'planned_reps', 'effort'];

// --- DailySummary (A:R) — #131 --------------------------------------
//
// One row per local calendar day. Derived, never authoritative: if this tab
// and Workouts disagree, Workouts is right and this is stale.
//
// Coverage (H-J) sits next to the totals it qualifies rather than appended at
// the end. A sum over nullable fields is incomplete information without its
// coverage, so they belong together; readable ordering is free while the tab
// does not exist yet, and a migration later.
var DAILY_SUMMARY_FIELDS = [
  'date',                  // A  PK, America/Denver local calendar date
  'activity_count',        // B  all activities, indoor and outdoor
  'activity_types',        // C  e.g. "bike:mountain,weight"
  'total_moving_s',        // D
  'total_elapsed_s',       // E
  'total_distance_m',      // F  OUTDOOR ONLY
  'total_ascent_m',        // G  OUTDOOR ONLY
  'cardio_activity_count', // H  the `of` — outdoor cardio that day
  'distance_withdata',     // I  how many of H contributed to F
  'ascent_withdata',       // J  how many of H contributed to G
  'max_effort',            // K  session effort, blank when nobody said
  'effort_counts',         // L  e.g. "Hard:1,Medium:2"
  'steps',                 // M  from DailyHealth
  'resting_hr',            // N
  'hrv',                   // O
  'sleep_total_s',         // P
  'training_load',         // Q
  'computed_at',           // R
];

var DAILY_SUMMARY_COLUMN_COUNT = 18;

// --- DailyHealth (A:R) — #165 ---------------------------------------
//
// One row per local calendar day, written only by the COROS sync through
// upsertDailyHealth. Layout is sync plan §5, checked against a real payload in
// #133, plus #148's bed and wake times. Those two are appended after
// training_load rather than placed beside the sleep durations, so §5's column
// letters B-N did not move. There is no step-goal column: COROS sends none.
//
// Every value field is nullable. Blank means the payload did not carry it,
// never zero: a watch left on the charger overnight is not zero sleep.
// Units are SI: durations in integer seconds, clock times local `HH:mm`.
var DAILY_HEALTH_FIELDS = [
  'date',          // A  PK, local calendar date. Sleep is filed under its wake-up day
  'resting_hr',    // B  bpm, queryRestingHeartRate
  'hrv',           // C  ms, querySleepHrv's official daily average
  'steps',         // D  queryDailyHealthData
  'calories',      // E  kcal, queryDailyHealthData
  'sleep_total_s', // F  seconds, INCLUDES awake time (COROS's "Total")
  'sleep_deep_s',  // G
  'sleep_rem_s',   // H
  'sleep_light_s', // I
  'sleep_awake_s', // J
  'sleep_score',   // K  0-100, querySleepOverview
  'vo2max',        // L  current state only: written on the run date's row alone
  'recovery',      // M  % , current state only, as L
  'training_load', // N  queryTrainingLoadAssessment, per day
  'bed_time',      // O  local HH:mm, start of the main sleep window (#148)
  'wake_time',     // P  local HH:mm, end of the main sleep window (#148)
  'raw_ref',       // Q  Drive file ID of the health bundle it was parsed from
  'synced_at',     // R  the sync run's single timestamp
];

var DAILY_HEALTH_COLUMN_COUNT = 18;


// --- SyncLog (A:M) — #156 -------------------------------------------
//
// One row per sync run, appended by the COROS sync through appendSyncLog, read
// newest first by getSyncLog. Layout is sync plan §5. It is also the dead-man's
// switch: sync/deadman.mjs fails when the newest row is too old (sync plan §10).
var SYNC_LOG_FIELDS = [
  'run_id',        // A  <event>-<GITHUB_RUN_ID>-<attempt> in Actions, local-<started_at> otherwise
  'started_at',    // B  ISO instant, the run's single synced_at
  'finished_at',   // C  ISO instant
  'window_start',  // D  local date, D - 10
  'window_end',    // E  local date, D + 1
  'n_seen',        // F  activities the COROS list named
  'n_new',         // G  Workouts rows created
  'n_updated',     // H  Workouts rows whose merged fields changed
  'n_enriched',    // I  hand-logged strength rows enriched (#155); 0 until then
  'n_fit_fetched', // J  FIT files fetched (#154's rolling 24h budget sums this); 0 until then
  'n_errors',      // K  failures in the run
  'status',        // L  ok | partial | failed
  'error_detail',  // M  redacted failures; blank when ok
];

var SYNC_LOG_COLUMN_COUNT = 13;

var SYNC_LOG_STATUSES = ['ok', 'partial', 'failed'];

var SYNC_LOG_COUNT_FIELDS = ['n_seen', 'n_new', 'n_updated', 'n_enriched', 'n_fit_fetched', 'n_errors'];
