import { describe, it, expect } from 'vitest';
import { workoutToEditInputs, editInputsToPatch, hasEdits } from './edit-patch';
import type { Workout } from '../../api/types';

// Issue #172. The form-level behaviour is in edit-workout-save.test.tsx; this
// pins the helper's contract directly.
const W = {
  date: '2026-09-20', name: 'Ridge Loop', notes: 'Windy', effort: '', sub_type: 'outdoor',
  elapsed_seconds: '343', distance_m: '430', ascent_m: '37', descent_m: '41', avg_hr: '128.4',
} as unknown as Workout;

describe('editInputsToPatch (#172)', () => {
  const initial = workoutToEditInputs(W);

  it('pre-fills through the lossy conversions', () => {
    expect(initial).toMatchObject({ duration: '6', distance: '0.3', ascent: '120', descent: '130', avgHr: '128.4' });
  });

  it('an untouched form is an empty patch, and Discard need not ask', () => {
    expect(editInputsToPatch(initial, { ...initial })).toEqual({});
    expect(hasEdits(initial, { ...initial })).toBe(false);
  });

  it('only the changed inputs appear, converted to stored units', () => {
    expect(editInputsToPatch(initial, { ...initial, ascent: '200', effort: 'Hard' }))
      .toEqual({ ascent_m: '61', effort: 'Hard' });
  });

  it('a cleared input is a blank, never a zero', () => {
    expect(editInputsToPatch(initial, { ...initial, avgHr: '', duration: '' }))
      .toEqual({ avg_hr: '', elapsed_seconds: '' });
  });

  it('a changed name or note is trimmed', () => {
    expect(editInputsToPatch(initial, { ...initial, name: ' Ridge Loop 2 ' })).toEqual({ name: 'Ridge Loop 2' });
  });

  it('an input the form does not have is never written', () => {
    expect(editInputsToPatch(initial, { notes: 'x' })).toEqual({ notes: 'x' });
  });

  it('a blank workout pre-fills blank, never "0" or "null"', () => {
    const blank = workoutToEditInputs({ ...W, elapsed_seconds: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '' });
    expect(blank).toMatchObject({ duration: '', distance: '', ascent: '', descent: '', avgHr: '' });
  });
});
