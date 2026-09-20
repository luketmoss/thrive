import { describe, it, expect } from 'vitest';
import { setToRow, workoutToRow } from './workouts-api';
import { templateRowValues } from './templates-api';
import type { WorkoutSet, Workout } from './types';

function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    workout_id: 'w_001',
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 2,
    set_number: 3,
    planned_reps: '8',
    weight: '185',
    reps: '8',
    effort: 'Medium',
    ...overrides,
  };
}

// Issue #100 — the Sets tab is A:J; column K "Notes" was removed as dead.
describe('setToRow', () => {
  it('emits exactly ten cells, spanning A:J', () => {
    expect(setToRow(makeSet())).toHaveLength(10);
  });

  it('emits the columns in sheet order', () => {
    expect(setToRow(makeSet())).toEqual([
      'w_001', 'ex1', 'Bench Press', 'primary', 2, 3, '8', '185', '8', 'Medium',
    ]);
  });

  it('round-trips an unset effort as an empty cell rather than dropping it', () => {
    const row = setToRow(makeSet({ effort: '' }));
    expect(row).toHaveLength(10);
    expect(row[9]).toBe('');
  });

  // AC4: a queue entry serialized under the old shape still writes A:J.
  it('ignores a stale notes property left on an offline-queue payload', () => {
    const stale = { ...makeSet(), notes: 'written by a previous version' } as WorkoutSet;
    expect(setToRow(stale)).toEqual(setToRow(makeSet()));
  });
});

// Issue #100 — the Templates tab is A:H; columns I/J were removed as dead.
// sheetsAppend writes every value it is handed regardless of the range it is
// given, so a row wider than eight cells would rewrite the deleted columns.
describe('templateRowValues', () => {
  const row = {
    template_id: 'tpl_001',
    template_name: 'Upper Push A',
    order: 1,
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    sets: '5',
    reps: '6',
  };

  it('emits exactly eight cells, spanning A:H', () => {
    expect(templateRowValues(row)).toHaveLength(8);
  });

  it('emits the columns in sheet order', () => {
    expect(templateRowValues(row)).toEqual([
      'tpl_001', 'Upper Push A', 1, 'ex1', 'Bench Press', 'primary', '5', '6',
    ]);
  });
});

// Issue #128 — the Workouts tab is A:Z: eleven original columns, six nullable
// activity attributes (#101) and nine sync provenance columns.
describe('workoutToRow', () => {
  const workout: Workout = {
    id: 'w_001',
    date: '2026-03-15',
    time: '07:00',
    type: 'weight',
    name: 'Upper Push A',
    template_id: 'tpl_001',
    notes: 'Felt strong',
    elapsed_seconds: '3720',
    created: '2026-03-15T07:00:00.000Z',
    copied_from: '',
    status: '',
    moving_seconds: '',
    effort: '',
    distance_m: '',
    ascent_m: '',
    descent_m: '',
    avg_hr: '',
    sub_type: '',
    source: '',
    source_activity_id: '',
    raw_ref: '',
    fit_ref: '',
    fit_fetched_at: '',
    synced_at: '',
    started_at_utc: '',
    calories: '',
  };

  // AC2: sheetsAppend writes every value it is handed regardless of the range,
  // so a short row would leave stale cells behind on an edit.
  it('emits exactly twenty-six cells, spanning A:Z', () => {
    expect(workoutToRow(workout)).toHaveLength(26);
  });

  it('keeps Created, copied_from and status at I, J, K so they do not shift', () => {
    const row = workoutToRow(workout);
    expect(row[7]).toBe('3720');                        // H Elapsed (s)
    expect(row[8]).toBe('2026-03-15T07:00:00.000Z');    // I Created
    expect(row[9]).toBe('');                            // J copied_from
    expect(row[10]).toBe('');                           // K status
  });

  // #101 AC1: the activity attributes ship empty and are never defaulted.
  it('writes the six activity attributes as empty cells, never as 0', () => {
    expect(workoutToRow(workout).slice(11, 17)).toEqual(['', '', '', '', '', '']);
  });

  // AC2: positions 17-25 must be '' rather than undefined — a row of undefined
  // would write the string "undefined" into R:Z.
  it('writes the nine sync columns as empty strings, never undefined', () => {
    const row = workoutToRow(workout);
    expect(row.slice(17)).toEqual(['', '', '', '', '', '', '', '', '']);
    for (const cell of row) expect(cell).not.toBeUndefined();
  });

  it('keeps sub_type at R and calories at Z', () => {
    const row = workoutToRow({
      ...workout,
      sub_type: 'gravel',
      source: 'coros',
      source_activity_id: '4821',
      started_at_utc: '2026-03-15T07:00:00-06:00',
      calories: '612',
    });
    expect(row[17]).toBe('gravel');                      // R sub_type
    expect(row[18]).toBe('coros');                       // S source
    expect(row[19]).toBe('4821');                        // T source_activity_id
    expect(row[24]).toBe('2026-03-15T07:00:00-06:00');   // Y started_at_utc
    expect(row[25]).toBe('612');                         // Z calories
  });
});
