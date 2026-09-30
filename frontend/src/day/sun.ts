// #237 — sunrise, sunset and daylight for Denver, calculated on the device.
//
// Ported from almanac's prototype (`luketmoss/keel`, almanac/docs/prototype.html,
// `sun()` and `tzOffset()`): the NOAA approximation at 39.7392, −104.9903 with
// the 90.833° zenith, in the date's own Denver UTC offset so DST days show
// their own clock times. No request, so it works in demo mode and offline.

import { DENVER, addDays } from './dates';

const LAT = 39.7392;
const LON = -104.9903;
const ZENITH = 90.833;

const denverHour = new Intl.DateTimeFormat('en-US', {
  timeZone: DENVER,
  hour: '2-digit',
  hourCycle: 'h23',
});

function utcNoon(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

/** Denver's offset from UTC on `date`, in minutes (−360 in summer, −420 in winter). */
export function tzOffset(date: string): number {
  const at = new Date(utcNoon(date));
  at.setUTCHours(18, 0, 0, 0);
  const hour = Number(denverHour.formatToParts(at).find((p) => p.type === 'hour')!.value);
  return (hour - 18) * 60;
}

export interface SunTimes {
  /** Minutes after local midnight. */
  rise: number;
  set: number;
  /** Minutes of daylight. */
  len: number;
}

export function sun(date: string): SunTimes {
  const noon = utcNoon(date);
  const year = new Date(noon).getUTCFullYear();
  const doy = Math.round((noon - Date.UTC(year, 0, 1, 12)) / 864e5) + 1;
  const g = ((2 * Math.PI) / 365) * (doy - 1);
  const eq =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const lat = (LAT * Math.PI) / 180;
  const ha =
    (Math.acos(Math.cos((ZENITH * Math.PI) / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) * 180) /
    Math.PI;
  const off = tzOffset(date);
  const rise = 720 - 4 * (LON + ha) - eq + off;
  const set = 720 - 4 * (LON - ha) - eq + off;
  return { rise, set, len: set - rise };
}

/** 12-hour clock, rounded to the minute: "6:51 AM". */
export function clock12(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${ap}`;
}

/** Whole minutes as "Hh MMm": "12h 00m". */
export function hoursMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "(+3 min)", "(−2 min)" with a true minus sign, or "(no change)". */
export function changeText(delta: number): string {
  if (delta === 0) return '(no change)';
  return delta > 0 ? `(+${delta} min)` : `(−${-delta} min)`;
}

export interface SunLine {
  sunrise: string;
  sunset: string;
  daylight: string;
  change: string;
}

/**
 * The header's sun line for `date`. The change is that day's daylight minus
 * the day before's, each rounded to the minute first.
 */
export function sunLine(date: string): SunLine {
  const today = sun(date);
  const len = Math.round(today.len);
  const before = Math.round(sun(addDays(date, -1)).len);
  return {
    sunrise: clock12(today.rise),
    sunset: clock12(today.set),
    daylight: hoursMinutes(len),
    change: changeText(len - before),
  };
}
