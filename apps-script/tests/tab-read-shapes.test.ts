// #134 AC6 — each tab's documented range comes back whole, with unset as ''
// and no stale column K on Sets. Plus exercise history as an action rather
// than a client-side filter over whole ranges.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, exerciseRow, templateRow, setRow, workoutRow } from './apps-script-sandbox';

describe('AC6: Exercises A2:E', () => {
  it('returns all five columns', () => {
    const { sandbox } = loadApi({ exercises: [exerciseRow({ id: 'ex_1' })] });
    const [e] = callDoGet<any[]>(sandbox, { action: 'getExercises' }).data;
    expect(Object.keys(e).sort()).toEqual(
      ['created', 'id', 'name', 'notes', 'sheetRow', 'tags'].sort()
    );
  });

  it('reads an unset cell as an empty string', () => {
    const { sandbox } = loadApi({ exercises: [exerciseRow({ notes: '', created: '' })] });
    const [e] = callDoGet<any[]>(sandbox, { action: 'getExercises' }).data;
    expect(e.notes).toBe('');
    expect(e.created).toBe('');
  });

  it('filters by tag, matching a whole tag rather than a substring', () => {
    const { sandbox } = loadApi({
      exercises: [
        exerciseRow({ id: 'ex_1', name: 'Bench', tags: 'Push,Chest' }),
        exerciseRow({ id: 'ex_2', name: 'Row', tags: 'Pull,Back' }),
        exerciseRow({ id: 'ex_3', name: 'Pushdown', tags: 'Pushdown' }),
      ],
    });
    const res = callDoGet<any[]>(sandbox, { action: 'getExercises', tag: 'Push' });
    expect(res.data.map((e) => e.id)).toEqual(['ex_1']);
  });

  it('creates with a generated id and a created stamp', () => {
    const api = loadApi({}, { now: new Date('2026-09-20T15:00:00Z'), uuids: ['abcdef1234'] });
    const res = callDoGet<any>(api.sandbox, {
      action: 'createExercise',
      payload: JSON.stringify({ data: { name: 'Bench Press', tags: 'Push' } }),
    });
    expect(res.success).toBe(true);
    expect(res.data.id).toMatch(/^ex_/);
    expect(res.data.created).toBe('2026-09-20T15:00:00.000Z');
    expect(api.exerciseRows[0]).toHaveLength(5);
  });

  it('requires a name', () => {
    const { sandbox } = loadApi({});
    const res = callDoGet(sandbox, { action: 'createExercise', payload: JSON.stringify({ data: {} }) });
    expect(res.error).toMatch(/name is required/);
  });
});

