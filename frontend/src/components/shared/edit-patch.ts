/**
 * Turns an edit form's inputs into the fields a save should write (#172).
 *
 * Every measure input is pre-filled through a lossy conversion: whole minutes,
 * miles to a tenth, feet to the nearest ten. Converting an untouched input
 * back would round the stored value (343 s to 360 s, 430 m to 483 m). On a
 * COROS row the sync then reads that as a user edit, and the field stops
 * tracking COROS. So a field is written only when its input differs from what
 * it was pre-filled with. That covers a field changed and then changed back,
 * which the user sees as untouched.
 *
 * Inputs are compared as strings, exactly as the field showed them. Only a
 * changed value is converted, and `duration.ts` and `units.ts` stay the only
 * conversion boundary. Clearing a field is a change and writes `''`, never `0`.
 */

import type { Effort, Workout } from '../../api/types';
import type { EditWorkoutData } from '../../state/actions';
import { secondsToMinutesInput, minutesToSeconds } from '../../api/duration';
import { milesToMeters, feetToMeters, bpmToStored } from '../../api/units';
import { storedToCardio } from './cardio-fields';

/** The edit form's inputs, as typed. */
export interface EditInputs {
  date: string;
  name: string;
  /** Whole minutes. */
  duration: string;
  notes: string;
  effort: Effort | '';
  subType: string;
  /** Miles. */
  distance: string;
  /** Feet. */
  ascent: string;
  descent: string;
  /** bpm. */
  avgHr: string;
}

/** What each input starts with for `w`. An unset field starts blank. */
export function workoutToEditInputs(w: Workout | undefined): EditInputs {
  return {
    date: w?.date || '',
    name: w?.name || '',
    duration: secondsToMinutesInput(w?.elapsed_seconds ?? ''),
    notes: w?.notes || '',
    effort: w?.effort || '',
    subType: w?.sub_type || '',
    ...storedToCardio(w),
  };
}

/** Each input's stored field and its typed-to-stored conversion. */
const FIELDS: { [K in keyof EditInputs]: (v: string) => Partial<EditWorkoutData> } = {
  date: (v) => ({ date: v }),
  name: (v) => ({ name: v.trim() }),
  duration: (v) => ({ elapsed_seconds: minutesToSeconds(v) }),
  notes: (v) => ({ notes: v.trim() }),
  effort: (v) => ({ effort: v as Effort | '' }),
  subType: (v) => ({ sub_type: v }),
  distance: (v) => ({ distance_m: milesToMeters(v) }),
  ascent: (v) => ({ ascent_m: feetToMeters(v) }),
  descent: (v) => ({ descent_m: feetToMeters(v) }),
  avgHr: (v) => ({ avg_hr: bpmToStored(v) }),
};

/**
 * The fields to save: one for each input in `current` that differs from its
 * pre-fill in `initial`. An input that `current` leaves out, such as the cardio
 * fields in the weight edit mode, which has none, is never written.
 */
export function editInputsToPatch(initial: EditInputs, current: Partial<EditInputs>): EditWorkoutData {
  const patch: EditWorkoutData = {};
  for (const key of Object.keys(FIELDS) as (keyof EditInputs)[]) {
    const value = current[key];
    if (value === undefined || value === initial[key]) continue;
    Object.assign(patch, FIELDS[key](value));
  }
  return patch;
}

/** Whether a save would write anything, which is when Discard should ask. */
export function hasEdits(initial: EditInputs, current: Partial<EditInputs>): boolean {
  return Object.keys(editInputsToPatch(initial, current)).length > 0;
}
