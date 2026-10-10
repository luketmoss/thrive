// #349 AC2: the pure half of the planned editor's in-place Sets write —
// building the desired rows, carrying what the planner does not show, and
// pairing them with the stored rows by position.

import { describe, it, expect } from 'vitest';
import {
  builderExercisesToSets, carryPlannedSetValues, planSetsReconcile, isEmptyPlan, reconcileRequests,
} from './workouts-api';
import type { BuilderExercise, SetWithRow, WorkoutSet } from './types';

const W = 'w_X';

function ex(id: string, section: string, sets: number, reps = '8'): BuilderExercise {
  return { exercise_id: id, exercise_name: id.toUpperCase(), section, sets, planned_reps: reps };
}

/** Stored rows for W at consecutive sheet rows from `firstRow`. */
function stored(rows: WorkoutSet[], firstRow: number): SetWithRow[] {
  return rows.map((s, i) => ({ ...s, sheetRow: firstRow + i }));
}

const PLAN = [ex('warm', 'warmup', 0, ''), ex('squat', 'primary', 3, '5'), ex('curl', 'SS1', 2, '12')];

describe('builderExercisesToSets: a new plan\'s expansion', () => {
  it('orders by position, one warmup row, N rows otherwise', () => {
    const rows = builderExercisesToSets(W, PLAN);
    expect(rows.map((s) => [s.exercise_id, s.section, s.exercise_order, s.set_number, s.planned_reps])).toEqual([
      ['warm', 'warmup', 1, 1, ''],
      ['squat', 'primary', 2, 1, '5'], ['squat', 'primary', 2, 2, '5'], ['squat', 'primary', 2, 3, '5'],
      ['curl', 'SS1', 3, 1, '12'], ['curl', 'SS1', 3, 2, '12'],
    ]);
    expect(rows.every((s) => s.workout_id === W && s.weight === '' && s.reps === '' && s.effort === '')).toBe(true);
  });
});

describe('carryPlannedSetValues (#118, widened to reps and effort)', () => {
  const old = builderExercisesToSets(W, [ex('bench', 'primary', 3)]).map((s, i) => ({
    ...s, weight: ['95', '115', '135'][i], reps: i === 0 ? '8' : '', effort: (i === 0 ? 'Hard' : '') as WorkoutSet['effort'],
  }));

  it('keeps weight, reps and effort on every surviving set', () => {
    const out = carryPlannedSetValues(old, builderExercisesToSets(W, [ex('bench', 'primary', 3)]));
    expect(out.map((s) => [s.weight, s.reps, s.effort])).toEqual([['95', '8', 'Hard'], ['115', '', ''], ['135', '', '']]);
  });

  it('leaves an added set blank and drops a removed one', () => {
    expect(carryPlannedSetValues(old, builderExercisesToSets(W, [ex('bench', 'primary', 4)])).map((s) => s.weight))
      .toEqual(['95', '115', '135', '']);
    expect(carryPlannedSetValues(old, builderExercisesToSets(W, [ex('bench', 'primary', 2)])).map((s) => s.weight))
      .toEqual(['95', '115']);
  });

  it('keeps a bodyweight "0" distinct from blank', () => {
    const bw = [{ ...old[0], exercise_id: 'pushup', section: 'SS2', weight: '0' }];
    expect(carryPlannedSetValues(bw, builderExercisesToSets(W, [ex('pushup', 'SS2', 1)]))[0].weight).toBe('0');
  });

  it('does not borrow from the same lift in another section; warmups carry too', () => {
    const warm = [{ ...old[0], section: 'warmup', exercise_order: 1, weight: '45', reps: '', effort: '' as const }];
    const out = carryPlannedSetValues([...warm, ...old], builderExercisesToSets(W, [ex('bench', 'warmup', 0), ex('bench', 'SS1', 1)]));
    expect(out.map((s) => s.weight)).toEqual(['45', '']);
  });

  it('follows the set when the exercise is reordered', () => {
    const out = carryPlannedSetValues(old, builderExercisesToSets(W, [ex('curl', 'primary', 1), ex('bench', 'primary', 3)]));
    expect(out.map((s) => s.weight)).toEqual(['', '95', '115', '135']);
    expect(out[1].exercise_order).toBe(2);
  });
});

