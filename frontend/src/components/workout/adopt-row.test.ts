// #389 — a tracker set with no row takes its row when the offline queue
// already appended it, never a row another card holds.
import { describe, it, expect } from 'vitest';
import { unclaimedRowFor } from './adopt-row';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { SetWithRow } from '../../api/types';

const tset = (n: number, sheetRow: number): TrackerSet => ({
  set_number: n, planned_reps: '', weight: '', reps: '', effort: '', saved: sheetRow > 0, sheetRow,
});
const tex = (section: string, order: number, sets: TrackerSet[], rowKey: string): TrackerExercise => ({
  exercise_id: 'e_row', exercise_name: 'Row BB', section, exercise_order: order, rowKey, sets,
  quickFillWeight: '', quickFillReps: '', quickFillEffort: '',
});
const srow = (section: string, order: number, n: number, sheetRow: number, workout_id = 'w1'): SetWithRow => ({
  workout_id, exercise_id: 'e_row', exercise_name: 'Row BB', section, exercise_order: order,
  set_number: n, planned_reps: '', weight: '1', reps: '', effort: '', sheetRow,
});

const PRIMARY = tex('primary', 1, [tset(1, 2), tset(2, 3)], 'a');
const SS1 = tex('SS1', 2, [tset(1, 4), tset(2, -1)], 'b');
const LIST = [PRIMARY, SS1];
const ROWS = [srow('primary', 1, 1, 2), srow('primary', 1, 2, 3), srow('SS1', 2, 1, 4)];

describe('unclaimedRowFor', () => {
  it('-1 when the set has no row in the sheet', () => {
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], ROWS)).toBe(-1);
  });

  it('takes the flushed row of this set', () => {
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], [...ROWS, srow('SS1', 2, 2, 5)])).toBe(5);
  });

  it('never takes a row a card holds, even one matching on every field', () => {
    // After a move to order 1 the SS1 copy's key matches the primary copy's set 2 (row 3).
    const moved = { ...SS1, exercise_order: 1 };
    expect(unclaimedRowFor([PRIMARY, moved], 'w1', moved, moved.sets[1], ROWS)).toBe(-1);
  });

  it('ignores another workout\'s rows and rows matching neither section nor order', () => {
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], [...ROWS, srow('SS1', 2, 2, 5, 'w0')])).toBe(-1);
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], [...ROWS, srow('SS3', 7, 2, 5)])).toBe(-1);
  });

  it('prefers the closest match, then the lowest row', () => {
    const rows = [...ROWS, srow('SS2', 2, 2, 5), srow('SS1', 9, 2, 6), srow('SS1', 2, 2, 7)];
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], rows)).toBe(7);
    expect(unclaimedRowFor(LIST, 'w1', SS1, SS1.sets[1], rows.slice(0, 5))).toBe(6);
  });
});
