// #241 — a day's workout marks, the one rule the week strip (#237 AC3) and
// the Calendar grid both draw from, so the two can never drift apart.
//
// Marks come from the workouts already in memory, never a read: a filled dot
// for each workout that is not `planned`, then a ring for each planned one,
// three at most. A planned workout on a past day stays a ring.

import type { WorkoutWithRow } from '../api/types';

export const MAX_MARKS = 3;

export interface DayMarks {
  done: number;
  planned: number;
}

export type MarkKind = 'dot' | 'ring';

/** Done and planned counts for each of `dates`, from the workouts in memory. */
export function marksFor(dates: readonly string[], all: readonly WorkoutWithRow[]): Record<string, DayMarks> {
  const out: Record<string, DayMarks> = {};
  for (const d of dates) out[d] = { done: 0, planned: 0 };
  for (const w of all) {
    const m = out[w.date];
    if (!m) continue;
    if (w.status === 'planned') m.planned++;
    else m.done++;
  }
  return out;
}

/** The marks drawn for one day: dots first, then rings, three in all. */
export function markKinds({ done, planned }: DayMarks): MarkKind[] {
  const kinds: MarkKind[] = [];
  for (let i = 0; i < done; i++) kinds.push('dot');
  for (let i = 0; i < planned; i++) kinds.push('ring');
  return kinds.slice(0, MAX_MARKS);
}
