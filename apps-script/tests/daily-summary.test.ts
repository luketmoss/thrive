// #131 — the DailySummary rollup. One row per local calendar day, derived
// from Workouts + DailyHealth, rebuildable over any range.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type CellValue } from './apps-script-sandbox';

const AT = '2026-09-20T12:00:00.000Z';

/** Column letters -> index, so assertions read like the spec's table. */
const COL = {
  date: 0, activity_count: 1, activity_types: 2, total_moving_s: 3,
  total_elapsed_s: 4, total_distance_m: 5, total_ascent_m: 6,
  cardio_activity_count: 7, distance_withdata: 8, ascent_withdata: 9,
  max_effort: 10, effort_counts: 11, steps: 12, resting_hr: 13, hrv: 14,
  sleep_total_s: 15, training_load: 16, computed_at: 17,
};

function rebuild(
  fixtures: { workouts?: CellValue[][]; dailySummary?: CellValue[][]; dailyHealth?: CellValue[][] },
  from: string,
  to: string,
  computedAt: string | undefined = AT,
) {
  const api = loadApi(fixtures);
  const res = callDoGet<any>(api.sandbox, {
    action: 'rebuildDailySummary',
    payload: JSON.stringify({ from, to, computed_at: computedAt }),
  });
  return { ...api, res };
}

describe('AC1: the rebuild is idempotent over an arbitrary range', () => {
  const workouts = () => [
    workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: 'Hard', elapsed_seconds: '3600' }),
    workoutRow({ id: 'w_2', date: '2026-09-16', type: 'bike', sub_type: 'gravel', distance_m: '19956', ascent_m: '457', elapsed_seconds: '5400' }),
  ];

  it('produces byte-identical rows on a second run', () => {
    const first = rebuild({ workouts: workouts() }, '2026-09-15', '2026-09-16');
    const after = JSON.parse(JSON.stringify(first.summaryRows));

    // Re-run over the same range against the rows the first run produced.
    const second = rebuild(
      { workouts: workouts(), dailySummary: after },
      '2026-09-15', '2026-09-16',
    );
    expect(second.res.success).toBe(true);
    expect(second.summaryRows).toEqual(after);
  });

  it('updates in place rather than duplicating', () => {
    const first = rebuild({ workouts: workouts() }, '2026-09-15', '2026-09-16');
    expect(first.summaryRows).toHaveLength(2);

    const second = rebuild(
      { workouts: workouts(), dailySummary: JSON.parse(JSON.stringify(first.summaryRows)) },
      '2026-09-15', '2026-09-16',
    );
    expect(second.summaryRows).toHaveLength(2);
    expect(second.res.data.updated).toBe(2);
    expect(second.res.data.written).toBe(0);
  });

  it('takes the range as a parameter, so any window works', () => {
    const wide = rebuild({ workouts: workouts() }, '2026-09-01', '2026-09-30');
    expect(wide.res.data.days).toBe(30);
    expect(wide.summaryRows).toHaveLength(2); // only the days with something

    const narrow = rebuild({ workouts: workouts() }, '2026-09-16', '2026-09-16');
    expect(narrow.res.data.days).toBe(1);
    expect(narrow.summaryRows).toHaveLength(1);
  });

  // A day nobody trained is not a day of zeros.
  it('writes no row for a day with no activities and no health data', () => {
    const { res, summaryRows } = rebuild({ workouts: workouts() }, '2026-09-17', '2026-09-19');
    expect(res.success).toBe(true);
    expect(summaryRows).toHaveLength(0);
    expect(res.data.skipped).toBe(3);
  });

  it('stamps one computed_at for the whole run, not one per day', () => {
    const { summaryRows } = rebuild({ workouts: workouts() }, '2026-09-15', '2026-09-16');
    const stamps = new Set(summaryRows.map((r) => r[COL.computed_at]));
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).toBe(AT);
  });

  it('refuses a reversed or malformed range', () => {
    expect(rebuild({ workouts: [] }, '2026-09-16', '2026-09-15').res.error)
      .toMatch(/from must not be after to/);
    expect(rebuild({ workouts: [] }, '16 Sept', '2026-09-16').res.error)
      .toMatch(/Expected YYYY-MM-DD/);
  });

  // A derived tab may not keep a row its sources no longer imply. Found in
  // review: the rebuild skipped empty days without clearing what was there.
  it('removes a row for a day that no longer earns one', () => {
    const first = rebuild({ workouts: workouts() }, '2026-09-15', '2026-09-16');
    expect(first.summaryRows).toHaveLength(2);

    // The 15th's only workout is deleted; the 16th's remains.
    const second = rebuild({
      workouts: [workouts()[1]],
      dailySummary: JSON.parse(JSON.stringify(first.summaryRows)),
    }, '2026-09-15', '2026-09-16');

    expect(second.res.data.removed).toBe(1);
    expect(second.summaryRows).toHaveLength(1);
    expect(second.summaryRows[0][COL.date]).toBe('2026-09-16');
  });

  it('removes several stale rows without corrupting the ones that stay', () => {
    const three = () => [
      workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: 'Hard' }),
      workoutRow({ id: 'w_2', date: '2026-09-16', type: 'bike', distance_m: '19956' }),
      workoutRow({ id: 'w_3', date: '2026-09-17', type: 'run', distance_m: '5000' }),
    ];
    const first = rebuild({ workouts: three() }, '2026-09-15', '2026-09-17');
    expect(first.summaryRows).toHaveLength(3);

    // The first and last days lose their workouts; the middle one survives.
    const second = rebuild({
      workouts: [three()[1]],
      dailySummary: JSON.parse(JSON.stringify(first.summaryRows)),
    }, '2026-09-15', '2026-09-17');

    expect(second.res.data.removed).toBe(2);
    expect(second.summaryRows).toHaveLength(1);
    expect(second.summaryRows[0][COL.date]).toBe('2026-09-16');
    expect(second.summaryRows[0][COL.total_distance_m]).toBe('19956');
  });

  it('leaves rows outside the rebuilt range alone', () => {
    const first = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight' }),
        workoutRow({ id: 'w_2', date: '2026-09-20', type: 'bike' }),
      ],
    }, '2026-09-15', '2026-09-20');
    expect(first.summaryRows).toHaveLength(2);

    // Rebuild only the 15th, with its workout gone. The 20th is out of range
    // and must survive even though its source is absent from this call.
    const second = rebuild({
      workouts: [],
      dailySummary: JSON.parse(JSON.stringify(first.summaryRows)),
    }, '2026-09-15', '2026-09-15');

    expect(second.res.data.removed).toBe(1);
    expect(second.summaryRows.map((r) => r[COL.date])).toEqual(['2026-09-20']);
  });

  it('excludes planned workouts — a plan is not a thing that happened', () => {
    const { summaryRows } = rebuild({
      workouts: [workoutRow({ id: 'w_p', date: '2026-09-15', status: 'planned', type: 'weight' })],
    }, '2026-09-15', '2026-09-15');
    expect(summaryRows).toHaveLength(0);
  });
});

