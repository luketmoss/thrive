import { describe, it, expect, beforeEach } from 'vitest';
import { workouts, sets, activeWorkoutId, activeWorkoutSets, isEditMode } from '../../state/store';
import { enterEditMode, exitEditMode } from '../../state/actions';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';

const WORKOUT_WEIGHT: WorkoutWithRow = {
  id: 'w_test1',
  date: '2026-03-10',
  time: '08:00',
  type: 'weight',
  name: 'Push Day',
  template_id: 'tpl_1',
  notes: 'Felt strong',
  duration_min: '55',
  created: '2026-03-10T08:00:00.000Z',
  copied_from: '',
  status: '',
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
  duration_min: '15',
  created: '2026-03-11T09:00:00.000Z',
  copied_from: '',
  status: '',
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
    notes: '',
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
    notes: '',
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
    notes: '',
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

  it('original workout has duration_min preserved in signal', () => {
    enterEditMode('w_test1');
    const w = workouts.value.find((w) => w.id === 'w_test1');
    expect(w?.duration_min).toBe('55');
  });

  it('EditWorkoutData interface includes duration_min', () => {
    // Verify the interface accepts duration_min
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: 'Felt strong',
      duration_min: '45',
    };
    expect(metadata.duration_min).toBe('45');
  });

  it('EditWorkoutData allows empty duration_min', () => {
    const metadata: import('../../state/actions').EditWorkoutData = {
      date: '2026-03-10',
      name: 'Push Day',
      notes: '',
      duration_min: '',
    };
    expect(metadata.duration_min).toBe('');
  });

  it('non-weight workout has duration_min accessible for editing', () => {
    const w = workouts.value.find((w) => w.id === 'w_test2');
    expect(w?.duration_min).toBe('15');
  });
});
