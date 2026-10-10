import type { TrackerExercise } from './exercise-row';

/**
 * The tracker's list after Sets row `row` was deleted (#394). Every set below
 * it, in any exercise (warmups included), holds one less, as in the sheet; the
 * set that held `row` no longer has one, so it is unsaved. A set above it is
 * unchanged. The shift follows the row alone, never an exercise, order or set
 * number: a row has no other identity.
 *
 * With `drop`, the set that held `row` is taken off instead: for a tracker
 * that did not make the delete (one opened again while it was in flight),
 * where that set is one the user removed elsewhere.
 */
export function shiftTrackerRows(
  list: TrackerExercise[],
  row: number,
  { drop = false }: { drop?: boolean } = {},
): TrackerExercise[] {
  return list.map((ex) => {
    if (!ex.sets.some((s) => s.sheetRow >= row)) return ex;
    const sets = drop ? ex.sets.filter((s) => s.sheetRow !== row) : ex.sets;
    return {
      ...ex,
      sets: sets.map((s) => {
        if (s.sheetRow === row) return { ...s, sheetRow: -1, saved: false };
        if (s.sheetRow > row) return { ...s, sheetRow: s.sheetRow - 1 };
        return s;
      }),
    };
  });
}
