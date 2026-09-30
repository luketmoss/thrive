// #237 — how the Day screen writes a date in words. Pure.
//
// A `YYYY-MM-DD` is formatted as noon UTC in the UTC zone, so the device's
// time zone can never move it to a neighbouring day.

import { relativeLabel } from './dates';

function asUtcNoon(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fmt(date: string, opts: Intl.DateTimeFormatOptions): string {
  return asUtcNoon(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

/** "Saturday" */
export function weekdayName(date: string): string {
  return fmt(date, { weekday: 'long' });
}

/** "S" */
export function weekdayLetter(date: string): string {
  return fmt(date, { weekday: 'narrow' });
}

/** "12" */
export function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "September 12, 2026" */
export function fullDate(date: string): string {
  return fmt(date, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** "Saturday, September 12, 2026" */
export function weekdayFullDate(date: string): string {
  return `${weekdayName(date)}, ${fullDate(date)}`;
}

/** "Tuesday, January 14" */
export function weekdayMonthDay(date: string): string {
  return `${weekdayName(date)}, ${fmt(date, { month: 'long', day: 'numeric' })}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A strip day's accessible name: its date, then its counts when it has any.
 * "Tuesday, January 14 — 1 workout done, 1 planned". A zero count is left out.
 */
export function stripDayLabel(date: string, done: number, planned: number): string {
  const counts: string[] = [];
  if (done > 0) counts.push(`${plural(done, 'workout', 'workouts')} done`);
  if (planned > 0) {
    counts.push(done > 0 ? `${planned} planned` : `${plural(planned, 'workout', 'workouts')} planned`);
  }
  const name = weekdayMonthDay(date);
  return counts.length ? `${name} — ${counts.join(', ')}` : name;
}

/** What the status says after a move: "Saturday, September 12, 2026, 10 days ago". */
export function moveAnnouncement(date: string, today: string): string {
  return `${weekdayFullDate(date)}, ${relativeLabel(date, today)}`;
}
