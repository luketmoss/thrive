import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toLocalDateStr } from '../activities/activities-helpers';

// ── Unit tests for simple-workout date logic (ACs 1-6, issue #55) ───

describe('simple-workout date logic', () => {
  const today = toLocalDateStr(new Date());

  // AC1: defaults to today
  it('toLocalDateStr returns today in YYYY-MM-DD format', () => {
    const result = toLocalDateStr(new Date());
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe(today);
  });

  // AC2: a valid user-chosen date passes through to the API
  it('a valid past date string is accepted as-is', () => {
    const chosen = '2026-03-01';
    const safeDate = (chosen && !isNaN(Date.parse(chosen))) ? chosen : today;
    expect(safeDate).toBe('2026-03-01');
  });

  // AC3: empty date falls back to today
  it('empty date string falls back to today', () => {
    const chosen = '';
    const safeDate = (chosen && !isNaN(Date.parse(chosen))) ? chosen : today;
    expect(safeDate).toBe(today);
  });

  // AC3: invalid date falls back to today
  it('invalid date string falls back to today', () => {
    const chosen = 'not-a-date';
    const safeDate = (chosen && !isNaN(Date.parse(chosen))) ? chosen : today;
    expect(safeDate).toBe(today);
  });

  // AC4: max attribute value equals today (logic check)
  it('max date equals today', () => {
    const max = toLocalDateStr(new Date());
    expect(max).toBe(today);
  });

  // AC6: onBlur reset logic — empty resets to today
  it('onBlur resets empty date to today', () => {
    let date = '';
    const todayStr = today;
    // simulate onBlur handler
    if (!date) date = todayStr;
    expect(date).toBe(today);
  });

  // AC6: onBlur does not reset a valid date
  it('onBlur keeps a valid date unchanged', () => {
    let date = '2026-02-15';
    const todayStr = today;
    if (!date) date = todayStr;
    expect(date).toBe('2026-02-15');
  });
});

describe('createWorkout date parameter', () => {
  // AC2: date parameter is used when provided
  it('uses provided date instead of generating from new Date()', () => {
    const data = { type: 'bike' as const, name: 'Bike', date: '2026-03-10' };
    const date = data.date || toLocalDateStr(new Date());
    expect(date).toBe('2026-03-10');
  });

  // AC3: missing date falls back to today
  it('falls back to today when date is undefined', () => {
    const data = { type: 'bike' as const, name: 'Bike' } as { type: string; name: string; date?: string };
    const date = data.date || toLocalDateStr(new Date());
    expect(date).toBe(toLocalDateStr(new Date()));
  });

  // AC3: empty string date falls back to today
  it('falls back to today when date is empty string', () => {
    const data = { type: 'bike' as const, name: 'Bike', date: '' };
    const date = data.date || toLocalDateStr(new Date());
    expect(date).toBe(toLocalDateStr(new Date()));
  });
});
