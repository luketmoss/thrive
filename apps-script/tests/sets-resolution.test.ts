// #134 AC1/AC3/AC4 — callers name a set by domain identifiers and the server
// resolves which row that is. Ambiguity and no-match are refused, never
// guessed, and resolution is available without writing.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, exerciseRow, setRow, workoutRow } from './apps-script-sandbox';

const EXERCISES = () => [
  exerciseRow({ id: 'ex_bench', name: 'Bench Press' }),
  exerciseRow({ id: 'ex_incline', name: 'Incline Press' }),
];

/** Bench appears twice — a warmup slot and a primary slot. */
const SETS = () => [
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'warmup', exercise_order: 1, set_number: 1, weight: '95', reps: '10' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 2, set_number: 1, weight: '185', reps: '6' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 2, set_number: 2, weight: '185', reps: '5' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_incline', exercise_name: 'Incline Press', section: 'SS1', exercise_order: 3, set_number: 1, weight: '55', reps: '12' }),
  setRow({ workout_id: 'w_2', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, weight: '175', reps: '6' }),
];

function api() {
  return loadApi({ exercises: EXERCISES(), sets: SETS(), workouts: [workoutRow({ id: 'w_1' })] });
}

function preview(updates: unknown[], workoutId = 'w_1') {
  const a = api();
  const res = callDoGet<{ changes: any[]; applied: boolean }>(a.sandbox, {
    action: 'previewSetUpdates',
    payload: JSON.stringify({ workout_id: workoutId, updates }),
  });
  return { ...a, res };
}

