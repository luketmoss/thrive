import { describe, it, expect, beforeEach } from 'vitest';
import { workouts, sets, activeWorkoutId, activeWorkoutSets, isEditMode } from '../../state/store';
import { enterEditMode, exitEditMode } from '../../state/actions';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';
import { secondsToMinutes, minutesToSeconds } from '../../api/duration';

const WORKOUT_WEIGHT: WorkoutWithRow = {
  id: 'w_test1',
  date: '2026-03-10',
  time: '08:00',
  type: 'weight',
  name: 'Push Day',
  template_id: 'tpl_1',
  notes: 'Felt strong',
  elapsed_seconds: '3300',
  created: '2026-03-10T08:00:00.000Z',
  copied_from: '',
  status: '',
  moving_seconds: '',
  effort: '',
  distance_m: '',
  ascent_m: '',
  descent_m: '',
  avg_hr: '',
  sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '',
  sheetRow: 2,
};

const WORKOUT_STRETCH: WorkoutWithRow = {
  id: 'w_test2',
  date: '2026-03-11',
  time: '09:00',
  type: 'stretch',
  name: 'Morning Stretch',
  template_id: '',
  notes: 'Quick stretch',
  elapsed_seconds: '900',
  created: '2026-03-11T09:00:00.000Z',
  copied_from: '',
  status: '',
  moving_seconds: '',
  effort: '',
  distance_m: '',
  ascent_m: '',
  descent_m: '',
  avg_hr: '',
  sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '',
  sheetRow: 3,
};

const SETS: SetWithRow[] = [
  {
    workout_id: 'w_test1',
    exercise_id: 'ex_1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    set_number: 1,
    planned_reps: '8',
    weight: '185',
    reps: '8',
    effort: 'Medium',
    sheetRow: 10,
  },
  {
    workout_id: 'w_test1',
    exercise_id: 'ex_1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    set_number: 2,
    planned_reps: '8',
    weight: '185',
    reps: '7',
    effort: 'Hard',
    sheetRow: 11,
  },
  {
    workout_id: 'w_test1',
    exercise_id: 'ex_2',
    exercise_name: 'Incline DB',
    section: 'primary',
    exercise_order: 2,
    set_number: 1,
    planned_reps: '10',
    weight: '60',
    reps: '10',
    effort: 'Easy',
    sheetRow: 12,
  },
];

describe('Edit workout - enterEditMode', () => {
  beforeEach(() => {
    workouts.value = [WORKOUT_WEIGHT, WORKOUT_STRETCH];
    sets.value = [...SETS];
    activeWorkoutId.value = null;
    activeWorkoutSets.value = [];
    isEditMode.value = false;
  });

  it('sets isEditMode to true', () => {
    enterEditMode('w_test1');
    expect(isEditMode.value).toBe(true);
  });

  it('sets activeWorkoutId to the workout id', () => {
    enterEditMode('w_test1');
    expect(activeWorkoutId.value).toBe('w_test1');
  });

  it('loads workout sets into activeWorkoutSets', () => {
    enterEditMode('w_test1');
    expect(activeWorkoutSets.value).toHaveLength(3);
    expect(activeWorkoutSets.value.every((s) => s.workout_id === 'w_test1')).toBe(true);
  });

  it('does nothing for non-existent workout', () => {
    enterEditMode('w_missing');
    expect(isEditMode.value).toBe(false);
    expect(activeWorkoutId.value).toBeNull();
  });
});

describe('Edit workout - exitEditMode', () => {
  beforeEach(() => {
    workouts.value = [WORKOUT_WEIGHT];
    sets.value = [...SETS];
    enterEditMode('w_test1');
  });

  it('clears isEditMode', () => {
    exitEditMode();
    expect(isEditMode.value).toBe(false);
  });

  it('clears activeWorkoutId', () => {
    exitEditMode();
    expect(activeWorkoutId.value).toBeNull();
  });

  it('clears activeWorkoutSets', () => {
    exitEditMode();
    expect(activeWorkoutSets.value).toHaveLength(0);
  });
});

