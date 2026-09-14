import { describe, it, expect } from 'vitest';
import { plannedWeightsFor } from './planned-weights';
import type { WorkoutSet } from '../../api/types';

function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    workout_id: 'w1',
    exercise_id: 'ex_bench',
    exercise_name: 'Bench Press BB',
    section: 'primary',
    exercise_order: 2,
    set_number: 1,
    planned_reps: '8',
    weight: '',
    reps: '',
    effort: '',
    ...overrides,
  };
}

const ramp = [
  makeSet({ set_number: 1, weight: '95' }),
  makeSet({ set_number: 2, weight: '115' }),
  makeSet({ set_number: 3, weight: '135' }),
];

describe('plannedWeightsFor (#118 AC5)', () => {
  it('keeps every prescribed load when the set count is unchanged', () => {
    expect(plannedWeightsFor(ramp, 'ex_bench', 'primary', 3)).toEqual(['95', '115', '135']);
  });

  it('leaves a newly added set blank', () => {
    expect(plannedWeightsFor(ramp, 'ex_bench', 'primary', 4)).toEqual(['95', '115', '135', '']);
  });

  it('drops loads for sets that were removed', () => {
    expect(plannedWeightsFor(ramp, 'ex_bench', 'primary', 2)).toEqual(['95', '115']);
  });

  it('keeps a bodyweight "0" distinct from blank', () => {
    const bw = [makeSet({ exercise_id: 'ex_pushup', section: 'SS2', weight: '0' })];
    expect(plannedWeightsFor(bw, 'ex_pushup', 'SS2', 1)).toEqual(['0']);
  });

  it('does not borrow loads from the same lift in another section', () => {
    const warmup = [makeSet({ section: 'warmup', exercise_order: 1, weight: '45' })];
    expect(plannedWeightsFor([...warmup, ...ramp], 'ex_bench', 'warmup', 1)).toEqual(['45']);
    expect(plannedWeightsFor(warmup, 'ex_bench', 'primary', 3)).toBeUndefined();
  });

  it('returns undefined when nothing was prescribed, so saves behave as before', () => {
    const blank = [makeSet({ set_number: 1 }), makeSet({ set_number: 2 })];
    expect(plannedWeightsFor(blank, 'ex_bench', 'primary', 2)).toBeUndefined();
  });
});
