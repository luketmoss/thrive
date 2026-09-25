// #130 AC4 — planned workouts are queryable by local calendar date, matched
// against Workouts!B rather than derived from a timestamp.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, setRow, workoutRow, type Fixtures, type Sandbox } from './apps-script-sandbox';

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

  it('returns the full A:AA shape, not a summary', () => {
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

// #146 — each planned workout carries its non-warmup exercise and set counts,
// counted server-side from one read of the Sets tab.

const PLAN_DATE = '2026-09-26';

/** A strength plan: 2 warmup slots, then 5 working slots totalling 20 sets. */
function strengthSets(workoutId: string) {
  const rows = [
    setRow({ workout_id: workoutId, exercise_id: 'ex_pushup', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '' }),
    setRow({ workout_id: workoutId, exercise_id: 'ex_bench', section: 'warmup', exercise_order: 2, set_number: 1, planned_reps: '' }),
  ];
  const working: [string, string, number, number][] = [
    ['ex_bench', 'primary', 3, 5],
    ['ex_row', 'SS1', 4, 4],
    ['ex_fly', 'SS1', 5, 4],
    ['ex_curl', 'burnout', 6, 4],
    ['ex_stretch', 'cooldown', 7, 3],
  ];
  for (const [exercise_id, section, exercise_order, sets] of working) {
    for (let n = 1; n <= sets; n++) {
      rows.push(setRow({ workout_id: workoutId, exercise_id, section, exercise_order, set_number: n }));
    }
  }
  return rows;
}

function planned(overrides: Record<string, string> = {}) {
  return workoutRow({ date: PLAN_DATE, status: 'planned', ...overrides });
}

function plannedOn(fixtures: Fixtures) {
  const loaded = loadApi(fixtures);
  const res = callDoGet(loaded.sandbox, { action: 'getPlannedWorkouts', date: PLAN_DATE });
  expect(res.success).toBe(true);
  return { ...loaded, data: res.data as Record<string, unknown>[] };
}

describe('#146 AC1: counts come back on every planned workout', () => {
  it('reports exercise_count and set_count as numbers', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_upper', name: 'Upper Push A' })],
      sets: strengthSets('w_upper'),
    });
    expect(data[0].exercise_count).toBe(5);
    expect(data[0].set_count).toBe(20);
  });

  it('adds the two fields and changes nothing else', () => {
    const fixtures = (): Fixtures => ({
      workouts: [planned({ id: 'w_upper', name: 'Upper Push A', notes: 'Go easy' })],
      sets: strengthSets('w_upper'),
    });
    const { data } = plannedOn(fixtures());
    const { sandbox } = loadApi(fixtures());
    const [before] = callDoGet(sandbox, { action: 'getWorkouts', date: PLAN_DATE }).data;
    const { exercise_count: _e, set_count: _s, ...rest } = data[0];
    expect(rest).toEqual(before);
    expect(Object.keys(data[0]).sort())
      .toEqual([...Object.keys(before), 'exercise_count', 'set_count'].sort());
  });
});

describe('#146 AC2: warmups are excluded from both counts', () => {
  it('ignores warmup rows and slots, whatever their case', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_1' })],
      sets: [
        setRow({ workout_id: 'w_1', exercise_id: 'ex_a', section: 'warmup', exercise_order: 1, set_number: 1 }),
        setRow({ workout_id: 'w_1', exercise_id: 'ex_b', section: 'Warmup', exercise_order: 2, set_number: 1 }),
        setRow({ workout_id: 'w_1', exercise_id: 'ex_c', section: 'primary', exercise_order: 3, set_number: 1 }),
      ],
    });
    expect(data[0]).toMatchObject({ exercise_count: 1, set_count: 1 });
  });

  it.each(['primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'])('counts the %s section', (section) => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_1' })],
      sets: [
        setRow({ workout_id: 'w_1', exercise_id: 'ex_a', section, exercise_order: 1, set_number: 1 }),
        setRow({ workout_id: 'w_1', exercise_id: 'ex_a', section, exercise_order: 1, set_number: 2 }),
      ],
    });
    expect(data[0]).toMatchObject({ exercise_count: 1, set_count: 2 });
  });

  it('counts a row with a blank section: only warmups are excluded', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_1' })],
      sets: [setRow({ workout_id: 'w_1', exercise_id: 'ex_a', section: '', exercise_order: 1, set_number: 1 })],
    });
    expect(data[0]).toMatchObject({ exercise_count: 1, set_count: 1 });
  });
});

