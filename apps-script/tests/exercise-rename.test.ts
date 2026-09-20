// #134 AC5 — renaming an exercise updates its denormalized copies in
// Templates!E and Sets!C, in the same call.
//
// This is #120: a rename left the copies behind, and a template expanded
// later wrote the *old* name into a fresh workout.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, exerciseRow, templateRow, setRow, workoutRow } from './apps-script-sandbox';

const EXERCISES = () => [
  exerciseRow({ id: 'ex_bench', name: 'Bench Press', tags: 'Push,Chest' }),
  exerciseRow({ id: 'ex_incline', name: 'Incline Press' }),
];

const TEMPLATES = () => [
  templateRow({ template_id: 'tpl_1', order: 1, exercise_id: 'ex_bench', exercise_name: 'Bench Press' }),
  templateRow({ template_id: 'tpl_1', order: 2, exercise_id: 'ex_incline', exercise_name: 'Incline Press' }),
  templateRow({ template_id: 'tpl_2', template_name: 'Push B', order: 1, exercise_id: 'ex_bench', exercise_name: 'Bench Press' }),
];

const SETS = () => [
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', set_number: 1 }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', set_number: 2 }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_incline', exercise_name: 'Incline Press', exercise_order: 2, set_number: 1 }),
  setRow({ workout_id: 'w_2', exercise_id: 'ex_bench', exercise_name: 'Bench Press', set_number: 1 }),
];

function rename(id: string, changes: Record<string, unknown>) {
  const a = loadApi({
    exercises: EXERCISES(), templates: TEMPLATES(), sets: SETS(),
    workouts: [workoutRow({ id: 'w_1' })],
  });
  const res = callDoGet<any>(a.sandbox, {
    action: 'updateExercise',
    payload: JSON.stringify({ id, changes }),
  });
  return { ...a, res };
}

describe('AC5: a rename cascades into the copies', () => {
  it('updates Templates!E for every row of that exercise', () => {
    const { res, templateRows } = rename('ex_bench', { name: 'Bench Press BB' });
    expect(res.success).toBe(true);
    expect(templateRows[0][4]).toBe('Bench Press BB');
    expect(templateRows[2][4]).toBe('Bench Press BB');
  });

  it('updates Sets!C for every row of that exercise', () => {
    const { setRows } = rename('ex_bench', { name: 'Bench Press BB' });
    expect(setRows[0][2]).toBe('Bench Press BB');
    expect(setRows[1][2]).toBe('Bench Press BB');
    expect(setRows[3][2]).toBe('Bench Press BB');
  });

  it('crosses templates and workouts — every copy, not just the first', () => {
    const { res } = rename('ex_bench', { name: 'Bench Press BB' });
    expect(res.data.cascaded).toEqual({ templates: 2, sets: 3 });
  });

  it('leaves other exercises alone', () => {
    const { templateRows, setRows } = rename('ex_bench', { name: 'Bench Press BB' });
    expect(templateRows[1][4]).toBe('Incline Press');
    expect(setRows[2][2]).toBe('Incline Press');
  });

  it('updates the library row itself', () => {
    const { exerciseRows } = rename('ex_bench', { name: 'Bench Press BB' });
    expect(exerciseRows[0][1]).toBe('Bench Press BB');
  });

  it('does not cascade when the name did not change', () => {
    const { res, templateRows } = rename('ex_bench', { tags: 'Push,Chest,Compound' });
    expect(res.success).toBe(true);
    expect(res.data.cascaded).toEqual({ templates: 0, sets: 0 });
    expect(templateRows[0][4]).toBe('Bench Press');
  });

  it('reports zero when the name is set to what it already was', () => {
    const { res } = rename('ex_bench', { name: 'Bench Press' });
    expect(res.data.cascaded).toEqual({ templates: 0, sets: 0 });
  });

  it('updates tags and notes without touching the copies', () => {
    const { res, exerciseRows } = rename('ex_bench', { tags: 'Push', notes: 'Pause at chest' });
    expect(res.success).toBe(true);
    expect(exerciseRows[0][2]).toBe('Push');
    expect(exerciseRows[0][3]).toBe('Pause at chest');
  });
});

describe('AC5: detection matches findStaleExerciseNames', () => {
  it('exposes the same helper the repair script uses', () => {
    const { sandbox } = rename('ex_bench', { tags: 'Push' });
    expect(typeof sandbox.findStaleExerciseNames).toBe('function');
  });

  // The contract: stale is fixable by a name refresh, an orphan never is.
  it('separates a stale name from a row whose id is not in the library', () => {
    const { sandbox } = rename('ex_bench', { tags: 'Push' });
    const result = sandbox.findStaleExerciseNames(
      [
        { exercise_id: 'ex_bench', exercise_name: 'Old Name' },
        { exercise_id: 'ex_bench', exercise_name: 'Bench Press' },
        { exercise_id: 'ex_gone', exercise_name: 'Deleted Lift' },
      ],
      [{ id: 'ex_bench', name: 'Bench Press' }]
    );
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].name).toBe('Bench Press');
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].exercise_id).toBe('ex_gone');
  });
});

describe('AC5: what a rename refuses', () => {
  it('refuses an id that is not there', () => {
    const { res } = rename('ex_nope', { name: 'X' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Exercise "ex_nope" not found/);
  });

  it('refuses to change the id', () => {
    const { res } = rename('ex_bench', { id: 'ex_other' });
    expect(res.error).toMatch(/id cannot be changed/);
  });

  // Created is written and never read — a forensic trail, per CLAUDE.md.
  it('refuses to rewrite created', () => {
    const { res } = rename('ex_bench', { created: '2020-01-01T00:00:00.000Z' });
    expect(res.error).toMatch(/created cannot be changed/);
  });

  it('refuses a field that is not a column', () => {
    const { res } = rename('ex_bench', { muscle_group: 'chest' });
    expect(res.error).toMatch(/Unknown field: "muscle_group"/);
  });
});
