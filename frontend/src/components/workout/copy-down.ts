import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { SetWithRow, Effort } from '../../api/types';

export interface CopyDownResult {
  exercises: TrackerExercise[];
  removedSets: TrackerSet[];
}

/**
 * Apply copy-down from last-time data to a specific exercise's sets.
 * - Copies weight, reps, effort from last-time sets
 * - Adjusts set count to match (adds or removes)
 * - Preserves planned_reps from current sets
 * - Returns updated exercise list + any removed sets (for API cleanup)
 */
export function applyCopyDown(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
  lastTimeSets: SetWithRow[],
): CopyDownResult {
  const removedSets: TrackerSet[] = [];

  const updated = exercises.map((ex) => {
    if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;

    const currentSets = ex.sets;
    const lastCount = lastTimeSets.length;
    const currentCount = currentSets.length;

    const newSets: TrackerSet[] = [];

    for (let i = 0; i < lastCount; i++) {
      const lt = lastTimeSets[i];
      const existing = i < currentCount ? currentSets[i] : null;

      newSets.push({
        set_number: lt.set_number,
        planned_reps: existing?.planned_reps || '',
        weight: lt.weight,
        reps: lt.reps,
        effort: lt.effort as Effort | '',
        notes: '',
        saved: false,
        sheetRow: existing?.sheetRow ?? -1,
      });
    }

    // Track removed sets (current sets beyond last-time count)
    for (let i = lastCount; i < currentCount; i++) {
      removedSets.push(currentSets[i]);
    }

    return { ...ex, sets: newSets };
  });

  return { exercises: updated, removedSets };
}