describe('AC2: a pre-COROS day is partial, not zeroed', () => {
  // Every day before the watch. DailyHealth does not exist at all.
  const { summaryRows } = rebuild({
    workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: 'Hard', elapsed_seconds: '3600' })],
  }, '2026-09-15', '2026-09-15');
  const row = summaryRows[0];

  it('populates the activity columns', () => {
    expect(row[COL.activity_count]).toBe('1');
    expect(row[COL.total_elapsed_s]).toBe('3600');
    expect(row[COL.max_effort]).toBe('Hard');
  });

  it('leaves every health column blank', () => {
    for (const f of ['steps', 'resting_hr', 'hrv', 'sleep_total_s', 'training_load'] as const) {
      expect(row[COL[f]], f).toBe('');
    }
  });

  // A day before the watch existed is not a day with no steps.
  it('never writes 0 into a health column', () => {
    for (const f of ['steps', 'resting_hr', 'hrv', 'sleep_total_s', 'training_load'] as const) {
      expect(row[COL[f]], f).not.toBe('0');
      expect(row[COL[f]], f).not.toBe(0);
    }
  });

  it('fills the health columns once DailyHealth has the day', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight' })],
      dailyHealth: [['2026-09-15', '8432', '48', '62', '27000', '340']],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.steps]).toBe('8432');
    expect(rows[0][COL.resting_hr]).toBe('48');
    expect(rows[0][COL.hrv]).toBe('62');
    expect(rows[0][COL.sleep_total_s]).toBe('27000');
    expect(rows[0][COL.training_load]).toBe('340');
  });

  it('writes a row for a health-only day, with the activity columns blank', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [],
      dailyHealth: [['2026-09-15', '8432', '48', '62', '27000', '340']],
    }, '2026-09-15', '2026-09-15');
    expect(rows).toHaveLength(1);
    expect(rows[0][COL.steps]).toBe('8432');
    expect(rows[0][COL.activity_count]).toBe('');
    expect(rows[0][COL.total_distance_m]).toBe('');
  });
});

