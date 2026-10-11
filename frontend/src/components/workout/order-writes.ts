import type { TrackerExercise } from './exercise-row';
import type { SetWithRow } from '../../api/types';
import type { SetOrderWrite } from '../../api/workouts-api';
import type { QueuedOrderMap } from '../../api/sync-queue';

/**
 * The `Sets!E` and `Sets!D` writes that bring a live workout's saved rows to
 * the order (#392) and section (#395) the tracker shows: every set the
 * tracker holds a row for (warmups included) whose stored order or section,
 * as `stored` (`activeWorkoutSets`) last recorded it, differs from its
 * exercise's now. A write names only the column(s) that differ. Not only the
 * exercises a move or a section change just touched, so a write that failed
 * or was overtaken earlier is repaired by the next one.
 *
 * Matched by row alone, never by exercise and order: a row has no other
 * identity. A row is written only when memory holds this workout's set of the
 * same exercise and set number there, so a stale row is never written to.
 */
export function orderWrites(
  list: TrackerExercise[],
  stored: SetWithRow[],
  workoutId: string,
): SetOrderWrite[] {
  const byRow = new Map(stored.map((s) => [s.sheetRow, s]));
  const out = new Map<number, SetOrderWrite>();
  for (const ex of list) {
    for (const s of ex.sets) {
      if (!(s.sheetRow > 0) || out.has(s.sheetRow)) continue;
      const at = byRow.get(s.sheetRow);
      if (
        at &&
        at.workout_id === workoutId &&
        at.exercise_id === ex.exercise_id &&
        at.set_number === s.set_number &&
        (at.exercise_order !== ex.exercise_order || at.section !== ex.section)
      ) {
        out.set(s.sheetRow, {
          sheetRow: s.sheetRow,
          ...(at.exercise_order !== ex.exercise_order ? { exercise_order: ex.exercise_order } : {}),
          ...(at.section !== ex.section ? { section: ex.section } : {}),
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.sheetRow - b.sheetRow);
}

/**
 * Where each of the tracker's sets now sits, for the offline queue (#392
 * AC5, #395 AC3): by row for a set that has one (order and section), and, for
 * `before` → `after`, each card whose order changed (a move) or whose section
 * changed, for queued sets with no row.
 */
export function queuedOrderMap(
  after: TrackerExercise[],
  before: TrackerExercise[] = after,
): QueuedOrderMap {
  const byRow: QueuedOrderMap['byRow'] = new Map();
  for (const ex of after) {
    for (const s of ex.sets) {
      if (s.sheetRow > 0) {
        byRow.set(s.sheetRow, {
          exercise_id: ex.exercise_id,
          set_number: s.set_number,
          exercise_order: ex.exercise_order,
          section: ex.section,
        });
      }
    }
  }
  const moves: QueuedOrderMap['moves'] = [];
  const sections: NonNullable<QueuedOrderMap['sections']> = [];
  for (const ex of after) {
    const was = ex.rowKey ? before.find((b) => b.rowKey === ex.rowKey) : undefined;
    if (!was) continue;
    if (was.exercise_order !== ex.exercise_order) {
      moves.push({ exercise_id: ex.exercise_id, from: was.exercise_order, to: ex.exercise_order });
    }
    if (was.section !== ex.section) {
      sections.push({ exercise_id: ex.exercise_id, exercise_order: ex.exercise_order, section: ex.section });
    }
  }
  return { byRow, moves, sections };
}