describe('#146 AC3: slot identity follows groupSetsByExercise', () => {
  it('counts the same exercise in two sections as two slots', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_1' })],
      sets: [
        setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', section: 'primary', exercise_order: 2, set_number: 1 }),
        setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', section: 'primary', exercise_order: 2, set_number: 2 }),
        setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', section: 'burnout', exercise_order: 6, set_number: 1 }),
      ],
    });
    expect(data[0]).toMatchObject({ exercise_count: 2, set_count: 3 });
  });

  it('agrees with groupSetsByExercise over the non-warmup rows', () => {
    const { sandbox, data } = plannedOn({
      workouts: [planned({ id: 'w_upper' })],
      sets: strengthSets('w_upper'),
    });
    const working = sandbox.getSets({ workout_id: 'w_upper' })
      .filter((s: { section: string }) => s.section !== 'warmup');
    const slots = sandbox.groupSetsByExercise(working);
    expect(data[0].exercise_count).toBe(slots.length);
    expect(data[0].set_count).toBe(working.length);
  });

  it("never lets another workout's sets leak in", () => {
    const { data } = plannedOn({
      workouts: [
        planned({ id: 'w_upper', name: 'Upper' }),
        planned({ id: 'w_lower', name: 'Lower' }),
        workoutRow({ id: 'w_done', date: PLAN_DATE, status: '' }),
      ],
      sets: [
        ...strengthSets('w_upper'),
        setRow({ workout_id: 'w_lower', exercise_id: 'ex_squat', section: 'primary', exercise_order: 1, set_number: 1 }),
        setRow({ workout_id: 'w_lower', exercise_id: 'ex_squat', section: 'primary', exercise_order: 1, set_number: 2 }),
        ...strengthSets('w_done'),
      ],
    });
    const byId = Object.fromEntries(data.map((w) => [w.id, w]));
    expect(Object.keys(byId).sort()).toEqual(['w_lower', 'w_upper']);
    expect(byId.w_upper).toMatchObject({ exercise_count: 5, set_count: 20 });
    expect(byId.w_lower).toMatchObject({ exercise_count: 1, set_count: 2 });
  });
});

describe('#146 AC4: no non-warmup sets is a true zero', () => {
  it('reports 0 and 0 for a planned workout with no set rows', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_ride', type: 'bike', name: 'Evening Ride' })],
      sets: strengthSets('w_other'),
    });
    expect(data[0].exercise_count).toBe(0);
    expect(data[0].set_count).toBe(0);
  });

  it('reports 0 and 0 for a planned workout with only warmup rows', () => {
    const { data } = plannedOn({
      workouts: [planned({ id: 'w_1' })],
      sets: [setRow({ workout_id: 'w_1', exercise_id: 'ex_a', section: 'warmup', exercise_order: 1, set_number: 1 })],
    });
    expect(data[0].exercise_count).toBe(0);
    expect(data[0].set_count).toBe(0);
  });

  it('reports 0 and 0 when the Sets tab is empty', () => {
    const { data } = plannedOn({ workouts: [planned({ id: 'w_1' })] });
    expect(data[0]).toMatchObject({ exercise_count: 0, set_count: 0 });
  });
});

describe('#146 AC5: one Sets read, and getWorkouts untouched', () => {
  function countSetsReads(sandbox: Sandbox) {
    const reads = { n: 0 };
    const real = sandbox.getSheet;
    sandbox.getSheet = (name: string) => {
      if (name === 'Sets') reads.n += 1;
      return real(name);
    };
    return reads;
  }

  it('reads Sets once however many workouts are planned', () => {
    const { sandbox } = loadApi({
      workouts: [planned({ id: 'w_1' }), planned({ id: 'w_2' }), planned({ id: 'w_3' })],
      sets: [...strengthSets('w_1'), ...strengthSets('w_2')],
    });
    const reads = countSetsReads(sandbox);
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: PLAN_DATE });
    expect(res.data).toHaveLength(3);
    expect(reads.n).toBe(1);
  });

  it('does not read Sets when nothing is planned', () => {
    const { sandbox } = loadApi({ workouts: [planned({ id: 'w_1' })], sets: strengthSets('w_1') });
    const reads = countSetsReads(sandbox);
    const res = callDoGet(sandbox, { action: 'getPlannedWorkouts', date: '2026-12-25' });
    expect(res.data).toEqual([]);
    expect(reads.n).toBe(0);
  });

  it('leaves getWorkouts and getWorkout without counts', () => {
    const { sandbox } = loadApi({ workouts: [planned({ id: 'w_1' })], sets: strengthSets('w_1') });
    const [listed] = callDoGet(sandbox, { action: 'getWorkouts', date: PLAN_DATE }).data;
    const single = callDoGet(sandbox, { action: 'getWorkout', id: 'w_1' }).data;
    for (const w of [listed, single]) {
      expect(w).not.toHaveProperty('exercise_count');
      expect(w).not.toHaveProperty('set_count');
    }
  });
});