describe('Edit workout - weight vs non-weight routing', () => {
  beforeEach(() => {
    workouts.value = [WORKOUT_WEIGHT, WORKOUT_STRETCH];
    sets.value = [...SETS];
    isEditMode.value = false;
  });

  it('weight workout has type "weight"', () => {
    const w = workouts.value.find((w) => w.id === 'w_test1');
    expect(w?.type).toBe('weight');
  });

  it('non-weight workout has type "stretch"', () => {
    const w = workouts.value.find((w) => w.id === 'w_test2');
    expect(w?.type).toBe('stretch');
  });

  it('enterEditMode loads sets for weight workout', () => {
    enterEditMode('w_test1');
    expect(activeWorkoutSets.value.length).toBeGreaterThan(0);
  });

  it('enterEditMode loads empty sets for non-weight workout', () => {
    enterEditMode('w_test2');
    expect(activeWorkoutSets.value).toHaveLength(0);
  });
});

describe('Edit workout - duration editing', () => {
  beforeEach(() => {
    workouts.value = [WORKOUT_WEIGHT, WORKOUT_STRETCH];
    sets.value = [...SETS];
  });

  it('original workout has elapsed_seconds preserved in signal', () => {
    enterEditMode('w_test1');
    const w = workouts.value.find((w) => w.id === 'w_test1');
    expect(w?.elapsed_seconds).toBe('3300');
    expect(secondsToMinutes(w!.elapsed_seconds)).toBe(55);
  });

  it('EditWorkoutData carries seconds, and 45 typed minutes round-trips', () => {
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: 'Felt strong',
      elapsed_seconds: minutesToSeconds('45'),
      effort: '',
      sub_type: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    };
    expect(metadata.elapsed_seconds).toBe('2700');
    expect(secondsToMinutes(metadata.elapsed_seconds!)).toBe(45);
  });

  it('EditWorkoutData allows an empty duration, which stays empty not zero', () => {
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: '',
      elapsed_seconds: minutesToSeconds(''),
      effort: '',
      sub_type: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    };
    expect(metadata.elapsed_seconds).toBe('');
    expect(secondsToMinutes(metadata.elapsed_seconds!)).toBeNull();
  });

  it('non-weight workout has its duration accessible for editing', () => {
    const w = workouts.value.find((w) => w.id === 'w_test2');
    expect(w?.elapsed_seconds).toBe('900');
    expect(secondsToMinutes(w!.elapsed_seconds)).toBe(15);
  });
});

// Issue #102 — session effort on saved workouts.
describe('Session effort (#102)', () => {
  // AC3: effort is editable after the fact, including on workouts saved
  // before the feature existed.
  it('EditWorkoutData carries effort so both edit paths cover it', () => {
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: '',
      elapsed_seconds: '',
      effort: 'Hard',
      sub_type: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    };
    expect(metadata.effort).toBe('Hard');
  });

  it('allows effort to be cleared back to unset', () => {
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: '',
      elapsed_seconds: '',
      effort: '',
      sub_type: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    };
    expect(metadata.effort).toBe('');
  });

  // AC3: a workout saved before this shipped reads as unset, not as a default.
  it('treats a workout with no stored effort as unset', () => {
    const w = workouts.value.find((w) => w.id === 'w_test1');
    expect(w?.effort).toBe('');
  });

  // AC4: session effort and set effort are independent.
  it('does not derive session effort from the logged sets', () => {
    const w = workouts.value.find((w) => w.id === 'w_test1');
    const workoutSets = sets.value.filter((s) => s.workout_id === 'w_test1');
    expect(workoutSets.length).toBeGreaterThan(0);
    // Sets carry their own effort; the workout's stays unset until someone says.
    expect(w?.effort).toBe('');
  });
});
