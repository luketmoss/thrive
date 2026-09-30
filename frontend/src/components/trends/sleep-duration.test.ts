// #243 AC2 — the sleep duration formatter.
import { describe, it, expect } from 'vitest';
import { formatSleep, axisSleep } from './sleep-duration';

describe('formatSleep', () => {
  it('prints hours and minutes, dropping the hour under one', () => {
    expect(formatSleep(7 + 32 / 60)).toBe('7h 32m');
    expect(formatSleep(45 / 60)).toBe('45m');
    expect(formatSleep(8)).toBe('8h 0m');
    expect(formatSleep(0)).toBe('0m');
    expect(formatSleep(27120 / 3600)).toBe('7h 32m');
  });
  it('never prints 60m', () => {
    expect(formatSleep(7.999)).toBe('8h 0m');
  });
});

describe('axisSleep', () => {
  it('rounds gridlines to whole hours, never minutes', () => {
    expect(axisSleep(6)).toBe('6h');
    expect(axisSleep(8)).toBe('8h');
    expect(axisSleep(7.0000001)).toBe('7h');
  });
  it('keeps a half-hour step distinct', () => {
    expect(axisSleep(6.5)).toBe('6.5h');
  });
});
