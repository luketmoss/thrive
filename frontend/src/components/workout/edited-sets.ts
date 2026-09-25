import type { TrackerExercise } from './exercise-row';
import type { EditSetData } from '../../state/actions';

/**
 * Every set on the edit screen, in the shape `saveWorkoutEdits` takes.
 *
 * Warmups are included (#177). A warmup started from a template is stored as a
 * single set row, and `saveWorkoutEdits` deletes any stored row that is not in
 * this list, so leaving warmups out deleted them on every save. A template
 * warmup with no stored row has no sets here, so it adds nothing.
 */
export function collectEditedSets(exerciseList: TrackerExercise[]): EditSetData[] {
  const edited: EditSetData[] = [];
  for (const ex of exerciseList) {
    for (const set of ex.sets) {
      edited.push({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: ex.section,
        exercise_order: ex.exercise_order,
        set_number: set.set_number,
        planned_reps: set.planned_reps,
        weight: set.weight,
        reps: set.reps,
        effort: set.effort,
        sheetRow: set.sheetRow,
      });
    }
  }
  return edited;
}
