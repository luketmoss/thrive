import { describe, it, expect } from 'vitest';
import { shiftTrackerRows } from './row-shift';
import type { TrackerExercise } from './exercise-row';

const ex = (id: string, order: number, section: string, rows: number[]): TrackerExercise => ({
  exercise_id: id, exercise_name: id, section, exercise_order: order, rowKey: `${id}-${order}`,
  quickFillWeight: '', quickFillReps: '', quickFillEffort: '',
  sets: rows.map((r, i) => ({
    set_number: i + 1, planned_reps: '', weight: '1', reps: '1', effort: '', saved: r > 0, sheetRow: r,
  })),
});
const view = (list: TrackerExercise[]) => list.map((e) => e.sets.map((s) => [s.sheetRow, s.saved]));

describe('shiftTrackerRows (#394)', () => {
  it('unsaves the deleted row\'s set, gives every row below one less, and leaves rows above alone', () => {
    const list = [
      ex('bike', 1, 'warmup', [7]),
      ex('bench', 2, 'primary', [2, 3, 4]),
      ex('bench', 3, 'SS1', [5, -1]),
    ];
    expect(view(shiftTrackerRows(list, 3))).toEqual([
      [[6, true]],
      [[2, true], [-1, false], [3, true]],
      [[4, true], [-1, false]],
    ]);
  });

  it('returns untouched exercises as the same objects', () => {
    const list = [ex('bench', 1, 'primary', [2]), ex('row', 2, 'primary', [5])];
    const out = shiftTrackerRows(list, 4);
    expect(out[0]).toBe(list[0]);
    expect(out[1].sets[0].sheetRow).toBe(4);
  });
});

describe('shiftTrackerRows with drop (#394)', () => {
  it('takes off the set that held the row and shifts the rest', () => {
    const list = [ex('bench', 1, 'primary', [2, 3, 4])];
    expect(view(shiftTrackerRows(list, 3, { drop: true }))).toEqual([[[2, true], [3, true]]]);
  });
});
