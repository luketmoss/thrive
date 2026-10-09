import type { Template } from '../../api/types';
import type { WarmupExerciseInfo } from '../../state/store';

/**
 * The template warmups to list (list-only, no set rows) for a workout being
 * started from a plan or resumed at `#/workout/:id` (#351 AC4).
 *
 * One rule for both, so they cannot disagree: restore the template's warmups
 * only when the workout has no warmup set rows at all, the legacy case from
 * before warmups were stored as rows (#89). A workout with any warmup row
 * already has its warmups, wherever they were moved, and one removed stays
 * removed (#349 AC5).
 *
 * `[]` when there is no template, or it is not loaded: nothing from another
 * workout may survive into this one's list (#351 AC3).
 */
export function templateWarmupsToRestore(
  templateId: string | undefined,
  workoutSets: readonly { section: string }[],
  loadedTemplates: readonly Template[],
): WarmupExerciseInfo[] {
  if (!templateId) return [];
  const tpl = loadedTemplates.find((t) => t.id === templateId);
  if (!tpl) return [];
  if (workoutSets.some((s) => s.section === 'warmup')) return [];
  return tpl.exercises
    .filter((ex) => ex.section === 'warmup')
    .map((ex) => ({
      exercise_id: ex.exercise_id,
      exercise_name: ex.exercise_name,
      exercise_order: ex.order,
    }));
}
