// #237 AC1, AC2, AC3 — the Day screen's pure date rules.
import { describe, it, expect } from 'vitest';
import { todayInDenver, dayStateOf, dayHref, relativeLabel, weekOf, addDays, daysBetween } from './dates';

describe('todayInDenver (AC1)', () => {
  it('is the Denver date, whatever the instant says in UTC', () => {
    // 03:00 UTC on 1 Oct is 21:00 on 30 Sep in Denver (MDT, −6)
    expect(todayInDenver(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09-30');
    // 07:30 UTC on 15 Jan is 00:30 in Denver (MST, −7)
    expect(todayInDenver(new Date('2026-01-15T07:30:00Z'))).toBe('2026-01-15');
    expect(todayInDenver(new Date('2026-01-15T06:59:00Z'))).toBe('2026-01-14');
  });

  it('defaults to now', () => {
    expect(todayInDenver()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dayStateOf (AC1)', () => {
  it('is past, today or future', () => {
    expect(dayStateOf('2026-09-29', '2026-09-30')).toBe('past');
    expect(dayStateOf('2026-09-30', '2026-09-30')).toBe('today');
    expect(dayStateOf('2026-10-01', '2026-09-30')).toBe('future');
    expect(dayStateOf('2025-12-31', '2026-01-01')).toBe('past');
  });
});

describe('dayHref (AC1)', () => {
  it('is #/ for today and #/day/YYYY-MM-DD otherwise', () => {
    expect(dayHref('2026-09-30', '2026-09-30')).toBe('#/');
    expect(dayHref('2026-09-12', '2026-09-30')).toBe('#/day/2026-09-12');
    expect(dayHref('2026-10-12', '2026-09-30')).toBe('#/day/2026-10-12');
  });
});

describe('addDays / daysBetween', () => {
  it('crosses month, year and DST boundaries by whole days', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-09-30', '2026-09-20')).toBe(-10);
  });
});

describe('relativeLabel (AC2)', () => {
  const today = '2026-09-30';
  const at = (n: number) => relativeLabel(addDays(today, n), today);
  it.each([
    [0, 'Today'],
    [-1, 'Yesterday'],
    [1, 'Tomorrow'],
    [-2, '2 days ago'],
    [2, 'In 2 days'],
    [-13, '13 days ago'],
    [13, 'In 13 days'],
    [-14, '2 weeks ago'],
    [14, 'In 2 weeks'],
    [-17, '2 weeks ago'],
    [18, 'In 3 weeks'],
    [-59, '8 weeks ago'],
    [-60, '2 months ago'],
    [60, 'In 2 months'],
    [-365, '12 months ago'],
    [-800, '26 months ago'],
  ])('%i days → %s', (n, label) => {
    expect(at(n)).toBe(label);
  });
});

describe('weekOf (AC3)', () => {
  it('is Monday to Sunday around the date', () => {
    expect(weekOf('2026-09-30')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(weekOf('2026-09-28')[0]).toBe('2026-09-28');
    expect(weekOf('2026-10-04')[0]).toBe('2026-09-28');
  });

  it('crosses a year end', () => {
    expect(weekOf('2027-01-01')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });
});
