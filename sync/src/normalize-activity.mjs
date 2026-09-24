// One archived COROS activity -> the merged fields of a Workouts row (#166).
// Pure: no Drive, no network, no clock. The input is #152's archive file; the
// output is a domain object keyed by field name. Row layout lives in
// apps-script/src/types.js alone.
//
// The numbers come from the detail payload's prose (#153 decided prose over
// FIT). The start time and the name come from the archived list entry,
// because the detail payload carries neither. Strict, like #165's parser:
//
// - A label it does not use is ignored, so COROS adding a line is harmless.
// - A label it does use, with a value or unit it does not recognize, fails the
//   activity (AC2): no row is written, and the error names the line.
// - A label that is absent means blank. Never 0.
//
// What the labels mean, from the payloads seen in #152, #165 and #166:
//
// - `Total Time` is elapsed wall-clock time. On every archived activity it
//   equals the list entry's endTimestamp − startTimestamp (to the second, one
//   rounding second off on one hike).
// - `Workout Time` is timer time with pauses removed. The gym cardio session
//   shows it under a minute short of `Total Time`, and it is what the list calls
//   `Duration`. It is written as `moving_seconds`: the nearest thing COROS
//   sends. It is not stationary-time-excluded moving time in Strava's sense
//   (COROS's "Moving Average Speed" implies it computes one, but never sends
//   the duration), so treat it as "active time".
// - A walk has no `Total Time` line at all, so its elapsed time falls back to
//   the list entry's timestamps.
//
// UNCONFIRMED: every archived activity so far is under an hour, so nobody has
// seen how COROS writes a longer duration. `h:mm:ss` is accepted as well as
// `m:ss`/`mm:ss`, defensively; replace this note once a real long activity is
// archived. Anything else is a normalization failure, never a guess.

import { localDateTime } from './dates.mjs';
import { prose } from './ingest.mjs';

/** The merged fields, in the order apps-script/src/types.js lists them. */
export const ACTIVITY_FIELDS = [
  'date', 'time', 'type', 'sub_type', 'name',
  'elapsed_seconds', 'moving_seconds', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'calories', 'started_at_utc',
];

/** A line the parser needed and could not read. The activity gets no row. */
export class ActivityFormatError extends Error {
  constructor(line, reason) {
    super(`${reason}: "${String(line).trim().slice(0, 160)}"`);
    this.name = 'ActivityFormatError';
    this.line = String(line).trim();
  }
}

/** `5:43`, `41:12`, or (unconfirmed, see the header) `1:15:30` -> seconds. */
export function durationSeconds(line, value) {
  const hms = value.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const ms = value.match(/^(\d+):([0-5]\d)$/);
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  throw new ActivityFormatError(line, 'unrecognized duration');
}

const whole = (s) => Number(s.replaceAll(',', ''));

/** Each label the parser reads, and how. Every result is a whole number. */
const LABELS = {
  'Workout Time': (line, v) => ({ workout: durationSeconds(line, v) }),
  'Total Time': (line, v) => ({ total: durationSeconds(line, v) }),
  Distance: (line, v) => {
    // `0.43 km`: COROS shows two decimals, so this is 10 m resolution.
    const m = v.match(/^(\d+(?:\.\d+)?) km$/);
    if (!m) throw new ActivityFormatError(line, 'expected a distance in km');
    return { distance_m: Math.round(Number(m[1]) * 1000) };
  },
  'Average Heart Rate': (line, v) => {
    const m = v.match(/^(\d+) bpm$/);
    if (!m) throw new ActivityFormatError(line, 'expected a whole number of bpm');
    return { avg_hr: Number(m[1]) };
  },
  Calories: (line, v) => {
    const m = v.match(/^(\d{1,3}(?:,\d{3})+|\d+) kcal$/);
    if (!m) throw new ActivityFormatError(line, 'expected a whole number of kcal');
    return { calories: whole(m[1]) };
  },
  'Elevation Gain / Loss': (line, v) => {
    const m = v.match(/^(\d+) m \/ (\d+) m$/);
    if (!m) throw new ActivityFormatError(line, 'expected "<gain> m / <loss> m"');
    return { ascent_m: Number(m[1]), descent_m: Number(m[2]) };
  },
};