describe('AC6: Templates A2:H', () => {
  const TEMPLATES = () => [
    templateRow({ template_id: 'tpl_b', template_name: 'Push B', order: 2, exercise_id: 'ex_2', exercise_name: 'Incline' }),
    templateRow({ template_id: 'tpl_b', template_name: 'Push B', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench' }),
    templateRow({ template_id: 'tpl_a', template_name: 'Push A', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench' }),
  ];

  it('returns all eight columns on each row', () => {
    const { sandbox } = loadApi({ templates: TEMPLATES() });
    const [tpl] = callDoGet<any[]>(sandbox, { action: 'getTemplates' }).data;
    expect(Object.keys(tpl.exercises[0]).sort()).toEqual(
      ['exercise_id', 'exercise_name', 'order', 'reps', 'section', 'sets', 'sheetRow',
        'template_id', 'template_name'].sort()
    );
  });

  it('groups rows into templates, sorted by name', () => {
    const { sandbox } = loadApi({ templates: TEMPLATES() });
    const res = callDoGet<any[]>(sandbox, { action: 'getTemplates' });
    expect(res.data.map((t) => t.name)).toEqual(['Push A', 'Push B']);
  });

  it('orders a template exercises by order, not by sheet position', () => {
    const { sandbox } = loadApi({ templates: TEMPLATES() });
    const res = callDoGet<any[]>(sandbox, { action: 'getTemplates' });
    const pushB = res.data.find((t) => t.name === 'Push B');
    expect(pushB.exercises.map((e: any) => e.order)).toEqual([1, 2]);
  });

  it('collapses a rep range to its top end, as the app does', () => {
    const { sandbox } = loadApi({ templates: [templateRow({ reps: '4-6', sets: '3-4' })] });
    const [tpl] = callDoGet<any[]>(sandbox, { action: 'getTemplates' }).data;
    expect(tpl.exercises[0].reps).toBe('6');
    expect(tpl.exercises[0].sets).toBe('4');
  });

  it('writes the library name on create, never the caller copy', () => {
    const api = loadApi({ exercises: [exerciseRow({ id: 'ex_1', name: 'Bench Press BB' })] });
    const res = callDoGet<any>(api.sandbox, {
      action: 'createTemplate',
      payload: JSON.stringify({
        data: { name: 'Push A', exercises: [{ exercise: 'ex_1', exercise_name: 'Stale Name', section: 'primary', sets: 3, reps: '6' }] },
      }),
    });
    expect(res.success).toBe(true);
    expect(api.templateRows[0][4]).toBe('Bench Press BB');
    expect(api.templateRows[0]).toHaveLength(8);
  });

  it('replaces a template wholesale, deleting bottom-to-top', () => {
    const api = loadApi({
      exercises: [exerciseRow({ id: 'ex_1', name: 'Bench' }), exerciseRow({ id: 'ex_2', name: 'Incline' })],
      templates: [
        templateRow({ template_id: 'tpl_a', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench' }),
        templateRow({ template_id: 'tpl_a', order: 2, exercise_id: 'ex_2', exercise_name: 'Incline' }),
        templateRow({ template_id: 'tpl_b', template_name: 'Other', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench' }),
      ],
    });
    const res = callDoGet<any>(api.sandbox, {
      action: 'replaceTemplate',
      payload: JSON.stringify({
        template_id: 'tpl_a',
        data: { name: 'Push A', exercises: [{ exercise: 'ex_2', section: 'primary', sets: 5, reps: '5' }] },
      }),
    });
    expect(res.success).toBe(true);
    // One row for tpl_a, and tpl_b untouched.
    const ids = api.templateRows.map((r) => r[0]);
    expect(ids.filter((i) => i === 'tpl_a')).toHaveLength(1);
    expect(ids.filter((i) => i === 'tpl_b')).toHaveLength(1);
  });

  it('refuses an invalid section and an unresolvable exercise', () => {
    const api = loadApi({ exercises: [exerciseRow({ id: 'ex_1', name: 'Bench' })] });
    expect(callDoGet(api.sandbox, {
      action: 'createTemplate',
      payload: JSON.stringify({ data: { name: 'T', exercises: [{ exercise: 'ex_1', section: 'finisher', sets: 3, reps: '6' }] } }),
    }).error).toMatch(/invalid section "finisher"/);

    expect(callDoGet(api.sandbox, {
      action: 'createTemplate',
      payload: JSON.stringify({ data: { name: 'T', exercises: [{ exercise: 'Nope', section: 'primary', sets: 3, reps: '6' }] } }),
    }).error).toMatch(/No exercise matching "Nope"/);
  });
});

describe('AC6: Sets A2:J, ten cells and no column K', () => {
  it('returns all ten columns', () => {
    const { sandbox } = loadApi({ sets: [setRow()] });
    const [s] = callDoGet<any[]>(sandbox, { action: 'getSets' }).data;
    expect(Object.keys(s).sort()).toEqual(
      ['effort', 'exercise_id', 'exercise_name', 'exercise_order', 'planned_reps',
        'reps', 'section', 'set_number', 'sheetRow', 'weight', 'workout_id'].sort()
    );
  });

  it('reads unset weight, reps and effort as empty strings', () => {
    const { sandbox } = loadApi({ sets: [setRow({ weight: '', reps: '', effort: '' })] });
    const [s] = callDoGet<any[]>(sandbox, { action: 'getSets' }).data;
    expect(s.weight).toBe('');
    expect(s.reps).toBe('');
    expect(s.effort).toBe('');
  });

  it('appends exactly ten cells', () => {
    const api = loadApi({});
    const res = callDoGet<any[]>(api.sandbox, {
      action: 'appendSets',
      payload: JSON.stringify({
        sets: [{ workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '6', weight: '', reps: '', effort: '' }],
      }),
    });
    expect(res.success).toBe(true);
    expect(api.setRows[0]).toHaveLength(10);
  });

  it('drops a stale eleventh field rather than writing column K back', () => {
    const api = loadApi({});
    callDoGet(api.sandbox, {
      action: 'appendSets',
      payload: JSON.stringify({
        sets: [{ workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '6', notes: 'from an older shape' }],
      }),
    });
    expect(api.setRows[0]).toHaveLength(10);
    expect(api.setRows[0]).not.toContain('from an older shape');
  });

  it('filters by workout', () => {
    const { sandbox } = loadApi({
      sets: [setRow({ workout_id: 'w_1' }), setRow({ workout_id: 'w_2' })],
    });
    const res = callDoGet<any[]>(sandbox, { action: 'getSets', workout_id: 'w_2' });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].workout_id).toBe('w_2');
  });
});

describe('AC6: exercise history is served by an action', () => {
  const api = () => loadApi({
    exercises: [exerciseRow({ id: 'ex_bench', name: 'Bench Press' })],
    workouts: [
      workoutRow({ id: 'w_1', date: '2026-09-01', name: 'Push A' }),
      workoutRow({ id: 'w_2', date: '2026-09-15', name: 'Push B' }),
    ],
    sets: [
      setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', set_number: 1, weight: '175', reps: '6' }),
      setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', set_number: 2, weight: '175', reps: '5' }),
      setRow({ workout_id: 'w_2', exercise_id: 'ex_bench', set_number: 1, weight: '185', reps: '6' }),
      setRow({ workout_id: 'w_2', exercise_id: 'ex_other', exercise_name: 'Row', set_number: 1 }),
    ],
  });

  it('returns sessions newest first, with the sets of each', () => {
    const res = callDoGet<any>(api().sandbox, { action: 'getExerciseHistory', ref: 'Bench Press' });
    expect(res.success).toBe(true);
    expect(res.data.exercise).toEqual({ id: 'ex_bench', name: 'Bench Press' });
    expect(res.data.history.map((h: any) => h.date)).toEqual(['2026-09-15', '2026-09-01']);
    expect(res.data.history[1].sets).toHaveLength(2);
  });

  it('carries the workout name and date, so no second call is needed', () => {
    const res = callDoGet<any>(api().sandbox, { action: 'getExerciseHistory', ref: 'Bench Press' });
    expect(res.data.history[0].workout_name).toBe('Push B');
    expect(res.data.history[0].workout_id).toBe('w_2');
  });

  it('excludes other exercises', () => {
    const res = callDoGet<any>(api().sandbox, { action: 'getExerciseHistory', ref: 'Bench Press' });
    const ids = res.data.history.flatMap((h: any) => h.sets.map((s: any) => s.exercise_id));
    expect(new Set(ids)).toEqual(new Set(['ex_bench']));
  });

  it('honours a limit', () => {
    const res = callDoGet<any>(api().sandbox, { action: 'getExerciseHistory', ref: 'Bench Press', limit: '1' });
    expect(res.data.history).toHaveLength(1);
    expect(res.data.history[0].date).toBe('2026-09-15');
  });

  it('requires a ref and reports an unresolvable one', () => {
    expect(callDoGet(api().sandbox, { action: 'getExerciseHistory' }).error)
      .toMatch(/ref parameter required/);
    expect(callDoGet(api().sandbox, { action: 'getExerciseHistory', ref: 'Zercher' }).error)
      .toMatch(/No exercise matching "Zercher"/);
  });
});
