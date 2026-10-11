import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { SetWithRow } from '../../api/types';

/**
 * The sheet row a tracker set with no row already has, or -1 (#389).
 *
 * A set's append can land without the tracker hearing of it: an offline
 * save is queued, and `flushQueue` appends it later and refreshes
 * `activeWorkoutSets` only. Saving the set again as an append would add a
 * second row. So before appending, look for this set's row among the
 * workout's rows with the same exercise and set number that **no card in the
 * list holds** (a duplicate's twin holds its own, so it is never taken):
 *
 * - When no other card has a set of the same exercise and number with no
 *   row, an unclaimed row can only be this set's: take the one with the same
 *   section or the same order (as `saveSet`'s own-row check requires),
 *   closest match first (section and order, then section, then order), then
 *   the lowest row.
 * - When another card does, the unclaimed row may be THAT set's flushed
 *   append, and the section cannot tell them apart (same-section duplicates).
 *   Take a row only as main's lookup by order would: the single unclaimed row
 *   at this card's current order. Otherwise append, as before.
 */
export function unclaimedRowFor(
  list: TrackerExercise[],
  workoutId: string,
  ex: TrackerExercise,
  set: TrackerSet,
  rows: SetWithRow[],
): number {
  const sameCard = (e: TrackerExercise) => e === ex || (!!ex.rowKey && e.rowKey === ex.rowKey);
  const claimed = new Set<number>();
  let contested = false;
  for (const e of list) {
    for (const s of e.sets) {
      if (s.sheetRow > 0) claimed.add(s.sheetRow);
      else if (!sameCard(e) && e.exercise_id === ex.exercise_id && s.set_number === set.set_number) {
        contested = true;
      }
    }
  }

  const candidates = rows.filter((r) =>
    r.sheetRow > 0 && !claimed.has(r.sheetRow) &&
    r.workout_id === workoutId && r.exercise_id === ex.exercise_id && r.set_number === set.set_number,
  );

  if (contested) {
    const atOrder = candidates.filter((r) => r.exercise_order === ex.exercise_order);
    return atOrder.length === 1 ? atOrder[0].sheetRow : -1;
  }

  let best: { row: number; score: number } | null = null;
  for (const r of candidates) {
    const score = (r.section === ex.section ? 2 : 0) + (r.exercise_order === ex.exercise_order ? 1 : 0);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && r.sheetRow < best.row)) {
      best = { row: r.sheetRow, score };
    }
  }
  return best ? best.row : -1;
}
