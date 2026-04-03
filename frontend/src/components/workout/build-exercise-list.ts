import type { TrackerExercise } from './exercise-row';
import type { SetWithRow, Effort } from '../../api/types';

interface WarmupExerciseInfo {
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
}

/** Build TrackerExercise list from flat set rows. */
export function buildExerciseList(setRows: SetWithRow[]): TrackerExercise[] {
  const map = new Map<string, TrackerExercise>();

  for (const s of setRows) {
    const key = `${s.exercise_id}__${s.exercise_order}`;
    let ex = map.get(key);
    if (!ex) {
      ex = {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
        quickFillWeight: '',
        quickFillReps: '',
        quickFillEffort: '',
      };
      map.set(key, ex);
    }
    ex.sets.push({
      set_number: s.set_number,
      planned_reps: s.planned_reps,
      weight: s.weight,
      reps: s.reps,
      effort: s.effort as Effort | '',
      notes: s.notes,
      saved: s.sheetRow > 0,
      sheetRow: s.sheetRow,
    });
  }

  const list = Array.from(map.values()).sort((a, b) => a.exercise_order - b.exercise_order);
  for (const ex of list) {
    ex.sets.sort((a, b) => a.set_number - b.set_number);
  }
  return list;
}

/**
 * Merge warmup exercise metadata with tracked exercises built from set rows.
 * Warmups that already exist in `tracked` (by exercise_id + exercise_order) are skipped
 * to avoid duplication.
 */
export function mergeWarmups(
  tracked: TrackerExercise[],
  warmupInfos: WarmupExerciseInfo[],
): TrackerExercise[] {
  const trackedKeys = new Set(tracked.map((e) => `${e.exercise_id}__${e.exercise_order}`));

  const newWarmups: TrackerExercise[] = warmupInfos
    .filter((w) => !trackedKeys.has(`${w.exercise_id}__${w.exercise_order}`))
    .map((w) => ({
      exercise_id: w.exercise_id,
      exercise_name: w.exercise_name,
      section: 'warmup',
      exercise_order: w.exercise_order,
      sets: [],
      quickFillWeight: '',
      quickFillReps: '',
      quickFillEffort: '',
    }));

  return [...newWarmups, ...tracked].sort((a, b) => a.exercise_order - b.exercise_order);
}
