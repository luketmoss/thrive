/**
 * The `?plan=` date on `#/workout/new` (#143), as almanac sends it.
 *
 * Returns the value unchanged when it is a strict `YYYY-MM-DD` naming a real
 * calendar date, otherwise `undefined` so the planner falls back to today.
 * The string is never parsed through `Date`: it is a local date, the same kind
 * `Workouts!B` holds, and a UTC round trip could shift it by a day.
 */
export function validPlanDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;
  return day <= daysInMonth(year, month) ? raw : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
