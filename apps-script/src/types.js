// Thrive data types — column constants and valid values.
//
// IMPORTANT: this is one of the two copies of the row layout, alongside
// frontend/src/api/types.ts. Per CLAUDE.md, a column added to a tab is added
// in both. There were three until #132 moved the MCP server onto this API;
// every consumer arriving later (the COROS sync, the Journal) calls the API
// instead of adding another copy.

// Column indices for the Workouts sheet (0-based), A:AA after #128/#129/#145.
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
  ESTIMATED_SECONDS: 26,  // AA planned duration, seconds, typed per plan (#145)
};

var WORKOUT_COLUMN_COUNT = 27;

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
  'estimated_seconds',
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
 * FIT: `fit_ref` / `fit_fetched_at` (#154) are sync-owned too, but optional:
 * overwritten when the payload sends them (together), untouched when it
 * sends neither. See normalizeSyncedFit in workouts.js.
 *
 * Every other column is never set by the action: `effort`, `notes`,
 * `status`, `template_id`, `copied_from` and `estimated_seconds` (#145) stay
 * the user's.
 */
var SYNC_MERGED_FIELDS = [
  'date', 'time', 'type', 'sub_type', 'name',
  'elapsed_seconds', 'moving_seconds', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'calories', 'started_at_utc',
];

var SYNC_OWNED_FIELDS = ['source', 'source_activity_id', 'raw_ref', 'synced_at'];

/**
 * Strength enrichment (#155, sync plan §7): the fields a COROS strength
 * session may fill on the matching hand-logged `weight` row, and only where
 * the row holds a blank. A typed value is never overwritten.
 *
 * The row keeps `source = ''` and gains the link fields. The UI reads
 * "enriched" as `source == '' && source_activity_id != ''`.
 */
var ENRICH_FIELDS = ['elapsed_seconds', 'moving_seconds', 'avg_hr', 'calories'];

var ENRICH_LINK_FIELDS = ['source_activity_id', 'raw_ref', 'synced_at'];

/**
 * How far apart, in whole minutes of local wall clock, a COROS strength
 * session's start and a hand-logged row's `Time` may be and still match.
 * Inclusive.
 *
 * A judgment call on one data point (#155). The one real session, on 23 Sept
 * 2026, started on the watch about 9 minutes before the row's `Time`, which
 * the SPA stamps when Start is tapped. 30 minutes covers that with three
 * times the margin and stays far below the gap between two sessions on one
 * day. Revisit it when SyncLog.notes shows near misses.
 */
var STRENGTH_MATCH_TOLERANCE_MINUTES = 30;

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

// --- DailySummary (A:T) — #131, #181 --------------------------------
//
// One row per local calendar day. Derived, never authoritative: if this tab
// and Workouts disagree, Workouts is right and this is stale.
//
// Coverage (H-J) sits next to the totals it qualifies rather than appended at
// the end. A sum over nullable fields is incomplete information without its
// coverage, so they belong together; readable ordering is free while the tab
// does not exist yet, and a migration later.
//
// The duration coverage (S, T) came later (#181), and the body columns (U-Y)
// later still (#203); both are appended, not inserted, because almanac
// (luketmoss/keel) reads this tab by column, so no letter A:T may move.
var DAILY_SUMMARY_FIELDS = [
  'date',                  // A  PK, America/Denver local calendar date
  'activity_count',        // B  all activities, indoor and outdoor
  'activity_types',        // C  e.g. "bike:mountain,weight"
  'total_moving_s',        // D  blank when no activity recorded it; S is its coverage
  'total_elapsed_s',       // E  blank when no activity recorded it; T is its coverage
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
  'moving_withdata',       // S  #181: how many of B contributed to D
  'elapsed_withdata',      // T  #181: how many of B contributed to E
  'weight_kg',             // U  #203: from BodyMeasurements, the day's FIRST scale reading with a weight
  'fat_ratio_pct',         // V  #203: from that same reading, never mixed from another one
  'systolic_mmhg',         // W  #203: mean of the day's BP readings, rounded half up
  'diastolic_mmhg',        // X  #203: mean of the day's BP readings, rounded half up
  'bp_count',              // Y  #203: BP readings that day (rows, not values)
];

var DAILY_SUMMARY_COLUMN_COUNT = 25;

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


// --- SyncLog (A:N) — #156, #155 -------------------------------------
//
// One row per sync run, appended by the COROS sync through appendSyncLog, read
// newest first by getSyncLog. Layout is sync plan §5. It is also the dead-man's
// switch: sync/deadman.mjs fails when the newest row is too old (sync plan §10).
// Mirrored, read-only, by frontend/src/api/sync-log-api.ts for the Settings
// "Last synced" line (#157); change both together. Its test fails if they drift.
// WithingsSyncLog (#200) uses this same layout for the Withings sync's runs:
// n_seen is measure groups fetched, n_new/n_updated BodyMeasurements rows,
// n_enriched and n_fit_fetched always 0, notes the unattributed groups skipped.
var SYNC_LOG_FIELDS = [
  'run_id',        // A  <event>-<GITHUB_RUN_ID>-<attempt> in Actions, local-<started_at> otherwise
  'started_at',    // B  ISO instant, the run's single synced_at
  'finished_at',   // C  ISO instant
  'window_start',  // D  local date, D - 10
  'window_end',    // E  local date, D + 1
  'n_seen',        // F  activities the COROS list named
  'n_new',         // G  Workouts rows created
  'n_updated',     // H  Workouts rows whose merged fields changed
  'n_enriched',    // I  hand-logged strength rows the run wrote to (#155)
  'n_fit_fetched', // J  FIT requests made (#154's rolling 24h budget sums this)
  'n_errors',      // K  failures in the run
  'status',        // L  ok | partial | failed
  'error_detail',  // M  redacted failures; blank when ok
  'notes',         // N  not failures: strength sessions left unmatched (#155); blank when none
];

var SYNC_LOG_COLUMN_COUNT = 14;

var SYNC_LOG_STATUSES = ['ok', 'partial', 'failed'];

var SYNC_LOG_COUNT_FIELDS = ['n_seen', 'n_new', 'n_updated', 'n_enriched', 'n_fit_fetched', 'n_errors'];


// --- BodyMeasurements (A:T) — #198 ----------------------------------
//
// One row per Withings measure group, keyed by `grpid`, written only by the
// Withings sync through upsertBodyMeasurements. One tab for both devices: the
// Body+ scale (`kind` = scale) and the BPM Connect cuff (`kind` = bp).
//
// SI units stored: masses in kg, never lb. The kg -> lb display boundary lives
// with the consumers that display it (almanac, the MCP read in #201);
// `Sets!Weight` stays in lbs. Every measure is nullable: blank means the group
// carried no such measure, never 0. Later columns are only ever appended.
var BODY_MEASUREMENT_FIELDS = [
  'grpid',            // A  PK, Withings' group ID. An edited group keeps its grpid
  'date',             // B  local YYYY-MM-DD, America/Denver, from the group's `date`
  'time',             // C  local HH:mm, as Workouts!C
  'measured_at_utc',  // D  ISO 8601 with the offset then in effect, as Workouts!started_at_utc
  'kind',             // E  scale | bp
  'device_model',     // F  the group's `model` text, e.g. Body+
  'weight_kg',        // G  type 1
  'fat_ratio_pct',    // H  type 6
  'fat_mass_kg',      // I  type 8
  'fat_free_mass_kg', // J  type 5
  'muscle_mass_kg',   // K  type 76
  'hydration_kg',     // L  type 77
  'bone_mass_kg',     // M  type 88
  'systolic_mmhg',    // N  type 10
  'diastolic_mmhg',   // O  type 9
  'pulse_bpm',        // P  type 11: the cuff's pulse, or the scale's standing heart rate
  'attrib',           // Q  Withings' attribution code, kept so a consumer can filter
  'source',           // R  always `withings`
  'raw_ref',          // S  Drive file ID of the group's archive file (#197)
  'synced_at',        // T  the run's single timestamp
];

var BODY_MEASUREMENT_COLUMN_COUNT = 20;

var BODY_MEASUREMENT_KINDS = ['scale', 'bp'];
