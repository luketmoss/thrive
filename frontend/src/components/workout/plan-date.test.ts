// #143 AC2: which `?plan=` values reach the planner.
import { describe, it, expect } from 'vitest';
import { validPlanDate } from './plan-date';

describe('validPlanDate', () => {
  it('passes a real YYYY-MM-DD through as the same string', () => {
    expect(validPlanDate('2026-09-24')).toBe('2026-09-24');
    expect(validPlanDate('2028-02-29')).toBe('2028-02-29'); // leap year
    expect(validPlanDate('2000-02-29')).toBe('2000-02-29'); // 400-year leap
    expect(validPlanDate('2026-12-31')).toBe('2026-12-31');
  });

  it('accepts a past date — the planner already does', () => {
    expect(validPlanDate('2020-01-15')).toBe('2020-01-15');
  });

  it.each([
    [undefined],
    [''],
    ['tomorrow'],
    ['2026-9-4'],
    ['2026-09-4'],
    ['26-09-24'],
    ['2026-02-30'],
    ['2026-02-29'], // not a leap year
    ['1900-02-29'], // century, not a leap year
    ['2026-04-31'],
    ['2026-13-01'],
    ['2026-00-10'],
    ['2026-09-00'],
    ['0000-01-01'],
    ['2026-09-24T00:00'],
    [' 2026-09-24'],
    ['2026/09/24'],
  ])('rejects %j', (raw) => {
    expect(validPlanDate(raw)).toBeUndefined();
  });
});
