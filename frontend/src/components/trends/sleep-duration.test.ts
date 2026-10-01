// #243 AC2 — the sleep duration formatter.
import { describe, it, expect } from 'vitest';
import { formatSleep, axisSleep } from './sleep-duration';
import { addDays } from '../../day/dates';
import { yDomain, niceTicks, rolling } from './series';

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

describe('axisSleep on narrow ranges', () => {
  const spreads = [[1.2, 1.25], [0.9, 1.05], [1.5, 1.52], [7, 7 + 1 / 60], [0, 1 / 60], [5 / 60, 6 / 60], [7.5, 7.5 + 20 / 3600]];
  it.each(spreads.map((v) => [v]))('gives every gridline its own label for %j', (values) => {
    const { ticks } = yDomain(values, null);
    const labels = ticks.map((t) => axisSleep(t, ticks));
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('uses whole hours for hour steps and minutes for fine steps', () => {
    expect(axisSleep(7, [6, 7, 8, 9])).toBe('7h');
    expect(axisSleep(6.5, [6, 6.5, 7])).toBe('6.5h');
    expect(axisSleep(7.25, [7, 7.25, 7.5])).toBe('7h 15m');
  });
});

describe('flat series that average to floating-point noise (#243 review)', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => addDays('2026-09-01', i));

  it('a constant 45.3 VO2max with a 7-day average terminates with a sane domain', () => {
    const dates = days(30);
    const avg = rolling(new Map(dates.map((d) => [d, 45.3])), dates, 7);
    const values = [...dates.map(() => 45.3), ...avg.values()];
    const { ticks, min, max } = yDomain(values, null);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(min).toBeLessThan(45.3);
    expect(max).toBeGreaterThan(45.3);
  });

  it('tied sleep durations do the same, with distinct labels', () => {
    const dates = days(30);
    const hours = 27120 / 3600;
    const avg = rolling(new Map(dates.map((d) => [d, hours])), dates, 7);
    const { ticks } = yDomain([...dates.map(() => hours), ...avg.values()], null);
    expect(ticks.length).toBeLessThanOrEqual(12);
    const labels = ticks.map((t) => axisSleep(t, ticks));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('niceTicks refuses a step that cannot advance', () => {
    expect(niceTicks(45.3, 45.3 + 7e-15).length).toBeLessThanOrEqual(12);
    expect(niceTicks(1e16, 1e16 + 2).length).toBeLessThanOrEqual(101);
  });

  it.each([
    [[0, 1 / 60]], [[5 / 60, 6 / 60]], [[7, 7 + 1 / 60]], [[7.5, 7.5 + 0.0000001]], [[6.3, 6.3 + 3e-15]],
  ])('keeps every gridline label distinct for %j', (values) => {
    const { ticks } = yDomain(values, null);
    const labels = ticks.map((t) => axisSleep(t, ticks));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
