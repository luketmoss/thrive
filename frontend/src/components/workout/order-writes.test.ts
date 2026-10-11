// #392: the order writes and the queue map, from the tracker's list.
import { describe, it, expect } from 'vitest';
import { orderWrites, queuedOrderMap } from './order-writes';
import type { TrackerExercise } from './exercise-row';
import type { SetWithRow } from '../../api/types';

const ex = (rowKey: string, exercise_id: string, order: number, rows: number[]): TrackerExercise => ({
  rowKey, exercise_id, exercise_name: exercise_id, section: 'primary', exercise_order: order,
  quickFillWeight: '', quickFillReps: '', quickFillEffort: '',
  sets: rows.map((sheetRow, i) => ({
    set_number: i + 1, planned_reps: '8', weight: '', reps: '', effort: '', saved: sheetRow > 0, sheetRow,
  })),
});
const stored = (w: string, exercise_id: string, order: number, set_number: number, sheetRow: number): SetWithRow => ({
  workout_id: w, exercise_id, exercise_name: exercise_id, section: 'primary', exercise_order: order,
  set_number, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow,
});

describe('orderWrites', () => {
  const STORED = [
    stored('w1', 'bench', 1, 1, 2), stored('w1', 'bench', 1, 2, 3),
    stored('w1', 'row', 2, 1, 4), stored('w1', 'curl', 3, 1, 5),
  ];

  it('every saved row whose stored order differs, by row; nothing else', () => {
    const list = [ex('a', 'bench', 2, [2, 3]), ex('b', 'row', 1, [4]), ex('c', 'curl', 3, [5])];
    expect(orderWrites(list, STORED, 'w1')).toEqual([
      { sheetRow: 2, exercise_order: 2 }, { sheetRow: 3, exercise_order: 2 }, { sheetRow: 4, exercise_order: 1 },
    ]);
  });

  it('nothing when the list matches what is stored, and never a set with no row', () => {
    const list = [ex('a', 'bench', 1, [2, 3, -1]), ex('b', 'row', 2, [4]), ex('c', 'curl', 3, [5])];
    expect(orderWrites(list, STORED, 'w1')).toEqual([]);
  });

  it('never a row memory holds for another workout, exercise or set number', () => {
    const list = [ex('a', 'bench', 9, [4]), ex('b', 'row', 9, [2]), ex('c', 'curl', 9, [-1, 5])];
    expect(orderWrites(list, [...STORED.slice(0, 3), stored('w2', 'curl', 3, 1, 5)], 'w1')).toEqual([]);
  });
});

describe('queuedOrderMap', () => {
  it('maps rows to the order now, and each moved card from its old order to its new', () => {
    const before = [ex('a', 'row', 1, [2]), ex('b', 'row', 2, [-1]), ex('c', 'curl', 3, [4])];
    const after = [ex('a', 'row', 2, [2]), ex('b', 'row', 1, [-1]), ex('c', 'curl', 3, [4])];
    const map = queuedOrderMap(after, before);
    expect([...map.byRow.entries()]).toEqual([
      [2, { exercise_id: 'row', set_number: 1, exercise_order: 2 }],
      [4, { exercise_id: 'curl', set_number: 1, exercise_order: 3 }],
    ]);
    expect(map.moves).toEqual([
      { exercise_id: 'row', from: 1, to: 2 },
      { exercise_id: 'row', from: 2, to: 1 },
    ]);
    expect(queuedOrderMap(after).moves).toEqual([]);
  });
});
