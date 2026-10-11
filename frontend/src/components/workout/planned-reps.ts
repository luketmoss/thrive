import type { BuilderExercise } from '../../api/types';
import type { PlannerExercise } from './workout-planner';

/**
 * Per-set planned reps in the workout planner (#375). The rows on screen and
 * the sets Save writes come from the same helpers here, so they always agree.
 */

/** The Sets input's own `max`: the most rows shown and saved. */
export const MAX_PLANNED_SETS = 20;

/**
 * Every planned-Reps input — the planner's per-set rows and "Reps, all sets",
 * and the template editor's Reps — spreads this one set of props (#375,
 * #376). Text, not `number`: a number input reports `""` for a partial or
 * invalid entry and so cannot refuse one; `RepsField` refuses it instead.
 */
export const REPS_INPUT_PROPS = {
  type: 'text',
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 3,
  autoComplete: 'off',
} as const;

const WHOLE_REPS = /^[1-9][0-9]{0,2}$/;

/**
 * Whether `text` is whole-number reps (#376): 1–999, no leading zero, sign
 * or decimal. Any other non-blank stored value (`4-6`, `AMRAP`, `0`) is held
 * text: shown read-only and saved exactly as stored until replaced.
 */
export function isWholeReps(text: string): boolean {
  return WHOLE_REPS.test(text);
}

/** Stored, non-blank, and not whole-number reps: shown read-only, never edited. */
export function isHeldReps(text: string): boolean {
  return text !== '' && !isWholeReps(text);
}

/**
 * The number of sets a typed Sets value means: floored, clamped to
 * 1–`max` ({@link MAX_PLANNED_SETS} unless the entry was stored with more),
 * and 1 for a blank, `0` or invalid value (the old `|| 1`).
 */
export function plannedSetCount(sets: string, max = MAX_PLANNED_SETS): number {
  const n = Math.floor(Number(sets));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

/**
 * An entry's most sets: 20, or its stored count when the sheet holds more
 * (an agent can schedule more), so opening and saving it never drops a set.
 */
export const maxSetsOf = (ex: Pick<PlannerExercise, 'max_sets'>) => Math.max(MAX_PLANNED_SETS, ex.max_sets ?? 0);

/**
 * `reps` grown to at least `n` values, each new position pre-filled from the
 * one above it (blank if that is blank). Values past `n` — the remembered
 * tail of a lowered Sets count — are kept.
 */
export function extendReps(reps: string[], n: number): string[] {
  if (reps.length >= n) return reps;
  const out = reps.slice();
  while (out.length < n) out.push(out[out.length - 1] ?? '');
  return out;
}

/** The values the entry's rows hold, one per set, exactly as Save writes them. */
export function heldReps(ex: Pick<PlannerExercise, 'sets' | 'reps_by_set' | 'max_sets'>): string[] {
  const n = plannedSetCount(ex.sets, maxSetsOf(ex));
  return extendReps(ex.reps_by_set, n).slice(0, n);
}

/** Whether the held values differ, judged on the stored text. */
export function repsVary(held: string[]): boolean {
  return held.some((v) => v !== held[0]);
}

/**
 * The collapsed card's summary of per-set reps: `visual` (`3 × 10/8/6`) and
 * `spoken`, its screen-reader form. Blank sets show as `—`; every set blank
 * reads `3 sets`. Empty for no sets.
 */
export function repsSummary(held: string[]): { visual: string; spoken: string } {
  const n = held.length;
  if (n === 0) return { visual: '', spoken: '' };
  if (held.every((v) => v === '')) return { visual: `${n} sets`, spoken: `${n} sets` };
  const sets = n === 1 ? '1 set' : `${n} sets`;
  if (!repsVary(held)) return { visual: `${n} × ${held[0]}`, spoken: `${sets} of ${held[0]} reps` };
  return {
    visual: `${n} × ${held.map((v) => v || '—').join('/')}`,
    spoken: `${sets}: ${held.map((v) => v || 'blank').join(', ')} reps`,
  };
}

/**
 * The planner's entries as the builder's, for both the planned-workout
 * editor and the new-plan planner. Each set is written with its own row's
 * value, exactly as held (#375), so an untouched entry saves its stored
 * per-set text unchanged (#350). An entry's `source_order` (#380) is passed
 * on so its stored weight, reps and effort follow it. A warmup is one blank
 * row whatever it holds, so it carries no list.
 */
export function plannerToBuilderExercises(exercises: PlannerExercise[]): BuilderExercise[] {
  return exercises.map((ex) => {
    const held = heldReps(ex);
    const out: BuilderExercise = {
      exercise_id: ex.exercise_id,
      exercise_name: ex.exercise_name,
      section: ex.section,
      sets: held.length,
      planned_reps: held[0] ?? '',
    };
    if (ex.section !== 'warmup') out.planned_reps_by_set = held;
    if (ex.source_order !== undefined) out.source_order = ex.source_order;
    return out;
  });
}