describe('AC1: no caller needs to know the sheet shape', () => {
  it('takes domain identifiers, never a sheetRow or an A1 range', () => {
    const { res } = preview([
      { exercise: 'Incline Press', set_number: 1, weight: '60' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.changes[0].after.weight).toBe('60');
  });

  it('rejects a sheetRow passed as if it were an identifier', () => {
    const { res } = preview([{ exercise: 'Bench Press', sheetRow: 3, weight: '190' }]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unknown field "sheetRow"/);
  });

  it('resolves an exercise by name or by id, interchangeably', () => {
    expect(preview([{ exercise: 'Incline Press', set_number: 1, reps: '11' }]).res.success).toBe(true);
    expect(preview([{ exercise: 'ex_incline', set_number: 1, reps: '11' }]).res.success).toBe(true);
  });

  it('returns domain objects, not positional arrays', () => {
    const { res } = preview([{ exercise: 'Incline Press', set_number: 1, weight: '60' }]);
    const change = res.data.changes[0];
    expect(Array.isArray(change.before)).toBe(false);
    expect(change.before).toHaveProperty('exercise_name');
    expect(change.exercise).toEqual({ id: 'ex_incline', name: 'Incline Press' });
    expect(change.slot).toEqual({ section: 'SS1', exercise_order: 3 });
  });

  it('reads sets grouped into slots without exposing rows to the caller', () => {
    const { sandbox } = api();
    const res = callDoGet<any[]>(sandbox, { action: 'getWorkoutSets', workout_id: 'w_1' });
    expect(res.data.map((s) => s.exercise_order)).toEqual([1, 2, 3]);
    expect(res.data[1].sets).toHaveLength(2);
  });
});

describe('AC3: resolution happens server-side and never guesses', () => {
  // The same lift as a warmup and as a primary is two slots, not one.
  it('refuses an ambiguous target and names the candidates', () => {
    const { res } = preview([{ exercise: 'Bench Press', set_number: 1, weight: '190' }]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/appears 2 times/);
    expect(res.error).toMatch(/\[warmup\] exercise_order 1/);
    expect(res.error).toMatch(/\[primary\] exercise_order 2/);
    expect(res.error).toMatch(/Pass section or exercise_order/);
  });

  it('accepts the same target once section narrows it', () => {
    const { res } = preview([
      { exercise: 'Bench Press', section: 'primary', set_number: 1, weight: '190' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.changes[0].slot.exercise_order).toBe(2);
  });

  it('accepts exercise_order as the narrowing instead', () => {
    const { res } = preview([
      { exercise: 'Bench Press', exercise_order: 1, set_number: 1, weight: '100' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.changes[0].slot.section).toBe('warmup');
  });

  it('refuses a target matching nothing rather than appending', () => {
    const { res, setRows } = preview([
      { exercise: 'Bench Press', section: 'cooldown', set_number: 1, weight: '100' },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No Bench Press in section cooldown/);
    expect(setRows).toHaveLength(5); // nothing appended
  });

  it('refuses a set number the slot does not have, saying what it does', () => {
    const { res } = preview([
      { exercise: 'Bench Press', section: 'primary', set_number: 9, reps: '5' },
    ]);
    expect(res.error).toMatch(/No set 9 of Bench Press \[primary\]/);
    expect(res.error).toMatch(/that slot has sets 1\.\.2/);
  });

  it('stays inside the workout it was given', () => {
    // w_2 has Bench at exercise_order 1 only, so this is unambiguous there.
    const { res } = preview([{ exercise: 'Bench Press', set_number: 1, weight: '180' }], 'w_2');
    expect(res.success).toBe(true);
    expect(res.data.changes[0].before.workout_id).toBe('w_2');
  });

  it('refuses an unresolvable exercise', () => {
    const { res } = preview([{ exercise: 'Kettlebell Swing', set_number: 1, reps: '10' }]);
    expect(res.error).toMatch(/No exercise matching "Kettlebell Swing"/);
  });

  // The one deliberate divergence from mcp-server's resolver, found by a
  // differential test over 14 reference shapes. There, '' falls through to
  // partial matching — where it is a substring of every name — and reports
  // the whole library as ambiguous. Both are failure paths, so #132 changes
  // no working call.
  it('refuses an empty exercise reference as missing, not as ambiguous', () => {
    const { res } = preview([{ exercise: '', set_number: 1, reps: '10' }]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/An exercise reference is required/);
    expect(res.error).not.toMatch(/ambiguous/);
  });
});

describe('AC4: resolution without writing', () => {
  it('reports what each update would change and writes nothing', () => {
    const { res, setRows } = preview([
      { exercise: 'Incline Press', set_number: 1, weight: '60', reps: '11' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.applied).toBe(false);

    const change = res.data.changes[0];
    expect(change.before.weight).toBe('55');
    expect(change.before.reps).toBe('12');
    expect(change.after.weight).toBe('60');
    expect(change.after.reps).toBe('11');

    // The sheet is untouched.
    expect(setRows[3][7]).toBe('55');
    expect(setRows[3][8]).toBe('12');
  });

  it('carries the current values, so a dry run can show them', () => {
    const { res } = preview([{ exercise: 'Incline Press', set_number: 1, effort: 'Hard' }]);
    const change = res.data.changes[0];
    expect(change.before).toHaveProperty('planned_reps');
    expect(change.before).toHaveProperty('effort');
    expect(change.after.effort).toBe('Hard');
    // Fields not mentioned are carried through unchanged.
    expect(change.after.weight).toBe(change.before.weight);
  });

  it('surfaces the same ambiguity error as a write would', () => {
    const { res } = preview([{ exercise: 'Bench Press', set_number: 1, weight: '190' }]);
    expect(res.error).toMatch(/appears 2 times/);
  });

  it('surfaces the same no-match error as a write would', () => {
    const { res } = preview([{ exercise: 'Bench Press', section: 'cooldown', set_number: 1, reps: '1' }]);
    expect(res.error).toMatch(/No Bench Press in section cooldown/);
  });

  it('requires workout_id and updates', () => {
    const { sandbox } = api();
    expect(callDoGet(sandbox, { action: 'previewSetUpdates', payload: JSON.stringify({ updates: [] }) }).error)
      .toMatch(/payload.workout_id field required/);
    expect(callDoGet(sandbox, { action: 'previewSetUpdates', payload: JSON.stringify({ workout_id: 'w_1' }) }).error)
      .toMatch(/payload.updates field required/);
  });
});
