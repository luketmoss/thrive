// Parse a run's daily-health bundle (#152's archive) into DailyHealth rows
// (#165). Pure: no Drive, no network, no clock. The input is the archived
// file's JSON; the output is domain objects keyed by field name. Row layout
// lives in apps-script/src/types.js alone.
//
// COROS answers in prose (#133), so this is a text parser, and a strict one:
//
// - A label it does not use is ignored, so COROS adding a line is harmless.
// - A label it does use, carrying a value, unit or shape it does not
//   recognize, fails that date (AC3). The date gets no row at all, never one
//   half-filled with guesses, and the failure names the date, tool and line.
// - A label that is simply absent means blank. Never 0: a watch left on the
//   charger overnight is not zero sleep.
//
// Dates are the bundle's own window, D − 10 to D, where D is its run date.
// COROS files sleep, HRV and the sleep window under the wake-up day, and so
// does this. D + 1 is fetched as a time-zone guard but carries no health data.

import { addDays } from './dates.mjs';
import { prose } from './ingest.mjs';

/** Every field the parser can fill, besides `date` and `raw_ref`. */
export const DAILY_FIELDS = [
  'resting_hr', 'hrv', 'steps', 'calories',
  'sleep_total_s', 'sleep_deep_s', 'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s',
  'sleep_score', 'training_load', 'bed_time', 'wake_time',
];

/**
 * Current-state only (sync plan §2): no date, and the value depends on when
 * the job ran. They go on D's row alone, and every other row omits them so
 * the snapshot an earlier day's run wrote survives.
 */
export const SNAPSHOT_FIELDS = ['vo2max', 'recovery'];

