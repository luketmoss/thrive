// Narration for the per-day tools (#158): DailyHealth and DailySummary.
//
// Pure. The rows arrive from api.js as domain objects keyed by field name;
// nothing here knows a column. Every field is nullable, and a blank is shown
// as "—" rather than dropped or printed as 0: an agent reading "sleep —" must
// not conclude "no sleep", and a missing label would hide that the field
// exists at all.

import { todayStr, secondsToMinutes, metersToMiles, metersToFeet, kgToLb } from './domain.js';

export const BLANK = '—';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/** "8400" -> "8,400"; blank -> "—". */
export function fmtCount(v) {
  if (isBlank(v)) return BLANK;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(v);
}

/** Seconds -> "7:15" (h:mm); blank -> "—". */
export function fmtHours(seconds) {
  if (isBlank(seconds)) return BLANK;
  const n = parseInt(seconds, 10);
  if (isNaN(n)) return String(seconds);
  const mins = Math.round(n / 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

/** `value` with a unit, or "—" when blank. */
const withUnit = (v, unit) => (isBlank(v) ? BLANK : `${v}${unit}`);

// --- date ranges ------------------------------------------------------

const DAY_MS = 86400000;
const toDay = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
const fromDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** `ymd` shifted by `days` calendar days. */
export function addDays(ymd, days) {
  return fromDay(toDay(ymd) + days * DAY_MS);
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from, to) {
  const out = [];
  for (let t = toDay(from); t <= toDay(to); t += DAY_MS) out.push(fromDay(t));
  return out;
}

export const DEFAULT_RANGE_DAYS = 7;

/**
 * The tools' `date_from` / `date_to`, resolved. Default: the `defaultDays`
 * days ending today (seven, unless a caller names a different default — the
 * 30-day default for thrive_body_measurements, #201). `normalize` is
 * domain.js's normalizeDate, injected so tests need no clock. A date that
 * does not parse is an error, not silently the default.
 */
export function resolveRange({ date_from, date_to }, normalize, today = todayStr(), defaultDays = DEFAULT_RANGE_DAYS) {
  const read = (label, v) => {
    if (isBlank(v)) return '';
    const d = normalize(v);
    if (!d) throw new Error(`could not read ${label} "${v}" as a date — use YYYY-MM-DD, 'today', 'tomorrow' or '+3d'`);
    return d;
  };
  const to = read('date_to', date_to) || today;
  const from = read('date_from', date_from) || addDays(to, -(defaultDays - 1));
  if (from > to) throw new Error(`date_from ${from} is after date_to ${to}`);
  return { from, to };
}

/** ["2026-09-01","2026-09-02","2026-09-04"] -> "2026-09-01 to 2026-09-02, 2026-09-04". */
export function describeDateRuns(dates) {
  const runs = [];
  for (const d of dates) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? a : `${a} to ${b}`)).join(', ');
}

/** The dates in range that have no row, as a line, or '' when every day has one. */
function missingDaysLine(rows, from, to, what) {
  const have = new Set(rows.map((r) => r.date));
  const missing = datesBetween(from, to).filter((d) => !have.has(d));
  if (!missing.length) return '';
  return `No ${what} row for ${missing.length} day${missing.length > 1 ? 's' : ''}: ${describeDateRuns(missing)}. ` +
    'No row means nothing was recorded, not a day of zeros.';
}

// --- DailyHealth ------------------------------------------------------

/** One DailyHealth object -> one line. Every field is named; blanks are "—". */
export function describeHealthDay(h) {
  const stages = [
    `deep ${fmtHours(h.sleep_deep_s)}`,
    `REM ${fmtHours(h.sleep_rem_s)}`,
    `light ${fmtHours(h.sleep_light_s)}`,
    `awake ${fmtHours(h.sleep_awake_s)}`,
  ].join(', ');
  return [
    `- ${h.date}:`,
    `resting HR ${withUnit(h.resting_hr, ' bpm')}`,
    `· HRV ${withUnit(h.hrv, ' ms')}`,
    `· steps ${fmtCount(h.steps)}`,
    `· calories ${isBlank(h.calories) ? BLANK : `${fmtCount(h.calories)} kcal`}`,
    `· sleep ${fmtHours(h.sleep_total_s)} [${stages}]`,
    `· sleep score ${withUnit(h.sleep_score, '')}`,
    `· bed ${withUnit(h.bed_time, '')} → wake ${withUnit(h.wake_time, '')}`,
    `· VO2max ${withUnit(h.vo2max, '')}`,
    `· recovery ${withUnit(h.recovery, '%')}`,
    `· training load ${withUnit(h.training_load, '')}`,
  ].join(' ');
}

/** The thrive_daily_health response. */
export function describeHealthRange(rows, { from, to }) {
  const out = [`Daily health, ${from} to ${to}: ${rows.length} day${rows.length === 1 ? '' : 's'} with a row.`];
  out.push('"—" means COROS did not report that field for that day; it is unknown, never zero.');
  const missing = missingDaysLine(rows, from, to, 'DailyHealth');
  if (missing) out.push(missing);
  if (rows.length) out.push('', ...rows.map(describeHealthDay));
  return out.join('\n');
}

// --- DailySummary -----------------------------------------------------

/** "bike:mountain,weight" -> "bike:mountain, weight". */
const listTypes = (s) => String(s).split(',').map((t) => t.trim()).filter(Boolean).join(', ');

/** "Hard:1,Medium:2" -> "Hard 1, Medium 2". */
const listEfforts = (s) => String(s).split(',').filter(Boolean).map((p) => p.replace(':', ' ')).join(', ');

