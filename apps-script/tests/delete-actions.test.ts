// #132 AC6 — the API can delete a workout (with its sets) and an exercise,
// addressed by id. These replace the MCP server's last row-index writes.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, setRow, exerciseRow, templateRow } from './apps-script-sandbox';

function del(action: string, id: string | undefined, fixtures: Parameters<typeof loadApi>[0]) {
  const api = loadApi(fixtures);
  const res = callDoGet<any>(api.sandbox, {
    action,
    payload: JSON.stringify(id === undefined ? {} : { id }),
  });
  return { ...api, res };
}

describe('AC6: deleteWorkout', () => {
  const fixtures = () => ({
    workouts: [
      workoutRow({ id: 'w_1', name: 'Push A' }),
      workoutRow({ id: 'w_2', name: 'Pull A' }),
      workoutRow({ id: 'w_3', name: 'Legs A' }),
    ],
    // w_2's sets are interleaved with other workouts' on purpose: bottom-to-top
    // deletion is only exercised when the rows to remove are not contiguous.
    sets: [
      setRow({ workout_id: 'w_1', set_number: 1 }),
      setRow({ workout_id: 'w_2', set_number: 1 }),
      setRow({ workout_id: 'w_3', set_number: 1 }),
      setRow({ workout_id: 'w_2', set_number: 2 }),
      setRow({ workout_id: 'w_1', set_number: 2 }),
      setRow({ workout_id: 'w_2', set_number: 3 }),
    ],
  });

  it('removes the workout row and every one of its sets', () => {
    const { res, rows, setRows } = del('deleteWorkout', 'w_2', fixtures());
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ workout_id: 'w_2', sets_deleted: 3 });
    expect(rows.map((r) => r[0])).toEqual(['w_1', 'w_3']);
    expect(setRows.every((r) => r[0] !== 'w_2')).toBe(true);
  });

  // The failure bottom-to-top prevents: deleting ascending, each removal
  // shifts the next target up a row, and the wrong sets go.
  it('leaves every other workout\'s sets intact and in order', () => {
    const { setRows } = del('deleteWorkout', 'w_2', fixtures());
    expect(setRows.map((r) => `${r[0]}#${r[5]}`)).toEqual(['w_1#1', 'w_3#1', 'w_1#2']);
  });

  it('deletes a workout that has no sets', () => {
    const { res, rows } = del('deleteWorkout', 'w_1', {
      workouts: [workoutRow({ id: 'w_1' }), workoutRow({ id: 'w_2' })],
      sets: [],
    });
    expect(res.data.sets_deleted).toBe(0);
    expect(rows.map((r) => r[0])).toEqual(['w_2']);
  });

  it('refuses an unknown id rather than treating it as success', () => {
    const { res, rows, setRows } = del('deleteWorkout', 'w_nope', fixtures());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Workout "w_nope" not found/);
    expect(rows).toHaveLength(3);
    expect(setRows).toHaveLength(6);
  });

  it('requires an id', () => {
    expect(del('deleteWorkout', undefined, fixtures()).res.error).toMatch(/payload.id field required/);
  });
});

describe('AC6: deleteExercise', () => {
  const fixtures = () => ({
    exercises: [
      exerciseRow({ id: 'ex_1', name: 'Bench Press' }),
      exerciseRow({ id: 'ex_2', name: 'Row' }),
    ],
    templates: [templateRow({ exercise_id: 'ex_1', exercise_name: 'Bench Press' })],
    sets: [setRow({ exercise_id: 'ex_1', exercise_name: 'Bench Press' })],
  });

  it('removes only the library row', () => {
    const { res, exerciseRows } = del('deleteExercise', 'ex_1', fixtures());
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ id: 'ex_1', name: 'Bench Press' });
    expect(exerciseRows.map((r) => r[0])).toEqual(['ex_2']);
  });

  // Matching the tool's force_when_in_use semantics: orphaning is a decision
  // the caller already made, so the referencing rows stay exactly as they were.
  it('leaves referencing template and set rows in place', () => {
    const { templateRows, setRows } = del('deleteExercise', 'ex_1', fixtures());
    expect(templateRows).toHaveLength(1);
    expect(templateRows[0][3]).toBe('ex_1');
    expect(setRows).toHaveLength(1);
    expect(setRows[0][2]).toBe('Bench Press');
  });

  it('refuses an unknown id', () => {
    const { res, exerciseRows } = del('deleteExercise', 'ex_nope', fixtures());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Exercise "ex_nope" not found/);
    expect(exerciseRows).toHaveLength(2);
  });

  // By id only, never by name — a delete must not be a fuzzy match.
  it('does not resolve a name as if it were an id', () => {
    const { res, exerciseRows } = del('deleteExercise', 'Bench Press', fixtures());
    expect(res.success).toBe(false);
    expect(exerciseRows).toHaveLength(2);
  });

  it('requires an id', () => {
    expect(del('deleteExercise', undefined, fixtures()).res.error).toMatch(/payload.id field required/);
  });
});
