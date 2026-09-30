// #237 AC2, AC3, AC4 — dates in words.
import { describe, it, expect } from 'vitest';
import {
  weekdayName, weekdayLetter, dayOfMonth, fullDate, weekdayFullDate, stripDayLabel, moveAnnouncement,
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
