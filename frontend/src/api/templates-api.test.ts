import { describe, it, expect } from 'vitest';
import { groupTemplateRows } from './templates-api';
import type { TemplateRowWithRow } from './types';

function makeRow(overrides: Partial<TemplateRowWithRow> = {}): TemplateRowWithRow {
  return {
    template_id: 'tpl_001',
    template_name: 'Upper Push A',
    order: 1,
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    sets: '4',
    reps: '8-10',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    sheetRow: 2,
    ...overrides,
  };
}

describe('groupTemplateRows', () => {
  it('returns empty array for empty input', () => {
    expect(groupTemplateRows([])).toEqual([]);
  });

  it('groups rows by template_id into Template objects', () => {
    const rows: TemplateRowWithRow[] = [
      makeRow({ template_id: 'tpl_001', template_name: 'Push A', order: 1, exercise_id: 'ex1', exercise_name: 'Bench', sheetRow: 2 }),
      makeRow({ template_id: 'tpl_001', template_name: 'Push A', order: 2, exercise_id: 'ex2', exercise_name: 'Fly', sheetRow: 3 }),
      makeRow({ template_id: 'tpl_002', template_name: 'Pull A', order: 1, exercise_id: 'ex3', exercise_name: 'Row', sheetRow: 4 }),
    ];

    const templates = groupTemplateRows(rows);
    expect(templates).toHaveLength(2);

    const push = templates.find((t) => t.id === 'tpl_001');
    expect(push).toBeDefined();
    expect(push!.name).toBe('Push A');
    expect(push!.exercises).toHaveLength(2);

    const pull = templates.find((t) => t.id === 'tpl_002');
    expect(pull).toBeDefined();
    expect(pull!.name).toBe('Pull A');
    expect(pull!.exercises).toHaveLength(1);
  });

  it('sorts templates by name alphabetically', () => {
    const rows: TemplateRowWithRow[] = [
      makeRow({ template_id: 'tpl_z', template_name: 'Zzz Workout', order: 1, sheetRow: 2 }),
      makeRow({ template_id: 'tpl_a', template_name: 'Aaa Workout', order: 1, sheetRow: 3 }),
      makeRow({ template_id: 'tpl_m', template_name: 'Mmm Workout', order: 1, sheetRow: 4 }),
    ];

    const templates = groupTemplateRows(rows);
    expect(templates.map((t) => t.name)).toEqual(['Aaa Workout', 'Mmm Workout', 'Zzz Workout']);
  });

  it('sorts exercises within a template by order', () => {
    const rows: TemplateRowWithRow[] = [
      makeRow({ order: 3, exercise_id: 'ex3', exercise_name: 'Fly', sheetRow: 4 }),
      makeRow({ order: 1, exercise_id: 'ex1', exercise_name: 'Bench', sheetRow: 2 }),
      makeRow({ order: 2, exercise_id: 'ex2', exercise_name: 'Press', sheetRow: 3 }),
    ];

    const templates = groupTemplateRows(rows);
    expect(templates[0].exercises.map((e) => e.exercise_name)).toEqual(['Bench', 'Press', 'Fly']);
  });

  it('handles a single template with one exercise', () => {
    const rows: TemplateRowWithRow[] = [
      makeRow(),
    ];

    const templates = groupTemplateRows(rows);
    expect(templates).toHaveLength(1);
    expect(templates[0].exercises).toHaveLength(1);
    expect(templates[0].id).toBe('tpl_001');
  });

  it('preserves all exercise row data', () => {
    const row = makeRow({
      section: 'SS1',
      sets: '3',
      reps: '12-15',
    });
    const templates = groupTemplateRows([row]);
    const exercise = templates[0].exercises[0];

    expect(exercise.section).toBe('SS1');
    expect(exercise.sets).toBe('3');
    expect(exercise.reps).toBe('12-15');
    expect(exercise.sheetRow).toBe(2);
  });

  it('groups demo template rows correctly', () => {
    // Simulate a realistic multi-exercise template
    const rows: TemplateRowWithRow[] = [
      makeRow({ template_id: 'tpl_001', template_name: 'Upper Push', order: 1, exercise_name: 'Push Ups', section: 'warmup', sets: '', sheetRow: 2 }),
      makeRow({ template_id: 'tpl_001', template_name: 'Upper Push', order: 2, exercise_name: 'Bench Warmup', section: 'warmup', sets: '', sheetRow: 3 }),
      makeRow({ template_id: 'tpl_001', template_name: 'Upper Push', order: 3, exercise_name: 'Bench Press', section: 'primary', sets: '4-5', sheetRow: 4 }),
      makeRow({ template_id: 'tpl_001', template_name: 'Upper Push', order: 4, exercise_name: 'Incline DB', section: 'SS1', sets: '3', sheetRow: 5 }),
      makeRow({ template_id: 'tpl_001', template_name: 'Upper Push', order: 5, exercise_name: 'Cable Fly', section: 'SS1', sets: '3', sheetRow: 6 }),
    ];

    const templates = groupTemplateRows(rows);
    expect(templates).toHaveLength(1);
    expect(templates[0].exercises).toHaveLength(5);
    expect(templates[0].exercises[0].exercise_name).toBe('Push Ups');
    expect(templates[0].exercises[4].exercise_name).toBe('Cable Fly');
  });
});
