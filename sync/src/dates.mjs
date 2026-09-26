// Local calendar dates for the sync (#152). A date here is a `YYYY-MM-DD`
// string: calendar arithmetic is done in UTC on that string, so no time zone
// or DST transition can shift a day. Only the first step, "what day is it in
// Denver", looks at a clock.

import {
  HRV_MAX_DAYS, SYNC_TIME_ZONE, WINDOW_DAYS_AHEAD, WINDOW_DAYS_BACK,
  WITHINGS_WINDOW_DAYS_AHEAD, WITHINGS_WINDOW_DAYS_BACK,
} from './config.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map();

/** The local calendar date of an instant, in `timeZone`. */
export function localDate(instant, timeZone = SYNC_TIME_ZONE) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  const parts = Object.fromEntries(
    formatters.get(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const clockFormatters = new Map();

/**
 * An instant as local wall-clock terms in `timeZone` (#166 AC2): the calendar
 * date, `HH:MM`, and ISO 8601 with the offset in effect then, e.g.
 * `2026-09-19T14:03:00-06:00`. The offset is measured, not assumed, so an
 * MST date gets -07:00 and an MDT date -06:00.
 */
export function localDateTime(instant, timeZone = SYNC_TIME_ZONE) {
  if (!clockFormatters.has(timeZone)) {
    clockFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  const ms = Math.floor(new Date(instant).getTime() / 1000) * 1000;
  const p = Object.fromEntries(
    clockFormatters.get(timeZone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  const date = `${p.year}-${p.month}-${p.day}`;
  const clock = `${p.hour}:${p.minute}:${p.second}`;
  const offsetMin = Math.round((Date.parse(`${date}T${clock}Z`) - ms) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { date, time: `${p.hour}:${p.minute}`, iso: `${date}T${clock}${offset}` };
}

/** `date` moved by `n` calendar days. */
export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `start` to `end`, counting both. */
export function daysInclusive(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

/** COROS's date format: `20260924`. */
export const corosDate = (date) => date.replaceAll('-', '');

/**
 * The run's window. `runDate` is D; `start` and `end` bound it, inclusive.
 * `recentDays` is what a tool that takes only "the last N days" is asked for:
 * D − 10 through D. Those tools count back from today in the user's COROS time
 * zone, so they cannot be asked for D + 1.
 */
export function syncWindow(now = Date.now()) {
  const runDate = localDate(now);
  const start = addDays(runDate, -WINDOW_DAYS_BACK);
  const end = addDays(runDate, WINDOW_DAYS_AHEAD);
  return { runDate, start, end, recentDays: daysInclusive(start, runDate) };
}

/** `start`..`end` split into consecutive ranges of at most `max` days. */
export function chunkRange(start, end, max = HRV_MAX_DAYS) {
  const chunks = [];
  for (let from = start; from <= end; from = addDays(from, max)) {
    const to = addDays(from, max - 1);
    chunks.push([from, to < end ? to : end]);
  }
  return chunks;
}

/**
 * The instant (epoch ms) at which local calendar `date` begins in `timeZone`.
 * The zone's offset is measured at the guess and then at the corrected
 * instant, so a date on either side of a DST change gets its own offset.
 */
export function localMidnight(date, timeZone = SYNC_TIME_ZONE) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const offsetAt = (instant) => {
    const { iso } = localDateTime(instant, timeZone);
    return Date.parse(iso.slice(0, 19) + 'Z') - Math.floor(instant / 1000) * 1000;
  };
  let t = utc - offsetAt(utc);
  t = utc - offsetAt(t);
  return t;
}

/**
 * Withings' window (#197): local D − 30 days through the end of D + 1, as the
 * epoch seconds `getmeas` takes for `startdate` and `enddate`. `start` and
 * `end` are the same bounds as local dates, inclusive.
 */
export function withingsWindow(now = Date.now(), {
  daysBack = WITHINGS_WINDOW_DAYS_BACK, daysAhead = WITHINGS_WINDOW_DAYS_AHEAD,
} = {}) {
  const runDate = localDate(now);
  const start = addDays(runDate, -daysBack);
  const end = addDays(runDate, daysAhead);
  return {
    runDate,
    start,
    end,
    startdate: Math.floor(localMidnight(start) / 1000),
    enddate: Math.floor(localMidnight(addDays(end, 1)) / 1000) - 1,
  };
}