describe('carryPlannedSetValues: by the entry\'s source_order (#380)', () => {
  /** Bench primary at order 2 (135/155, set 1 done 8 Hard), Bench primary again at order 4 (95/95), a warmup at 1. */
  const STORED: WorkoutSet[] = [
    { ...builderExercisesToSets(W, [ex('bench', 'warmup', 0)])[0], weight: '45' },
    ...builderExercisesToSets(W, [ex('warm', 'warmup', 0), ex('bench', 'primary', 2)]).slice(1).map((s, i) => ({
      ...s, weight: ['135', '155'][i], reps: i === 0 ? '8' : '', effort: (i === 0 ? 'Hard' : '') as WorkoutSet['effort'],
    })),
    ...builderExercisesToSets(W, [ex('a', 'x', 0), ex('b', 'x', 0), ex('c', 'x', 0), ex('bench', 'primary', 2)])
      .filter((s) => s.exercise_id === 'bench')
      .map((s, i) => ({ ...s, weight: '95', reps: i === 1 ? '10' : '', effort: (i === 1 ? 'Easy' : '') as WorkoutSet['effort'] })),
  ];
  const src = (e: BuilderExercise, source_order?: number): BuilderExercise =>
    (source_order === undefined ? e : { ...e, source_order });
  const carry = (plan: BuilderExercise[], from = STORED) =>
    carryPlannedSetValues(from, builderExercisesToSets(W, plan), plan);
  const vals = (rows: WorkoutSet[]) => rows.map((s) => [s.exercise_order, s.set_number, s.weight, s.reps, s.effort]);

  it('AC1: an untouched duplicate keeps its own values; the key path would have borrowed the first', () => {
    const plan = [src(ex('bench', 'warmup', 0), 1), src(ex('bench', 'primary', 2), 2), src(ex('x', 'SS1', 1)), src(ex('bench', 'primary', 2), 4)];
    expect(vals(carry(plan).filter((s) => s.exercise_id === 'bench'))).toEqual([
      [1, 1, '45', '', ''],
      [2, 1, '135', '8', 'Hard'], [2, 2, '155', '', ''],
      [4, 1, '95', '', ''], [4, 2, '95', '10', 'Easy'],
    ]);
    // Without provenance (the old behavior), the second Bench takes 135 / 155.
    const keyed = carryPlannedSetValues(STORED, builderExercisesToSets(W, plan));
    expect(keyed.filter((s) => s.exercise_order === 4).map((s) => s.weight)).toEqual(['135', '155']);
  });

  it('AC2: values follow the entry when it moves', () => {
    const plan = [src(ex('bench', 'primary', 2), 4), src(ex('bench', 'primary', 2), 2)];
    expect(vals(carry(plan))).toEqual([
      [1, 1, '95', '', ''], [1, 2, '95', '10', 'Easy'],
      [2, 1, '135', '8', 'Hard'], [2, 2, '155', '', ''],
    ]);
  });

  it('AC2: a section change keeps the values, never blanked or swapped', () => {
    const plan = [src(ex('bench', 'SS2', 2), 2), src(ex('bench', 'SS3', 2), 4)];
    expect(carry(plan).map((s) => s.weight)).toEqual(['135', '155', '95', '95']);
  });

  it('AC2: to warmup keeps set 1 on its one row; a warmup changed to a section keeps set 1, further sets blank', () => {
    expect(vals(carry([src(ex('bench', 'warmup', 0), 4)]))).toEqual([[1, 1, '95', '', '']]);
    expect(vals(carry([src(ex('bench', 'primary', 3), 1)]))).toEqual([[1, 1, '45', '', ''], [1, 2, '', '', ''], [1, 3, '', '', '']]);
  });

  it('AC3: the set count changes per entry; the other entry is unaffected', () => {
    const grow = carry([src(ex('bench', 'primary', 2), 2), src(ex('bench', 'primary', 3), 4)]);
    expect(grow.map((s) => s.weight)).toEqual(['135', '155', '95', '95', '']);
    const shrink = carry([src(ex('bench', 'primary', 2), 2), src(ex('bench', 'primary', 1), 4)]);
    expect(shrink.map((s) => s.weight)).toEqual(['135', '155', '95']);
  });

  it('AC4: values come from the rows given (the fresh read); a missing source row is blank, never key-matched', () => {
    const fresh = STORED.map((s) => (s.exercise_order === 4 && s.set_number === 1 ? { ...s, weight: '100' } : s));
    expect(carry([src(ex('bench', 'primary', 2), 4)], fresh).map((s) => s.weight)).toEqual(['100', '95']);
    const gone = STORED.filter((s) => s.exercise_order !== 4);
    expect(carry([src(ex('bench', 'primary', 2), 4)], gone).map((s) => s.weight)).toEqual(['', '']);
  });

  it('AC5: an entry without source_order still uses the exercise + section + set key', () => {
    const plan = [src(ex('bench', 'primary', 2), 4), src(ex('bench', 'primary', 2)), src(ex('row', 'primary', 1))];
    expect(carry(plan).map((s) => s.weight)).toEqual(['95', '95', '135', '155', '']);
  });

  it('never puts source_order on a row', () => {
    const rows = carry([src(ex('bench', 'primary', 2), 4)]);
    expect(rows.every((s) => !('source_order' in s))).toBe(true);
  });
});

