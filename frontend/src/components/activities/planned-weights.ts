import type { WorkoutSet } from '../../api/types';

/**
 * Prescribed loads on a planned workout's sets, carried through a planner
 * save. The planner edits structure only and saves by re-creating the
 * workout, which used to drop every weight scheduled onto it (#118).
 *
 * Matches on exercise + section + set number: a set that still exists keeps
 * its load, a newly added set starts blank. Returns `undefined` when there is
 * nothing to carry, so the builder writes blank weights exactly as before.
 */
export function plannedWeightsFor(
  existingSets: WorkoutSet[],
  exerciseId: string,
  section: string,
  setCount: number,
): string[] | undefined {
  const bySetNumber = new Map(
    existingSets
      .filter((s) => s.exercise_id === exerciseId && s.section === section)
      .map((s) => [s.set_number, s.weight]),
  );
  const weights = Array.from({ length: setCount }, (_, i) => bySetNumber.get(i + 1) ?? '');
  return weights.some((w) => w !== '') ? weights : undefined;
}
