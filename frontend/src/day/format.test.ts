// #237 AC2, AC3, AC4 — dates in words.
import { describe, it, expect } from 'vitest';
import {
  weekdayName, weekdayLetter, dayOfMonth, fullDate, weekdayFullDate, stripDayLabel, moveAnnouncement,
  hoursMinutes, clock12, nightOf, syncedLabel,
} from './format';

describe('format', () => {
  it('names the date without the device time zone moving it', () => {
    expect(weekdayName('2026-09-12')).toBe('Saturday');
    expect(weekdayLetter('2026-09-28')).toBe('M');
    expect(dayOfMonth('2026-09-05')).toBe('5');
    expect(fullDate('2026-09-12')).toBe('September 12, 2026');
    expect(weekdayFullDate('2027-01-01')).toBe('Friday, January 1, 2027');
  });

  it('labels a strip day with its non-zero counts (AC3)', () => {
    expect(stripDayLabel('2025-01-14', 1, 1)).toBe('Tuesday, January 14 — 1 workout done, 1 planned');
    expect(stripDayLabel('2025-01-14', 0, 0)).toBe('Tuesday, January 14');
    expect(stripDayLabel('2025-01-14', 4, 0)).toBe('Tuesday, January 14 — 4 workouts done');
    expect(stripDayLabel('2025-01-14', 0, 2)).toBe('Tuesday, January 14 — 2 workouts planned');
    expect(stripDayLabel('2025-01-14', 0, 1)).toBe('Tuesday, January 14 — 1 workout planned');
  });

  it('announces a move with the whole date and the pill (AC4)', () => {
    expect(moveAnnouncement('2026-09-12', '2026-09-22')).toBe('Saturday, September 12, 2026, 10 days ago');
    expect(moveAnnouncement('2026-09-22', '2026-09-22')).toBe('Tuesday, September 22, 2026, Today');
  });
});

// #239 — the Health and Body panels' durations, clocks and sync time.
describe('health formatting (#239)', () => {
  it('writes durations as Hh MMm, rounded to the minute', () => {
    expect(hoursMinutes(7 * 3600 + 12 * 60)).toBe('7h 12m');
    expect(hoursMinutes(12 * 60 + 29)).toBe('0h 12m');
    expect(hoursMinutes(3600 * 7 + 59 * 60 + 31)).toBe('8h 00m');
    expect(hoursMinutes(0)).toBe('0h 00m');
    expect(hoursMinutes(null)).toBe('');
  });

  it('writes local clock times in 12-hour form', () => {
    expect(clock12('23:24')).toBe('11:24 PM');
    expect(clock12('06:12')).toBe('6:12 AM');
    expect(clock12('00:05')).toBe('12:05 AM');
    expect(clock12('12:00:30')).toBe('12:00 PM');
    expect(clock12('')).toBe('');
    expect(clock12('nope')).toBe('');
  });

  it('names the night before a wake-up day', () => {
    expect(nightOf('2026-09-26', false)).toBe('Fri night'); // a Saturday
    expect(nightOf('2026-09-30', true)).toBe('last night');
  });

  it('says when the sync ran, in Denver, with the date when it was an earlier day', () => {
    expect(syncedLabel('2026-09-30T13:17:04.000Z', '2026-09-30')).toBe('Synced 7:17 AM');
    expect(syncedLabel('2026-09-27T00:17:00.000Z', '2026-09-30')).toBe('Synced Sep 26, 6:17 PM');
    expect(syncedLabel('', '2026-09-30')).toBe('');
    expect(syncedLabel('not a date', '2026-09-30')).toBe('');
  });
});
