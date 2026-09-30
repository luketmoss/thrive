// #237 — how the Day screen writes a date in words. Pure.
//
// A `YYYY-MM-DD` is formatted as noon UTC in the UTC zone, so the device's
// time zone can never move it to a neighbouring day.

import { addDays, DENVER, relativeLabel, todayInDenver } from './dates';

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

// ── Health and Body panels (#239) ───────────────────────────────────

/** Seconds as `Hh MMm`, rounded to the minute: "7h 12m", "0h 06m". `null` for no value. */
export function hoursMinutes(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** A local `HH:MM[:SS]` as "6:12 AM", or `''` when it does not parse. */
export function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm.trim());
  if (!m) return '';
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The night a day's sleep covers. Sleep is filed under its wake-up day, so on
 * a past Saturday it is "Fri night"; on today it is "last night".
 */
export function nightOf(date: string, isToday: boolean): string {
  if (isToday) return 'last night';
  return `${fmt(addDays(date, -1), { weekday: 'short' })} night`;
}

const denverClock = new Intl.DateTimeFormat('en-US', {
  timeZone: DENVER, hour: 'numeric', minute: '2-digit', hour12: true,
});
const denverMonthDay = new Intl.DateTimeFormat('en-US', {
  timeZone: DENVER, month: 'short', day: 'numeric',
});

/**
 * When an instant happened, in Denver: "7:17 AM" when it is on `date`,
 * "Sep 26, 6:17 PM" when on another day, `''` when `iso` is blank or not a date.
 */
export function syncTime(iso: string, date: string): string {
  if (!iso.trim()) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const at = new Date(t);
  const clock = denverClock.format(at).replace(/\s/g, ' '); // ICU puts U+202F before AM/PM
  return todayInDenver(at) === date ? clock : `${denverMonthDay.format(at)}, ${clock}`;
}

/** "Synced 7:17 AM", "Synced Sep 26, 6:17 PM", or `''` (see `syncTime`). */
export function syncedLabel(iso: string, date: string): string {
  const t = syncTime(iso, date);
  return t ? `Synced ${t}` : '';
}