/**
 * The detail payload's recognized values, keyed by what they become.
 * Exported for tests; `normalizeActivity` is the caller.
 */
export function parseActivityDetail(payload) {
  const found = {};
  const seen = new Set();
  for (const raw of prose(payload).split('\n')) {
    const line = raw.trim();
    if (!line || /^=+$/.test(line) || /Activity Details$/.test(line)) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    const label = line.slice(0, i).trim();
    const read = LABELS[label];
    if (!read) continue;
    if (seen.has(label)) throw new ActivityFormatError(line, `"${label}" appears twice`);
    seen.add(label);
    Object.assign(found, read(line, line.slice(i + 1).trim()));
  }
  return found;
}

/** The list entry carries a GPS start point when, and only when, there was a track. */
const START_COORDINATES = /^\s*Start Coordinates: -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)?\s*$/m;

/**
 * Walk's venue, from the archived list entry (#166 AC1).
 *
 * The detail payload carries no location at all, for any sport, so the track
 * test reads the list entry, which is archived prose too and never depends on
 * the FIT budget. Every outdoor session seen has a `Start Coordinates` line;
 * the indoor ones have none. No list text at all settles nothing.
 */
export function walkVenue(listEntry) {
  const text = listEntry?.text;
  if (typeof text !== 'string' || !text) return '';
  return START_COORDINATES.test(text) ? 'outdoor' : 'indoor';
}

const cell = (n) => (n === undefined || n === null ? '' : String(n));

/**
 * @param {object} file  an archived activity: `list_entry`, `payload`
 * @param {{ type: string, sub_type: string }} mapping  from classifySport
 * @returns {Record<string, string>}  every ACTIVITY_FIELDS key, '' when blank
 * @throws ActivityFormatError
 */
export function normalizeActivity(file, mapping) {
  const entry = file.list_entry ?? {};
  const detail = parseActivityDetail(file.payload ?? '');

  const start = entry.startTimestamp;
  if (!Number.isInteger(start) || start <= 0) {
    const where = String(entry.text ?? '').split('\n').find((l) => /Time Window/.test(l));
    throw new ActivityFormatError(where ?? '(no list entry)', 'no start time');
  }
  if (detail.workout === undefined && detail.total === undefined) {
    throw new ActivityFormatError('(no Workout Time or Total Time line)', 'no duration');
  }
  const name = String(entry.name ?? '').trim();
  if (!name) throw new ActivityFormatError(String(entry.text ?? '').split('\n')[0] ?? '', 'no activity name');

  const end = entry.endTimestamp;
  const elapsed = detail.total
    ?? (Number.isInteger(end) && end >= start ? end - start : undefined);

  const subType = mapping.sub_type === 'from-track' ? walkVenue(entry) : mapping.sub_type;
  const indoor = subType === 'indoor';
  const { date, time, iso } = localDateTime(start * 1000);

  // Field applicability follows cardioFieldsFor() in cardio-fields.tsx: no
  // ascent indoors (a trainer's "0 m" is not a climb), descent for hikes only.
  return {
    date,
    time,
    type: mapping.type,
    sub_type: subType,
    name,
    elapsed_seconds: cell(elapsed),
    moving_seconds: cell(detail.workout),
    distance_m: cell(detail.distance_m),
    ascent_m: indoor ? '' : cell(detail.ascent_m),
    descent_m: mapping.type === 'hike' ? cell(detail.descent_m) : '',
    avg_hr: cell(detail.avg_hr),
    calories: cell(detail.calories),
    started_at_utc: iso,
  };
}
