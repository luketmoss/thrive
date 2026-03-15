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

/**
 * Apply quick-fill reps to all sets for a matching exercise.
 * When reps is non-empty, overwrites all set reps.
 * When reps is empty, only updates the quickFillReps field (preserves existing set reps).
 */
export function applyQuickFillReps(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
  reps: string,
): TrackerExercise[] {
  return exercises.map((ex) => {
    if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;
    return {
      ...ex,
      quickFillReps: reps,
      sets: ex.sets.map((s) => {
        if (!reps) return s;
        return { ...s, reps, saved: false };
      }),
    };
  });
}
