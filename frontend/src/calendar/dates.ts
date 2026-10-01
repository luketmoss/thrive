// #241 — the Calendar screen's month rules. Pure: no signals, no DOM.
//
// A month is a `YYYY-MM` string naming a calendar month in America/Denver; a
// date is `YYYY-MM-DD`, as in `day/dates.ts`, whose arithmetic this reuses.

import { addDays, dayNumber, weekOf } from '../day/dates';

/** True for a real `YYYY-MM` month: four-digit year, two-digit month 01–12. */
export function isIsoMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** The `YYYY-MM` month a `YYYY-MM-DD` date falls in. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** `month` moved by `n` whole months (negative goes back). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String(index - year * 12 + 1).padStart(2, '0')}`;
}

/** Every link to a month: `#/calendar` for today's month, `#/calendar/YYYY-MM` otherwise. */
export function calendarHref(month: string, today: string): string {
  return month === monthOf(today) ? '#/calendar' : `#/calendar/${month}`;
}

export interface CalendarPath {
  /** The month to show. */
  month: string;
  /** False when `param` was present and named no real month: show today's, and replace the URL. */
  valid: boolean;
}

/**
 * The month a `#/calendar[/param]` hash shows. No param is today's month; a
 * real `YYYY-MM` is that month (today's included, its URL left as written);
 * anything else is today's month, flagged so the router replaces the URL.
 */
export function parseCalendarPath(param: string | undefined, today: string): CalendarPath {
  if (param === undefined) return { month: monthOf(today), valid: true };
  if (isIsoMonth(param)) return { month: param, valid: true };
  return { month: monthOf(today), valid: false };
}

/** The last date of `month`. */
function lastOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

export interface GridRange {
  /** The Monday of the week holding the 1st. */
  start: string;
  /** The Sunday of the week holding the last day. */
  end: string;
  /** Every date from `start` to `end`: 28, 35 or 42 of them. */
  days: string[];
}

/** The dates a month grid shows, Monday first, whole weeks only. */
export function gridRange(month: string): GridRange {
  const start = weekOf(`${month}-01`)[0];
  const end = weekOf(lastOfMonth(month))[6];
  const n = dayNumber(end) - dayNumber(start) + 1;
  return { start, end, days: Array.from({ length: n }, (_, i) => addDays(start, i)) };
}

/** "September 2026" */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15, 12)).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  });
}