describe('planSetsReconcile: stored rows + desired rows → requests', () => {
  const base = builderExercisesToSets(W, PLAN); // 6 rows
  const at10 = stored(base, 10);

  it('plans nothing when unchanged', () => {
    const plan = planSetsReconcile(at10, base);
    expect(isEmptyPlan(plan)).toBe(true);
    expect(reconcileRequests(plan, 2)).toEqual([]);
  });

  it('ignores stored order: pairs by ascending sheet row', () => {
    expect(isEmptyPlan(planSetsReconcile([...at10].reverse(), base))).toBe(true);
  });

  it('adds an exercise: rows already there are untouched, the new ones appended', () => {
    const desired = builderExercisesToSets(W, [...PLAN, ex('row', 'primary', 2)]);
    const plan = planSetsReconcile(at10, desired);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.appends.map((s) => s.exercise_id)).toEqual(['row', 'row']);
  });

  it('removes an exercise: overwrites in place, deletes the surplus bottom-to-top', () => {
    const desired = builderExercisesToSets(W, [PLAN[0], PLAN[2]]); // warm + curl x2 = 3 rows
    const plan = planSetsReconcile(at10, desired);
    expect(plan.updates.map((u) => [u.sheetRow, u.set.exercise_id, u.set.set_number])).toEqual([
      [11, 'curl', 1], [12, 'curl', 2],
    ]);
    expect(plan.deletes).toEqual([15, 14, 13]);
    expect(plan.appends).toEqual([]);
  });

  it('reorders: every moved row is overwritten, nothing deleted or appended', () => {
    const desired = builderExercisesToSets(W, [PLAN[1], PLAN[2], PLAN[0]]);
    const plan = planSetsReconcile(at10, desired);
    expect(plan.deletes).toEqual([]);
    expect(plan.appends).toEqual([]);
    expect(plan.updates.map((u) => u.sheetRow)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(plan.updates[5].set).toMatchObject({ exercise_id: 'warm', section: 'warmup', exercise_order: 3 });
  });

  it('more sets: appends only the extra set', () => {
    const plan = planSetsReconcile(at10, builderExercisesToSets(W, [PLAN[0], PLAN[1], ex('curl', 'SS1', 3, '12')]));
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.appends.map((s) => [s.exercise_id, s.set_number])).toEqual([['curl', 3]]);
  });

  it('fewer sets: deletes only the last row', () => {
    const plan = planSetsReconcile(at10, builderExercisesToSets(W, [PLAN[0], PLAN[1], ex('curl', 'SS1', 1, '12')]));
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([15]);
  });

  it('warmup removed: rows shift up in place, last one deleted', () => {
    const plan = planSetsReconcile(at10, builderExercisesToSets(W, [PLAN[1], PLAN[2]]));
    expect(plan.updates.map((u) => u.sheetRow)).toEqual([10, 11, 12, 13, 14]);
    expect(plan.deletes).toEqual([15]);
  });

  it('warmup added: overwrites from the top and appends one', () => {
    const plan = planSetsReconcile(at10, builderExercisesToSets(W, [PLAN[0], ex('warm2', 'warmup', 0, ''), PLAN[1], PLAN[2]]));
    expect(plan.updates[0].sheetRow).toBe(11);
    expect(plan.appends).toHaveLength(1);
    expect(plan.deletes).toEqual([]);
  });

  it('works with rows that are not contiguous', () => {
    const scattered = base.map((s, i) => ({ ...s, sheetRow: [3, 4, 9, 10, 20, 21][i] }));
    const plan = planSetsReconcile(scattered, builderExercisesToSets(W, [PLAN[0]]));
    expect(plan.deletes).toEqual([21, 20, 10, 9, 4]);
  });
});

