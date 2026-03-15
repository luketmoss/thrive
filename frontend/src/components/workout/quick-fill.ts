import type { TrackerExercise } from './exercise-row';

/**
 * Apply quick-fill weight to all sets for a matching exercise.
 * When weight is non-empty, overwrites all set weights.
 * When weight is empty, only updates the quickFillWeight field (preserves existing set weights).
 */
export function applyQuickFillWeight(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
  weight: string,
): TrackerExercise[] {
  return exercises.map((ex) => {
    if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;
    return {
      ...ex,
      quickFillWeight: weight,
      sets: ex.sets.map((s) => {
        if (!weight) return s;
        return { ...s, weight, saved: false };
      }),
    };
  });
}
