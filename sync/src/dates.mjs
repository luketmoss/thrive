// Local calendar dates for the sync (#152). A date here is a `YYYY-MM-DD`
// string: calendar arithmetic is done in UTC on that string, so no time zone
// or DST transition can shift a day. Only the first step, "what day is it in
// Denver", looks at a clock.

import { HRV_MAX_DAYS, SYNC_TIME_ZONE, WINDOW_DAYS_AHEAD, WINDOW_DAYS_BACK } from './config.mjs';

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
