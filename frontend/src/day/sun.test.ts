// #237 AC2 — the sun line, checked against almanac's prototype output.
import { describe, it, expect } from 'vitest';
import { sunLine, tzOffset, changeText, clock12, hoursMinutes } from './sun';

describe('sunLine (AC2)', () => {
  it.each([
    ['2026-06-21', '5:32 AM', '8:31 PM', '14h 59m', '(no change)'],
    ['2026-09-27', '6:51 AM', '6:51 PM', '12h 00m', '(−3 min)'],
    ['2026-12-21', '7:17 AM', '4:38 PM', '9h 21m', '(no change)'],
    ['2026-03-08', '7:24 AM', '6:58 PM', '11h 34m', '(+3 min)'],
    ['2026-11-01', '6:28 AM', '5:00 PM', '10h 32m', '(−2 min)'],
  ])('%s → %s, %s, %s %s', (date, sunrise, sunset, daylight, change) => {
    expect(sunLine(date)).toEqual({ sunrise, sunset, daylight, change });
  });
});

describe('tzOffset', () => {
  it("uses each date's own Denver offset", () => {
    expect(tzOffset('2026-03-07')).toBe(-420);
    expect(tzOffset('2026-03-08')).toBe(-360);
    expect(tzOffset('2026-10-31')).toBe(-360);
    expect(tzOffset('2026-11-01')).toBe(-420);
  });
});

describe('formatting', () => {
  it('writes clock times, daylight and the change', () => {
    expect(clock12(0)).toBe('12:00 AM');
    expect(clock12(720)).toBe('12:00 PM');
    expect(clock12(410.6)).toBe('6:51 AM');
    expect(hoursMinutes(720)).toBe('12h 00m');
    expect(hoursMinutes(561)).toBe('9h 21m');
    expect(changeText(0)).toBe('(no change)');
    expect(changeText(3)).toBe('(+3 min)');
    expect(changeText(-2)).toBe('(−2 min)');
  });
});