describe('AC3: total_distance_m excludes indoor activities', () => {
  const day = () => [
    workoutRow({ id: 'w_out', date: '2026-09-15', type: 'bike', sub_type: 'gravel', distance_m: '19956', ascent_m: '457' }),
    workoutRow({ id: 'w_in', date: '2026-09-15', type: 'bike', sub_type: 'indoor', distance_m: '15000', ascent_m: '300' }),
  ];

  const { summaryRows } = rebuild({ workouts: day() }, '2026-09-15', '2026-09-15');
  const row = summaryRows[0];

  it('counts only the outdoor distance', () => {
    expect(row[COL.total_distance_m]).toBe('19956');
  });

  it('counts only the outdoor ascent', () => {
    expect(row[COL.total_ascent_m]).toBe('457');
  });

  it('counts only outdoor activities in cardio_activity_count', () => {
    expect(row[COL.cardio_activity_count]).toBe('1');
  });

  // The whole day still happened, indoors included.
  it('counts both in activity_count', () => {
    expect(row[COL.activity_count]).toBe('2');
  });

  it('names both in activity_types', () => {
    expect(row[COL.activity_types]).toBe('bike:gravel,bike:indoor');
  });

  it('excludes indoor runs and walks too, not just rides', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'run', sub_type: 'indoor', distance_m: '5000' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'walk', sub_type: 'indoor', distance_m: '3000' }),
      ],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.total_distance_m]).toBe('');
    expect(rows[0][COL.cardio_activity_count]).toBe('');
    expect(rows[0][COL.activity_count]).toBe('2');
  });

  it('treats a blank sub_type as outdoor, as every pre-#129 row is', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'bike', sub_type: '', distance_m: '12000' })],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.total_distance_m]).toBe('12000');
  });

  it('excludes a weight session from cardio counts entirely', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'hike', distance_m: '8000', ascent_m: '600' }),
      ],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.cardio_activity_count]).toBe('1');
    expect(rows[0][COL.activity_count]).toBe('2');
  });
});

describe('AC4: effort is session effort, counted per workout', () => {
  const { summaryRows } = rebuild({
    workouts: [
      workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: 'Hard' }),
      workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike', effort: 'Medium' }),
      workoutRow({ id: 'w_3', date: '2026-09-15', type: 'stretch', effort: '' }),
    ],
  }, '2026-09-15', '2026-09-15');
  const row = summaryRows[0];

  it('takes the hardest as max_effort', () => {
    expect(row[COL.max_effort]).toBe('Hard');
  });

  it('counts each effort, and the blank one in neither', () => {
    expect(row[COL.effort_counts]).toBe('Hard:1,Medium:1');
  });

  it('still counts the effortless workout as an activity', () => {
    expect(row[COL.activity_count]).toBe('3');
  });

  it('leaves both blank when no workout recorded an effort', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: '' })],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.max_effort]).toBe('');
    expect(rows[0][COL.effort_counts]).toBe('');
  });

  it('orders effort_counts hardest first, so a rebuild is deterministic', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: 'Easy' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike', effort: 'Hard' }),
        workoutRow({ id: 'w_3', date: '2026-09-15', type: 'run', effort: 'Medium' }),
        workoutRow({ id: 'w_4', date: '2026-09-15', type: 'walk', effort: 'Easy' }),
      ],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.effort_counts]).toBe('Hard:1,Medium:1,Easy:2');
    expect(rows[0][COL.max_effort]).toBe('Hard');
  });

  // A hard set does not make a hard session (#113).
  it('reads Workouts!M and never derives effort from set rows', () => {
    const api = loadApi({
      workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight', effort: '' })],
      // Sets full of Hard effort. The day must still report no session effort.
      sets: [
        ['w_1', 'ex_1', 'Bench', 'primary', 1, 1, '6', '185', '6', 'Hard'],
        ['w_1', 'ex_1', 'Bench', 'primary', 1, 2, '6', '185', '5', 'Hard'],
      ],
    });
    callDoGet(api.sandbox, {
      action: 'rebuildDailySummary',
      payload: JSON.stringify({ from: '2026-09-15', to: '2026-09-15', computed_at: AT }),
    });
    expect(api.summaryRows[0][COL.max_effort]).toBe('');
    expect(api.summaryRows[0][COL.effort_counts]).toBe('');
  });
});

