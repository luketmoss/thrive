// #130 AC4 — planned workouts are queryable by local calendar date, matched
// against Workouts!B rather than derived from a timestamp.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow } from './apps-script-sandbox';

const ROWS = () => [
  workoutRow({ id: 'w_planned_1', date: '2026-09-21', status: 'planned', name: 'Upper Pull A' }),
  workoutRow({ id: 'w_planned_2', date: '2026-09-21', status: 'planned', name: 'Evening Ride', type: 'bike' }),
  workoutRow({ id: 'w_planned_3', date: '2026-09-22', status: 'planned', name: 'Lower A' }),
  workoutRow({ id: 'w_done', date: '2026-09-21', status: '', name: 'Already Logged' }),
  workoutRow({ id: 'w_active', date: '2026-09-21', status: 'active', name: 'In Progress' }),
];

describe('AC4: only that date, and only planned', () => {
  it('returns the planned workouts for the date asked for', () => {
    const { sandbox } = loadApi(ROWS());
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' });
    expect(res.success).toBe(true);
    expect(res.data.map((w) => w.id)).toEqual(['w_planned_1', 'w_planned_2']);
  });

  it('excludes other dates', () => {
    const { sandbox } = loadApi(ROWS());
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-22' });
    expect(res.data.map((w) => w.id)).toEqual(['w_planned_3']);
  });

  it('excludes completed and in-progress workouts on the same date', () => {
    const { sandbox } = loadApi(ROWS());
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' });
    const ids = res.data.map((w) => w.id);
    expect(ids).not.toContain('w_done');
    expect(ids).not.toContain('w_active');
  });

  it('returns the full A:Z shape, not a summary', () => {
    const { sandbox } = loadApi(ROWS());
    const [w] = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' }).data;
    for (const f of sandbox.WORKOUT_FIELDS) expect(w, f).toHaveProperty(f);
  });
});

describe('AC4: an empty day is a normal answer', () => {
  it('returns an empty list, not an error', () => {
    const { sandbox } = loadApi(ROWS());
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-12-25' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('returns an empty list for an empty tab', () => {
    const { sandbox } = loadApi([]);
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });
});

describe('AC4: the date comes from Workouts!B, never from a timestamp', () => {
  // A 7pm workout has a `created` and a `started_at_utc` on the *next* UTC
  // day. Slicing either would file it under tomorrow; column B already holds
  // the local calendar date and is the only correct source.
  it('files a 7pm workout under its local date, not its UTC one', () => {
    const { sandbox } = loadApi([
      workoutRow({
        id: 'w_evening',
        date: '2026-09-21',
        time: '19:30',
        status: 'planned',
        created: '2026-09-22T01:30:00.000Z',
        started_at_utc: '2026-09-21T19:30:00-06:00',
      }),
    ]);
    expect(callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' }).data)
      .toHaveLength(1);
    expect(callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-22' }).data)
      .toHaveLength(0);
  });

  it('ignores a row whose B is blank rather than inventing one', () => {
    const { sandbox } = loadApi([
      workoutRow({ id: 'w_nodate', date: '', status: 'planned', created: '2026-09-21T12:00:00.000Z' }),
    ]);
    expect(callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-09-21' }).data)
      .toHaveLength(0);
  });

  it('rejects a malformed date rather than matching nothing silently', () => {
    const { sandbox } = loadApi(ROWS());
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '21/09/2026' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Expected YYYY-MM-DD/);
  });
});

describe('AC4: today defaults to the local calendar day', () => {
  it('uses America/Denver, so a late-evening call still means today', () => {
    // 01:30Z on the 22nd is 19:30 on the 21st in Denver.
    const { sandbox } = loadApi(ROWS(), { now: new Date('2026-09-22T01:30:00Z') });
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts' });
    expect(res.data.map((w) => w.id)).toEqual(['w_planned_1', 'w_planned_2']);
  });

  it('resolves the zone at the date asked about, so DST is not assumed', () => {
    // Midday in summer (MDT, -06:00) and in winter (MST, -07:00).
    const summer = loadApi([workoutRow({ id: 'w_s', date: '2026-07-15', status: 'planned' })],
      { now: new Date('2026-07-15T18:00:00Z') });
    expect(callDoGet(summer.sandbox, { action: 'getPlannedWorkouts' }).data).toHaveLength(1);

    const winter = loadApi([workoutRow({ id: 'w_w', date: '2026-01-15', status: 'planned' })],
      { now: new Date('2026-01-15T19:00:00Z') });
    expect(callDoGet(winter.sandbox, { action: 'getPlannedWorkouts' }).data).toHaveLength(1);
  });
});
