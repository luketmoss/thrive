// Pure logic functions for section assignment, reorder, and remove in the workout tracker.

import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';

export const ALL_SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'] as const;
export type SectionName = typeof ALL_SECTIONS[number];

export interface SectionChangeResult {
  exercises: TrackerExercise[];
  /** Sets removed by this change (e.g. when converting to warmup). Caller must delete from API. */
  removedSets: TrackerSet[];
}

/**
 * Change the section of a specific exercise.
 * - to warmup: clears all sets (returns them in removedSets for API deletion)
 * - from warmup to non-warmup: adds a single empty set
 * - non-warmup to non-warmup: just updates section, preserves sets
 */
export function applyChangeSection(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
  newSection: string,
): SectionChangeResult {
  let removedSets: TrackerSet[] = [];

  const updated = exercises.map((ex) => {
    if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;

    const wasWarmup = ex.section === 'warmup';
    const toWarmup = newSection === 'warmup';

    if (toWarmup) {
      removedSets = [...ex.sets];
      return { ...ex, section: newSection, sets: [] };
    } else if (wasWarmup) {
      const emptySet: TrackerSet = {
        set_number: 1,
        planned_reps: '',
        weight: '',
        reps: '',
        effort: '',
        notes: '',
        saved: false,
        sheetRow: -1,
      };
      return { ...ex, section: newSection, sets: [emptySet] };
    } else {
      return { ...ex, section: newSection };
    }
  });

  return { exercises: updated, removedSets };
}

/**
 * Swap exercise_order of the target exercise with the one above it.
 * Returns the same array if already first.
 */
export function applyMoveUp(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
): TrackerExercise[] {
  const sorted = [...exercises].sort((a, b) => a.exercise_order - b.exercise_order);
  const idx = sorted.findIndex(
    (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
  );
  if (idx <= 0) return exercises;

  const prevEx = sorted[idx - 1];
  const currEx = sorted[idx];
  const prevOrder = prevEx.exercise_order;
  const currOrder = currEx.exercise_order;

  return exercises.map((ex) => {
    if (ex.exercise_id === currEx.exercise_id && ex.exercise_order === currOrder) {
      return { ...ex, exercise_order: prevOrder };
    }
    if (ex.exercise_id === prevEx.exercise_id && ex.exercise_order === prevOrder) {
      return { ...ex, exercise_order: currOrder };
    }
    return ex;
  });
}

/**
 * Swap exercise_order of the target exercise with the one below it.
 * Returns the same array if already last.
 */
export function applyMoveDown(
  exercises: TrackerExercise[],
  exerciseId: string,
  exerciseOrder: number,
): TrackerExercise[] {
  const sorted = [...exercises].sort((a, b) => a.exercise_order - b.exercise_order);
  const idx = sorted.findIndex(
    (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
  );
  if (idx < 0 || idx >= sorted.length - 1) return exercises;

  const nextEx = sorted[idx + 1];
  const currEx = sorted[idx];
  const currOrder = currEx.exercise_order;
  const nextOrder = nextEx.exercise_order;

  return exercises.map((ex) => {
    if (ex.exercise_id === currEx.exercise_id && ex.exercise_order === currOrder) {
      return { ...ex, exercise_order: nextOrder };
    }
    if (ex.exercise_id === nextEx.exercise_id && ex.exercise_order === nextOrder) {
      return { ...ex, exercise_order: currOrder };
    }
    return ex;
  });
}