describe('AC6: totals carry their coverage', () => {
  // Three outdoor rides: one recorded distance, two recorded ascent.
  const { summaryRows } = rebuild({
    workouts: [
      workoutRow({ id: 'w_1', date: '2026-09-15', type: 'bike', distance_m: '19956', ascent_m: '457' }),
      workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike', distance_m: '', ascent_m: '300' }),
      workoutRow({ id: 'w_3', date: '2026-09-15', type: 'bike', distance_m: '', ascent_m: '' }),
    ],
  }, '2026-09-15', '2026-09-15');
  const row = summaryRows[0];

  it('reports the of, and each coverage independently', () => {
    expect(row[COL.cardio_activity_count]).toBe('3');
    expect(row[COL.distance_withdata]).toBe('1');
    expect(row[COL.ascent_withdata]).toBe('2');
  });

  it('sums only what was recorded', () => {
    expect(row[COL.total_distance_m]).toBe('19956');
    expect(row[COL.total_ascent_m]).toBe('757');
  });

  // "Complete" must be distinguishable from "not computed".
  it('still populates the counts at full coverage', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'bike', distance_m: '10000', ascent_m: '100' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike', distance_m: '20000', ascent_m: '200' }),
      ],
    }, '2026-09-15', '2026-09-15');
    expect(rows[0][COL.cardio_activity_count]).toBe('2');
    expect(rows[0][COL.distance_withdata]).toBe('2');
    expect(rows[0][COL.ascent_withdata]).toBe('2');
  });

  it('keeps a deliberate zero distinct from unrecorded', () => {
    const { summaryRows: rows } = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'bike', distance_m: '10000', ascent_m: '0' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike', distance_m: '10000', ascent_m: '' }),
      ],
    }, '2026-09-15', '2026-09-15');
    // A flat ride recorded 0 ascent; the other recorded nothing.
    expect(rows[0][COL.total_ascent_m]).toBe('0');
    expect(rows[0][COL.ascent_withdata]).toBe('1');
    expect(rows[0][COL.cardio_activity_count]).toBe('2');
  });
});

describe('the tab is readable, and history bounds are discoverable', () => {
  it('reads summaries back, filtered by range', () => {
    const first = rebuild({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight' }),
        workoutRow({ id: 'w_2', date: '2026-09-20', type: 'bike' }),
      ],
    }, '2026-09-15', '2026-09-20');

    const res = callDoGet<any[]>(first.sandbox, {
      action: 'getDailySummary', from: '2026-09-18', to: '2026-09-30',
    });
    expect(res.data.map((s) => s.date)).toEqual(['2026-09-20']);
  });

  it('reports the span the history actually covers', () => {
    const api = loadApi({
      workouts: [
        workoutRow({ id: 'w_1', date: '2026-03-04', type: 'weight' }),
        workoutRow({ id: 'w_2', date: '2026-09-15', type: 'bike' }),
        workoutRow({ id: 'w_3', date: '2026-12-01', type: 'weight', status: 'planned' }),
      ],
    });
    const res = callDoGet<any>(api.sandbox, { action: 'getHistoryDateRange' });
    // The planned workout in December is not history.
    expect(res.data).toEqual({ from: '2026-03-04', to: '2026-09-15' });
  });

  it('returns all 18 columns on a read', () => {
    const first = rebuild({
      workouts: [workoutRow({ id: 'w_1', date: '2026-09-15', type: 'weight' })],
    }, '2026-09-15', '2026-09-15');
    const res = callDoGet<any[]>(first.sandbox, { action: 'getDailySummary' });
    expect(Object.keys(res.data[0])).toHaveLength(19); // 18 + sheetRow
    expect(first.summaryRows[0]).toHaveLength(18);
  });
});