const OUTDOOR = { verb: 'measured', noun: 'outdoor cardio session' };
const SESSIONS = { verb: 'recorded', noun: 'session' };

/**
 * One total with its coverage: "12.4 mi (measured on 1 of 2 outdoor cardio
 * sessions)", "42 min (recorded on 1 of 2 sessions)". A sum over nullable
 * fields is incomplete information without how many values it summed.
 *
 * A blank coverage count is a row written before that count existed (#181's
 * S and T, until the rebuild): it shows as "?", never as 0 of n.
 */
function coveredTotal(total, withData, of, render, { verb, noun }) {
  const n = Number(of);
  const known = !isBlank(withData);
  const w = Number(withData);
  const cover = `${verb} on ${known ? w : '?'} of ${n} ${noun}${n === 1 ? '' : 's'}`;
  if (isBlank(total) || (known && w === 0)) return `${BLANK} (${cover})`;
  return `${render(total)} (${cover})`;
}

const minutes = (s) => `${secondsToMinutes(s)} min`;

/** "72.3" -> "72.3 kg (159.4 lb)"; blank -> "—". */
const mass = (kg) => (isBlank(kg) ? BLANK : `${kg} kg (${kgToLb(kg)} lb)`);

/**
 * "118", "77", "3" -> "118/77 mean of 3"; blank `bp_count` -> "—" (#203). A
 * side missing from every reading that day shows as "—" on that side alone,
 * as body.js's per-reading BP does.
 */
function bpMean(s) {
  if (isBlank(s.bp_count)) return BLANK;
  const sys = isBlank(s.systolic_mmhg) ? BLANK : s.systolic_mmhg;
  const dia = isBlank(s.diastolic_mmhg) ? BLANK : s.diastolic_mmhg;
  return `${sys}/${dia} mean of ${s.bp_count}`;
}

/** One DailySummary object -> one line. */
export function describeSummaryDay(s) {
  const parts = [`- ${s.date}:`];
  if (isBlank(s.activity_count)) {
    parts.push('no activities logged');
  } else {
    const n = Number(s.activity_count);
    parts.push(`${n} activit${n === 1 ? 'y' : 'ies'} (${listTypes(s.activity_types) || BLANK})`);
    // Coverage is against every activity that day (B), not just outdoor
    // cardio: every activity type has a duration (#181).
    parts.push(`· moving ${coveredTotal(s.total_moving_s, s.moving_withdata, n, minutes, SESSIONS)}`);
    parts.push(`· elapsed ${coveredTotal(s.total_elapsed_s, s.elapsed_withdata, n, minutes, SESSIONS)}`);
    if (isBlank(s.cardio_activity_count) || Number(s.cardio_activity_count) === 0) {
      parts.push('· outdoor distance/ascent: no outdoor cardio');
    } else {
      parts.push(`· outdoor distance ${coveredTotal(s.total_distance_m, s.distance_withdata, s.cardio_activity_count, (m) => `${metersToMiles(m)} mi`, OUTDOOR)}`);
      parts.push(`· outdoor ascent ${coveredTotal(s.total_ascent_m, s.ascent_withdata, s.cardio_activity_count, (m) => `${fmtCount(metersToFeet(m))} ft`, OUTDOOR)}`);
    }
    parts.push(`· max effort ${isBlank(s.max_effort) ? BLANK : `${s.max_effort} (${listEfforts(s.effort_counts)})`}`);
  }
  parts.push(`· steps ${fmtCount(s.steps)}`);
  parts.push(`· resting HR ${withUnit(s.resting_hr, ' bpm')}`);
  parts.push(`· HRV ${withUnit(s.hrv, ' ms')}`);
  parts.push(`· sleep ${fmtHours(s.sleep_total_s)}`);
  parts.push(`· training load ${withUnit(s.training_load, '')}`);
  parts.push(`· weight ${mass(s.weight_kg)}`);
  parts.push(`· fat ${withUnit(s.fat_ratio_pct, ' %')}`);
  parts.push(`· BP ${bpMean(s)}`);
  return parts.join(' ');
}

/** The thrive_daily_summary response. */
export function describeSummaryRange(rows, { from, to }) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const out = [`Daily summary, ${from} to ${to}: ${sorted.length} day${sorted.length === 1 ? '' : 's'} with a row.`];
  out.push(
    'Distance and ascent are OUTDOOR ONLY: on a day with an indoor session they will not equal the sum of ' +
    "that day's activity distances. Derived from Workouts + DailyHealth: where it disagrees with " +
    'thrive_list_workouts, the workouts are right and this row is stale. "—" means unknown, never zero.',
  );
  out.push(
    "Moving and elapsed say how many of the day's sessions recorded them: \"recorded on 1 of 2\" means " +
    'the total covers one session and the other is unknown, not zero.',
  );
  out.push(
    'Weight and fat are the day\'s FIRST scale reading with a weight, not a mean; BP is the MEAN of the ' +
    "day's readings, with the count behind it. Both are rolled up from BodyMeasurements (#203); \"—\" means no such reading that day.",
  );
  const stamps = sorted.map((r) => r.computed_at).filter((v) => !isBlank(v)).sort();
  if (stamps.length) out.push(`Oldest row computed at ${stamps[0]}.`);
  const missing = missingDaysLine(sorted, from, to, 'DailySummary');
  if (missing) out.push(missing.replace('nothing was recorded', 'no activity and no health data'));
  if (sorted.length) out.push('', ...sorted.map(describeSummaryDay));
  return out.join('\n');
}