/** A line the parser needed and could not read. */
export class HealthFormatError extends Error {
  constructor(tool, line, reason) {
    super(`${tool}: ${reason}: "${String(line).trim().slice(0, 160)}"`);
    this.name = 'HealthFormatError';
    this.tool = tool;
    this.line = String(line).trim();
  }
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const isoFromCompact = (s) => s.replace(COMPACT, '$1-$2-$3');

/** `2,617` or `2617`. */
function integer(tool, line, value) {
  const v = value.trim();
  if (!/^\d{1,3}(,\d{3})+$|^\d+$/.test(v)) throw new HealthFormatError(tool, line, 'not a whole number');
  return String(Number(v.replaceAll(',', '')));
}

/** `57 bpm`, `412 kcal`, `41 ms`: a whole number and exactly this unit. */
function withUnit(tool, line, value, unit) {
  const m = value.trim().match(new RegExp(`^([\\d,]+) ${unit}$`));
  if (!m) throw new HealthFormatError(tool, line, `expected a whole number of ${unit}`);
  return integer(tool, line, m[1]);
}

/** `7h 15min`, `52 min`, `4h 22min`, `7h`, `0 min` -> whole seconds, as text. */
export function durationSeconds(tool, line, value) {
  const m = value.trim().match(/^(?:(\d+)h)?\s*(?:(\d+)\s*min)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) {
    throw new HealthFormatError(tool, line, 'unrecognized duration');
  }
  return String((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60);
}

/** `Label: value | Label: value` -> [[label, value, segment]]. */
function segments(line) {
  return line.split(' | ').map((seg) => {
    const i = seg.indexOf(':');
    return i === -1 ? [seg.trim(), null, seg] : [seg.slice(0, i).trim(), seg.slice(i + 1).trim(), seg];
  });
}

/**
 * Split prose into blocks under date headers. `header` returns an ISO date for
 * a header line, or null. Lines before the first header are the preamble.
 */
function blocks(text, header) {
  const out = [];
  let current = null;
  for (const line of text.split('\n')) {
    const date = header(line);
    if (date) {
      current = { date, lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out;
}

/** A payload with no dated entry must say so; anything else is a format change. */
function requireEntriesOrNoData(tool, text, found) {
  if (found) return;
  if (/\bno\b[^\n]*\bdata\b/i.test(text)) return;
  throw new HealthFormatError(tool, text.split('\n').slice(0, 3).join(' / '), 'no dated entries and no "no data" notice');
}

function requireHeading(tool, text, heading) {
  if (!text.startsWith(heading)) {
    throw new HealthFormatError(tool, text.split('\n')[0], `expected the result to start "${heading}"`);
  }
}

// --- one parser per tool ----------------------------------------------------
// Each returns [{ date, values }] and throws HealthFormatError for a problem
// it cannot pin to one date. A problem inside a date's entry is returned as
// { date, error } so only that date fails.

function eachDate(entries, tool, fn) {
  return entries.map(({ date, lines }) => {
    try {
      return { date, values: fn(lines, date) };
    } catch (err) {
      if (err instanceof HealthFormatError) return { date, error: err };
      throw err;
    }
  });
}

const SLEEP_STAGES = { Total: 'sleep_total_s', Deep: 'sleep_deep_s', Light: 'sleep_light_s', REM: 'sleep_rem_s', Awake: 'sleep_awake_s' };

/** Steps, calories and the sleep durations. `Total` includes awake time. */
function parseDailyHealthData(text, tool) {
  requireHeading(tool, text, 'Daily Health Data');
  const entries = blocks(text, (l) => {
    const m = l.match(/^--- (\d{8}) ---$/);
    return m ? isoFromCompact(m[1]) : null;
  });
  requireEntriesOrNoData(tool, text, entries.length);
  return eachDate(entries, tool, (lines) => {
    const v = {};
    let sleepSection = false;
    for (const line of lines) {
      if (/^Sleep Summary:\s*$/.test(line)) { sleepSection = true; continue; }
      for (const [label, value] of segments(line)) {
        if (value === null) continue;
        if (label === 'Steps') v.steps = integer(tool, line, value);
        else if (label === 'Calories') v.calories = withUnit(tool, line, value, 'kcal');
        else if (sleepSection && SLEEP_STAGES[label]) v[SLEEP_STAGES[label]] = durationSeconds(tool, line, value);
      }
    }
    if (sleepSection) {
      const missing = Object.keys(SLEEP_STAGES).filter((k) => v[SLEEP_STAGES[k]] === undefined);
      if (missing.length) {
        const line = lines.find((l) => /^\s+\S/.test(l)) ?? 'Sleep Summary:';
        throw new HealthFormatError(tool, line, `Sleep Summary without ${missing.join(', ')}`);
      }
    }
    return v;
  });
}

/**
 * Sleep score, and the main sleep window's bed and wake times. Its "Main
 * Sleep" duration excludes awake time, so the durations come from
 * queryDailyHealthData instead (#133).
 */
function parseSleepOverview(text, tool) {
  requireHeading(tool, text, 'Sleep Overview');
  const entries = blocks(text, (l) => (ISO.test(l) ? l : null));
  requireEntriesOrNoData(tool, text, entries.length);
  return eachDate(entries, tool, (lines, date) => {
    const v = {};
    for (const line of lines) {
      const [[label, value]] = segments(line);
      if (value === null) continue;
      if (label === 'Sleep Score') {
        if (!/^\d+$/.test(value) || Number(value) > 100) throw new HealthFormatError(tool, line, 'sleep score is not 0-100');
        // COROS writes "Sleep Score: 0" for a night it has not scored ("Sleep
        // detail for this day is not available yet"). Nobody sleeps a 0.
        v.sleep_score = value === '0' ? '' : value;
      } else if (label === 'Main Sleep Window') {
        const m = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) - (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
        if (!m) throw new HealthFormatError(tool, line, 'unrecognized sleep window');
        if (m[3] !== date) throw new HealthFormatError(tool, line, `sleep window ends on ${m[3]}, not its wake-up day ${date}`);
        v.bed_time = m[2];
        v.wake_time = m[4];
      }
    }
    return v;
  });
}

/** `2026-09-23: 57 bpm` or `2026-09-22: No data`, one line per day. */
function parseRestingHeartRate(text, tool) {
  requireHeading(tool, text, 'Resting Heart Rate');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)$/);
    if (!m) continue;
    const [, date, value] = m;
    if (/^No data$/i.test(value)) { out.push({ date, values: {} }); continue; }
    try {
      out.push({ date, values: { resting_hr: withUnit(tool, line, value, 'bpm') } });
    } catch (err) {
      out.push({ date, error: err });
    }
  }
  requireEntriesOrNoData(tool, text, out.length);
  return out;
}

/**
 * The day's short-term load. The assessment also carries long-term load and a
 * comment; `training_load` is the short-term (acute) figure.
 */
function parseTrainingLoad(text, tool) {
  requireHeading(tool, text, 'Training Load Assessment');
  const entries = blocks(text, (l) => (ISO.test(l) ? l : null));
  requireEntriesOrNoData(tool, text, entries.length);
  return eachDate(entries, tool, (lines) => {
    const v = {};
    for (const line of lines) {
      const [[label, value]] = segments(line);
      if (label !== 'Short-Term Load' || value === null) continue;
      if (!/^\d+(\.\d+)?$/.test(value)) throw new HealthFormatError(tool, line, 'short-term load is not a number');
      v.training_load = value;
    }
    return v;
  });
}

/**
 * The official daily average from the "HRV Assessment" section. The raw time
 * series below it is ignored: COROS's own description says not to average it.
 */
function parseSleepHrv(text, tool) {
  requireHeading(tool, text, 'Sleep HRV');
  const start = text.indexOf('HRV Assessment');
  if (start === -1) {
    requireEntriesOrNoData(tool, text, 0);
    return [];
  }
  const end = text.indexOf('Sleep HRV Time Series', start);
  const section = text.slice(start, end === -1 ? undefined : end);
  const entries = blocks(section, (l) => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}):\s*$/);
    return m ? m[1] : null;
  });
  return eachDate(entries, tool, (lines) => {
    const v = {};
    for (const line of lines) {
      const [[label, value]] = segments(line.trim());
      if (label === 'HRV Avg' && value !== null) v.hrv = withUnit(tool, line, value, 'ms');
    }
    return v;
  });
}

