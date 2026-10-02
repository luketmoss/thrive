// #250 — demo workouts are dated relative to today (Denver), shifted once per
// page load at the fetchWorkouts read boundary. The raw fixture never changes.

import { describe, it, expect, vi } from 'vitest';
import { addDays, dayNumber, todayInDenver } from '../day/dates';
import { DEMO_WORKOUTS, DEMO_ANCHOR_DATE, shiftDemoWorkouts, addDaysToIso } from './demo-data';

vi.mock('./sheets', () => ({
  sheetsGet: vi.fn(), sheetsAppend: vi.fn(), sheetsUpdate: vi.fn(), sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(), withReauth: (_t: string, fn: (t: string) => unknown) => fn('t'),
}));

// Noon UTC is the same Denver calendar day in both MST and MDT.
const at = (ymd: string) => new Date(`${ymd}T19:00:00.000Z`);

describe('AC1: shiftDemoWorkouts', () => {
  it('lands the anchor day on today in Denver', () => {
    const out = shiftDemoWorkouts(at('2026-09-30'));
    expect(out.find((w) => w.id === 'w_demo001')!.date).toBe('2026-09-30');
    expect(out.find((w) => w.id === 'w_demo005')!.date).toBe('2026-09-30');
  });

  it('uses the Denver date, not UTC, near midnight', () => {
    // 03:00 UTC on the 1st is still the evening of Sep 30 in Denver (MDT).
    expect(todayInDenver(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09-30');
    expect(shiftDemoWorkouts(new Date('2026-10-01T03:00:00Z')).find((w) => w.id === 'w_demo001')!.date).toBe('2026-09-30');
  });

  it('is the identity when now is the anchor day', () => {
    expect(shiftDemoWorkouts(at(DEMO_ANCHOR_DATE))).toEqual(DEMO_WORKOUTS);
  });

  it('crosses a year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    const out = shiftDemoWorkouts(at('2026-01-02'));
    expect(out.find((w) => w.id === 'w_demo004')!.date).toBe('2025-12-26');
  });

  it('crosses a DST boundary without an off-by-one', () => {
    // US spring forward: 2026-03-08. Delta spans it; dates stay whole days apart.
    const out = shiftDemoWorkouts(at('2026-03-09'));
    expect(out.find((w) => w.id === 'w_demo001')!.date).toBe('2026-03-09');
    expect(out.find((w) => w.id === 'w_demo004')!.date).toBe('2026-03-02');
    // fall back: 2026-11-01
    const out2 = shiftDemoWorkouts(at('2026-11-02'));
    expect(out2.find((w) => w.id === 'w_demo001')!.date).toBe('2026-11-02');
    expect(out2.find((w) => w.id === 'w_demo004')!.date).toBe('2026-10-26');
  });

  it('shifts ISO timestamps by the same days, preserving time of day; blank stays blank', () => {
    const out = shiftDemoWorkouts(at('2025-01-24')); // +10 days
    const w8 = out.find((w) => w.id === 'w_demo008')!;
    expect(w8.started_at_utc).toBe('2025-01-19T16:10:00.000Z');
    expect(w8.synced_at).toBe('2025-01-19T18:00:00.000Z');
    expect(w8.created).toBe('2025-01-19T16:00:00.000Z');
    expect(w8.fit_fetched_at).toBe('');
    expect(out.find((w) => w.id === 'w_demo001')!.started_at_utc).toBe('');
  });

  it('leaves every non-date field untouched', () => {
    const out = shiftDemoWorkouts(at('2026-09-30'));
    const strip = (w: typeof DEMO_WORKOUTS[number]) => {
      const { date, created, synced_at, started_at_utc, fit_fetched_at, ...rest } = w;
      return rest;
    };
    expect(out.map(strip)).toEqual(DEMO_WORKOUTS.map(strip));
  });

  it('never mutates the fixture and is deterministic', () => {
    const before = JSON.parse(JSON.stringify(DEMO_WORKOUTS));
    const a = shiftDemoWorkouts(at('2026-09-30'));
    const b = shiftDemoWorkouts(at('2026-09-30'));
    expect(a).toEqual(b);
    expect(a).not.toBe(DEMO_WORKOUTS);
    expect(DEMO_WORKOUTS).toEqual(before);
  });
});

describe('AC3: relative order and status survive the shift', () => {
  it('keeps every pairwise date ordering and the status values', () => {
    const out = shiftDemoWorkouts(at('2026-09-30'));
    for (let i = 0; i < out.length; i++) {
      expect(out[i].status).toBe(DEMO_WORKOUTS[i].status);
      for (let j = 0; j < out.length; j++) {
        expect(Math.sign(out[i].date.localeCompare(out[j].date)))
          .toBe(Math.sign(DEMO_WORKOUTS[i].date.localeCompare(DEMO_WORKOUTS[j].date)));
      }
    }
    expect(Math.max(...out.map((w) => Date.parse(w.date)))).toBe(Date.parse('2026-09-30'));
  });
});

describe('AC2: fetchWorkouts shifts exactly once per page load', () => {
  it('returns the same shifted dates on every call, even after the clock moves on', async () => {
    vi.resetModules();
    vi.doMock('./demo-data', async (orig) => ({ ...(await orig<typeof import('./demo-data')>()), isDemo: () => true }));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at('2026-09-30'));
      const { fetchWorkouts } = await import('./workouts-api');
      const first = await fetchWorkouts('t');
      vi.setSystemTime(at('2026-10-02'));
      const second = await fetchWorkouts('t');
      expect(second).toEqual(first);
      expect(first.find((w) => w.id === 'w_demo001')!.date).toBe('2026-09-30');
    } finally {
      vi.useRealTimers();
      vi.doUnmock('./demo-data');
    }
  });
});

// #304 — the private copies this file's neighbour used to keep, retained here
// as the reference the one implementation in day/dates.ts must match.
describe('#304 AC2: day/dates.ts matches the removed demo-data copies', () => {
  const MS = 86_400_000;
  const oldDayNumber = (ymd: string): number => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS;
  };
  const oldAddDays = (ymd: string, days: number): string =>
    new Date((oldDayNumber(ymd) + days) * MS).toISOString().slice(0, 10);

  it('agrees for every day from 1970-01-01 to 2100-12-31', () => {
    const start = Date.UTC(1970, 0, 1) / MS;
    const end = Date.UTC(2100, 11, 31) / MS;
    for (let n = start; n <= end; n++) {
      const ymd = new Date(n * MS).toISOString().slice(0, 10);
      if (dayNumber(ymd) !== oldDayNumber(ymd)) throw new Error(`dayNumber differs on ${ymd}`);
      for (const k of [-30, -1, 0, 1, 45]) {
        if (addDays(ymd, k) !== oldAddDays(ymd, k)) throw new Error(`addDays differs on ${ymd} ${k}`);
      }
    }
  });
});

describe('#304 AC3: addDaysToIso shifts an instant, not a date', () => {
  it('moves a valid instant by whole days, keeping time-of-day', () => {
    expect(addDaysToIso('2025-01-14T12:17:04.000Z', 3)).toBe('2025-01-17T12:17:04.000Z');
    expect(addDaysToIso('2025-01-14T12:17:04.000Z', -14)).toBe('2024-12-31T12:17:04.000Z');
  });
  it('leaves a blank string blank', () => {
    expect(addDaysToIso('', 5)).toBe('');
  });
  it('returns an unparseable string unchanged', () => {
    expect(addDaysToIso('not a date', 5)).toBe('not a date');
  });
});
