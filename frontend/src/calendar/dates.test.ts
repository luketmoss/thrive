// #241 AC1 — the Calendar's month vocabulary.
import { describe, it, expect } from 'vitest';
import { addMonths, calendarHref, gridRange, isIsoMonth, monthOf, monthTitle, parseCalendarPath } from './dates';

const TODAY = '2026-09-30';

describe('isIsoMonth', () => {
  it.each(['2026-09', '2026-01', '2026-12', '0999-05'])('accepts %s', (m) => expect(isIsoMonth(m)).toBe(true));
  it.each(['2026-13', '2026-00', '2026-7', '2026-9', 'foo', '2026-09/x', '2026-09-01', '26-09', ''])(
    'rejects %s',
    (m) => expect(isIsoMonth(m)).toBe(false),
  );
});

describe('monthOf / addMonths / monthTitle', () => {
  it('takes the month of a date', () => expect(monthOf('2026-09-12')).toBe('2026-09'));
  it('moves across a year end both ways', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-09', -21)).toBe('2024-12');
  });
  it('writes the month in words', () => expect(monthTitle('2026-09')).toBe('September 2026'));
});

describe('calendarHref', () => {
  it("is #/calendar for today's month", () => expect(calendarHref('2026-09', TODAY)).toBe('#/calendar'));
  it('names any other month', () => expect(calendarHref('2025-01', TODAY)).toBe('#/calendar/2025-01'));
});

describe('parseCalendarPath', () => {
  it("shows today's month with no param", () => expect(parseCalendarPath(undefined, TODAY)).toEqual({ month: '2026-09', valid: true }));
  it('shows a real month, today\'s included', () => {
    expect(parseCalendarPath('2025-01', TODAY)).toEqual({ month: '2025-01', valid: true });
    expect(parseCalendarPath('2026-09', TODAY)).toEqual({ month: '2026-09', valid: true });
  });
  it.each(['2026-13', '2026-7', 'foo', '2026-09/x'])("shows today's month for %s, flagged", (p) => {
    expect(parseCalendarPath(p, TODAY)).toEqual({ month: '2026-09', valid: false });
  });
});

describe('gridRange', () => {
  it('runs Monday of the 1st week to Sunday of the last: September 2026 is 35 days', () => {
    const g = gridRange('2026-09');
    expect(g.start).toBe('2026-08-31');
    expect(g.end).toBe('2026-10-04');
    expect(g.days).toHaveLength(35);
    expect(g.days[0]).toBe(g.start);
    expect(g.days[34]).toBe(g.end);
  });
  it('is 28 days for a February starting on a Monday', () => {
    expect(gridRange('2027-02').days).toHaveLength(28); // 1 Feb 2027 is a Monday
  });
  it('is 42 days for a month spanning six weeks', () => {
    const g = gridRange('2026-03'); // 1 Mar 2026 is a Sunday, 31 days
    expect(g.days).toHaveLength(42);
    expect(g.start).toBe('2026-02-23');
    expect(g.end).toBe('2026-04-05');
  });
  it('crosses a year end and a leap day', () => {
    expect(gridRange('2027-01').start).toBe('2026-12-28');
    expect(gridRange('2028-02').days).toContain('2028-02-29');
  });
});
