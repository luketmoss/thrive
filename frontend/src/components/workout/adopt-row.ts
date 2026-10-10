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
 * workout's rows: same exercise and set number, a row **no card in the list
 * holds** (a duplicate's twin holds its own, so it is never taken), and the
 * same section or the same order, as `saveSet`'s own-row check requires.
 * Of several, the closest match wins (section and order, then section, then
 * order), then the lowest row.
 */
export function unclaimedRowFor(
  list: TrackerExercise[],
  workoutId: string,
  ex: TrackerExercise,
  set: TrackerSet,
  rows: SetWithRow[],
): number {
  const claimed = new Set<number>();
  for (const e of list) for (const s of e.sets) if (s.sheetRow > 0) claimed.add(s.sheetRow);

  let best: { row: number; score: number } | null = null;
  for (const r of rows) {
    if (r.sheetRow <= 0 || claimed.has(r.sheetRow)) continue;
    if (r.workout_id !== workoutId || r.exercise_id !== ex.exercise_id || r.set_number !== set.set_number) continue;
    const score = (r.section === ex.section ? 2 : 0) + (r.exercise_order === ex.exercise_order ? 1 : 0);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && r.sheetRow < best.row)) {
      best = { row: r.sheetRow, score };
    }
  }
  return best ? best.row : -1;
}
