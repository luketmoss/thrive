// Thrive data types — column constants and valid values.
//
// IMPORTANT: this is the third mirror of the row layout, alongside
// frontend/src/api/types.ts and mcp-server/domain.js. It exists to *cap* that
// count: every consumer arriving after this one (#131's DailySummary, the
// COROS sync, the Journal) calls this API instead of adding a fourth copy.
// Per CLAUDE.md, a column added to a tab is added here too.

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
