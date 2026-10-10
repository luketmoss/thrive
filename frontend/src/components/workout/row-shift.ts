import type { TrackerExercise } from './exercise-row';

/**
 * The tracker's list after Sets row `row` was deleted (#394). Every set below
 * it, in any exercise (warmups included), holds one less, as in the sheet; the
 * set that held `row` no longer has one, so it is unsaved. A set above it is
 * unchanged. The shift follows the row alone, never an exercise, order or set
 * number: a row has no other identity.
 */
export function shiftTrackerRows(list: TrackerExercise[], row: number): TrackerExercise[] {
  return list.map((ex) => {
    if (!ex.sets.some((s) => s.sheetRow >= row)) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s) => {
        if (s.sheetRow === row) return { ...s, sheetRow: -1, saved: false };
        if (s.sheetRow > row) return { ...s, sheetRow: s.sheetRow - 1 };
        return s;
      }),
    };
  });
}