/** `Recovery: 87%`, as of when the job ran. */
function parseRecovery(text, tool) {
  requireHeading(tool, text, 'Recovery Status');
  const v = {};
  for (const line of text.split('\n')) {
    const [[label, value]] = segments(line);
    if (label !== 'Recovery' || value === null) continue;
    const m = value.match(/^(\d+)%$/);
    if (!m || Number(m[1]) > 100) throw new HealthFormatError(tool, line, 'recovery is not a 0-100 percentage');
    v.recovery = m[1];
  }
  return v;
}

/** VO2max, absent until the watch has outdoor runs to estimate from. */
function parseFitness(text, tool) {
  requireHeading(tool, text, 'Fitness Assessment Overview');
  const v = {};
  for (const line of text.split('\n')) {
    const [[label, value]] = segments(line);
    if (!/^VO2\s?max$/i.test(label) || value === null) continue;
    const m = value.match(/^(\d+(?:\.\d+)?)(?:\s*ml\/kg\/min)?$/i);
    if (!m) throw new HealthFormatError(tool, line, 'unrecognized VO2max');
    v.vo2max = m[1];
  }
  return v;
}

const DATED = {
  queryDailyHealthData: parseDailyHealthData,
  querySleepOverview: parseSleepOverview,
  queryRestingHeartRate: parseRestingHeartRate,
  queryTrainingLoadAssessment: parseTrainingLoad,
  querySleepHrv: parseSleepHrv,
};
const CURRENT = { queryRecoveryStatus: parseRecovery, queryFitnessAssessmentOverview: parseFitness };

/** Every date from `start` to `end`, inclusive. */
function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The dates a call covered, for failing them all when its whole text is unreadable. */
function datesOfCall(call, window) {
  const { startDate, endDate } = call.args ?? {};
  if (startDate && endDate) return datesBetween(isoFromCompact(startDate), isoFromCompact(endDate));
  return window;
}

/**
 * @param {{ run_date: string, window: { start: string }, calls: { tool: string, args: object, payload: string }[] }} bundle
 * @param {{ rawRef: string }} opts  the bundle's Drive file ID
 * @returns {{ rows: object[], failures: { date: string, tool: string, line: string, message: string }[] }}
 *   `rows` holds one domain object per date that has data and parsed cleanly.
 *   `failures` holds one entry per failed date and tool; a failed date has no row.
 */
export function parseHealthBundle(bundle, { rawRef }) {
  const D = bundle.run_date;
  const window = datesBetween(bundle.window.start, D);
  const inWindow = new Set(window);
  const values = new Map(window.map((d) => [d, {}]));
  const failed = new Map();

  const fail = (date, tool, err) => {
    if (!inWindow.has(date)) return;
    if (!failed.has(date)) failed.set(date, []);
    failed.get(date).push({ date, tool, line: err.line ?? '', message: err.message });
  };

  for (const call of bundle.calls) {
    const text = prose(call.payload);
    try {
      if (DATED[call.tool]) {
        for (const entry of DATED[call.tool](text, call.tool)) {
          if (!inWindow.has(entry.date)) continue;
          if (entry.error) fail(entry.date, call.tool, entry.error);
          else Object.assign(values.get(entry.date), entry.values);
        }
      } else if (CURRENT[call.tool]) {
        Object.assign(values.get(D), CURRENT[call.tool](text, call.tool));
      }
      // Any other tool in the bundle is not health data this parser reads.
    } catch (err) {
      if (!(err instanceof HealthFormatError)) throw err;
      const dates = CURRENT[call.tool] ? [D] : datesOfCall(call, window);
      for (const date of dates) fail(date, call.tool, err);
    }
  }

  const rows = [];
  for (const date of window) {
    if (failed.has(date)) continue;
    const v = values.get(date);
    const fields = date === D ? [...DAILY_FIELDS, ...SNAPSHOT_FIELDS] : DAILY_FIELDS;
    // A date every tool was silent about gets no row, rather than a row of blanks.
    if (!fields.some((f) => v[f])) continue;
    const row = { date };
    for (const f of fields) row[f] = v[f] ?? '';
    row.raw_ref = rawRef;
    rows.push(row);
  }

  return { rows, failures: [...failed.values()].flat() };
}