describe('reconcileRequests: one batch, in a safe order', () => {
  it('overwrites, then deletes descending, then appends; cells mirror setToRow under RAW', () => {
    const at10 = stored(builderExercisesToSets(W, [ex('a', 'primary', 3)]), 10);
    const desired = builderExercisesToSets(W, [ex('b', 'primary', 1, '')]);
    const del = planSetsReconcile(at10, desired);
    const reqs = reconcileRequests(del, 7) as any[];
    expect(reqs.map((r) => Object.keys(r)[0])).toEqual(['updateCells', 'deleteDimension', 'deleteDimension']);
    expect(reqs[0].updateCells.start).toEqual({ sheetId: 7, rowIndex: 9, columnIndex: 0 });
    expect(reqs[0].updateCells.fields).toBe('userEnteredValue');
    const cells = reqs[0].updateCells.rows[0].values;
    expect(cells).toHaveLength(10);
    expect(cells[0]).toEqual({ userEnteredValue: { stringValue: W } });
    expect(cells[4]).toEqual({ userEnteredValue: { numberValue: 1 } });
    expect(cells[5]).toEqual({ userEnteredValue: { numberValue: 1 } });
    expect(cells[6]).toEqual({}); // blank planned_reps clears the cell
    expect(reqs[1].deleteDimension.range).toEqual({ sheetId: 7, dimension: 'ROWS', startIndex: 11, endIndex: 12 });
    expect(reqs[2].deleteDimension.range.startIndex).toBe(10);

    const grow = reconcileRequests(planSetsReconcile([], desired), 7) as any[];
    expect(grow).toHaveLength(1);
    expect(grow[0].appendCells.sheetId).toBe(7);
    expect(grow[0].appendCells.rows).toHaveLength(1);
  });
});

describe('builderExercisesToSets: per-set planned reps (#350)', () => {
  it('writes set n from planned_reps_by_set[n - 1], falling back to planned_reps', () => {
    const rows = builderExercisesToSets(W, [{ ...ex('bench', 'primary', 4, '10'), planned_reps_by_set: ['10', '8', '6'] }]);
    expect(rows.map((r) => r.planned_reps)).toEqual(['10', '8', '6', '10']);
  });

  it('a shorter set count takes only the first values', () => {
    const rows = builderExercisesToSets(W, [{ ...ex('bench', 'primary', 2, '10'), planned_reps_by_set: ['10', '8', '6'] }]);
    expect(rows.map((r) => r.planned_reps)).toEqual(['10', '8']);
  });

  it('a warmup is still one row with blank planned reps', () => {
    const rows = builderExercisesToSets(W, [{ ...ex('bench', 'warmup', 3, '10'), planned_reps_by_set: ['10', '8', '6'] }]);
    expect(rows.map((r) => [r.section, r.set_number, r.planned_reps])).toEqual([['warmup', 1, '']]);
  });

  it('without the list, every set gets planned_reps, as before', () => {
    expect(builderExercisesToSets(W, [ex('bench', 'primary', 3, '12')]).map((r) => r.planned_reps)).toEqual(['12', '12', '12']);
  });
});
