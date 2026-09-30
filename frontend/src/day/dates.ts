// #237 — the Day screen's date rules. Pure: no signals, no DOM.
//
// Every date here is a `YYYY-MM-DD` string naming a calendar day in
// America/Denver. Arithmetic is done on UTC day numbers, never through
// `new Date(s + 'T00:00')`, which would shift across a DST change.

export type DayState = 'past' | 'today' | 'future';

export const DENVER = 'America/Denver';

const MS_PER_DAY = 86_400_000;

const denverParts = new Intl.DateTimeFormat('en-US', {
  timeZone: DENVER,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The current date in America/Denver, whatever the device's time zone. */
export function todayInDenver(now: Date = new Date()): string {
  const parts = denverParts.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Days since 1970-01-01 for a `YYYY-MM-DD` date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** `date` moved by `days` whole days (negative goes back). */
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The one rule for a day's state, used by the screen and every panel. */
export function dayStateOf(date: string, today: string): DayState {
  if (date === today) return 'today';
  return date < today ? 'past' : 'future';
}

/** Every link to a day: `#/` for today, `#/day/YYYY-MM-DD` otherwise. */
export function dayHref(date: string, today: string): string {
  return date === today ? '#/' : `#/day/${date}`;
}

/**
 * The relative pill: Today · Yesterday · Tomorrow · days (2–13) · weeks,
 * N÷7 rounded (14–59) · months, N÷30.4 rounded (60+). Plural from 2 up;
 * nothing turns into years.
 */
export function relativeLabel(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  const abs = Math.abs(n);
  let count: number;
  let unit: string;
  if (abs < 14) {
    count = abs;
    unit = 'days';
  } else if (abs < 60) {
    count = Math.round(abs / 7);
    unit = 'weeks';
  } else {
    count = Math.round(abs / 30.4);
    unit = 'months';
  }
  return n < 0 ? `${count} ${unit} ago` : `In ${count} ${unit}`;
}

/** The Monday–Sunday week containing `date`, Monday first. */
export function weekOf(date: string): string[] {
  // 1970-01-01 was a Thursday, so day number 4 is a Monday.
  const sinceMonday = (((dayNumber(date) - 4) % 7) + 7) % 7;
  const monday = addDays(date, -sinceMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
