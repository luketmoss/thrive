import { describe, it, expect, beforeEach } from 'vitest';
import {
  exercises,
  labels,
  templates,
  workouts,
  sets,
  filterType,
  filterTags,
  filteredWorkouts,
  allTags,
  getLabelByName,
  labelUsageCount,
  showToast,
  toasts,
} from './store';
import type { ExerciseWithRow, LabelWithRow, WorkoutWithRow, SetWithRow } from '../api/types';

// Helper to reset all signals to defaults between tests
function resetSignals() {
  exercises.value = [];
  labels.value = [];
  templates.value = [];
  workouts.value = [];
  sets.value = [];
  filterType.value = null;
  filterTags.value = [];
  toasts.value = [];
}

function makeWorkout(overrides: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id: 'w1',
    date: '2025-01-15',
    time: '08:00',
    type: 'weight',
    name: 'Push Day',
    template_id: '',
    notes: '',
    duration_min: '60',
    created: '2025-01-15T08:00:00.000Z',
    copied_from: '',
    sheetRow: 2,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<ExerciseWithRow> = {}): ExerciseWithRow {
  return {
    id: 'ex1',
    name: 'Bench Press',
    tags: 'Push, Chest',
    notes: '',
    created: '2025-01-01T00:00:00.000Z',
    sheetRow: 2,
    ...overrides,
  };
}

function makeLabel(overrides: Partial<LabelWithRow> = {}): LabelWithRow {
  return {
    id: 'lbl1',
    name: 'Push',
    color_key: 'red',
    created: '2025-01-01T00:00:00.000Z',
    sheetRow: 2,
    ...overrides,
  };
}

function makeSetRow(overrides: Partial<SetWithRow> = {}): SetWithRow {
  return {
    workout_id: 'w1',
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    set_number: 1,
    planned_reps: '8',
    weight: '135',
    reps: '8',
    effort: 'Medium',
    notes: '',
    sheetRow: 2,
    ...overrides,
  };
}

describe('filteredWorkouts', () => {
  beforeEach(resetSignals);

  it('returns all workouts when no filters are set', () => {
    workouts.value = [
      makeWorkout({ id: 'w1', date: '2025-01-15' }),
      makeWorkout({ id: 'w2', date: '2025-01-14', type: 'stretch' }),
    ];

    expect(filteredWorkouts.value).toHaveLength(2);
  });

  it('sorts workouts by date descending (most recent first)', () => {
    workouts.value = [
      makeWorkout({ id: 'w_old', date: '2025-01-10', time: '08:00' }),
      makeWorkout({ id: 'w_new', date: '2025-01-15', time: '08:00' }),
      makeWorkout({ id: 'w_mid', date: '2025-01-12', time: '08:00' }),
    ];

    const ids = filteredWorkouts.value.map((w) => w.id);
    expect(ids).toEqual(['w_new', 'w_mid', 'w_old']);
  });

  it('sorts by time when dates are equal', () => {
    workouts.value = [
      makeWorkout({ id: 'w_morning', date: '2025-01-15', time: '06:00' }),
      makeWorkout({ id: 'w_evening', date: '2025-01-15', time: '18:00' }),
    ];

    const ids = filteredWorkouts.value.map((w) => w.id);
    expect(ids).toEqual(['w_evening', 'w_morning']);
  });

  it('handles missing time by defaulting to 00:00', () => {
    workouts.value = [
      makeWorkout({ id: 'w_no_time', date: '2025-01-15', time: '' }),
      makeWorkout({ id: 'w_with_time', date: '2025-01-15', time: '10:00' }),
    ];

    const ids = filteredWorkouts.value.map((w) => w.id);
    expect(ids).toEqual(['w_with_time', 'w_no_time']);
  });

  it('filters by workout type', () => {
    workouts.value = [
      makeWorkout({ id: 'w1', type: 'weight' }),
      makeWorkout({ id: 'w2', type: 'stretch' }),
      makeWorkout({ id: 'w3', type: 'bike' }),
      makeWorkout({ id: 'w4', type: 'weight' }),
    ];
    filterType.value = 'weight';

    const result = filteredWorkouts.value;
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.type === 'weight')).toBe(true);
  });

  it('filters by tags — shows workouts whose exercises match any selected tag', () => {
    exercises.value = [
      makeExercise({ id: 'ex_push', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex_pull', tags: 'Pull, Back' }),
    ];
    workouts.value = [
      makeWorkout({ id: 'w_push', date: '2025-01-15' }),
      makeWorkout({ id: 'w_pull', date: '2025-01-14' }),
    ];
    sets.value = [
      makeSetRow({ workout_id: 'w_push', exercise_id: 'ex_push' }),
      makeSetRow({ workout_id: 'w_pull', exercise_id: 'ex_pull' }),
    ];

    filterTags.value = ['Push'];
    const result = filteredWorkouts.value;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w_push');
  });

  it('tag filter matches ANY selected tag (OR logic)', () => {
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Pull, Back' }),
      makeExercise({ id: 'ex3', tags: 'Legs' }),
    ];
    workouts.value = [
      makeWorkout({ id: 'w1', date: '2025-01-15' }),
      makeWorkout({ id: 'w2', date: '2025-01-14' }),
      makeWorkout({ id: 'w3', date: '2025-01-13' }),
    ];
    sets.value = [
      makeSetRow({ workout_id: 'w1', exercise_id: 'ex1' }),
      makeSetRow({ workout_id: 'w2', exercise_id: 'ex2' }),
      makeSetRow({ workout_id: 'w3', exercise_id: 'ex3' }),
    ];

    filterTags.value = ['Push', 'Legs'];
    const result = filteredWorkouts.value;
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.id)).toContain('w1');
    expect(result.map((w) => w.id)).toContain('w3');
  });

  it('excludes workouts with no matching exercises when tag filter is active', () => {
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
    ];
    workouts.value = [
      makeWorkout({ id: 'w1', date: '2025-01-15' }),
      makeWorkout({ id: 'w2', date: '2025-01-14' }), // no sets
    ];
    sets.value = [
      makeSetRow({ workout_id: 'w1', exercise_id: 'ex1' }),
    ];

    filterTags.value = ['Push'];
    expect(filteredWorkouts.value).toHaveLength(1);
    expect(filteredWorkouts.value[0].id).toBe('w1');
  });

  it('combines type and tag filters', () => {
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
    ];
    workouts.value = [
      makeWorkout({ id: 'w_weight_push', type: 'weight', date: '2025-01-15' }),
      makeWorkout({ id: 'w_stretch', type: 'stretch', date: '2025-01-14' }),
    ];
    sets.value = [
      makeSetRow({ workout_id: 'w_weight_push', exercise_id: 'ex1' }),
      makeSetRow({ workout_id: 'w_stretch', exercise_id: 'ex1' }),
    ];

    filterType.value = 'weight';
    filterTags.value = ['Push'];

    const result = filteredWorkouts.value;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w_weight_push');
  });

  it('returns empty array when no workouts exist', () => {
    expect(filteredWorkouts.value).toEqual([]);
  });
});

describe('allTags (sourced from labels signal)', () => {
  beforeEach(resetSignals);

  it('returns empty array when no labels exist', () => {
    expect(allTags.value).toEqual([]);
  });

  it('returns sorted label names', () => {
    labels.value = [
      makeLabel({ id: 'lbl1', name: 'Push' }),
      makeLabel({ id: 'lbl2', name: 'Chest' }),
      makeLabel({ id: 'lbl3', name: 'Arms' }),
    ];

    expect(allTags.value).toEqual(['Arms', 'Chest', 'Push']);
  });
});

describe('getLabelByName', () => {
  beforeEach(resetSignals);

  it('finds a label by name', () => {
    labels.value = [
      makeLabel({ id: 'lbl1', name: 'Push', color_key: 'red' }),
      makeLabel({ id: 'lbl2', name: 'Pull', color_key: 'blue' }),
    ];

    const result = getLabelByName('Pull');
    expect(result).toBeDefined();
    expect(result!.color_key).toBe('blue');
  });

  it('returns undefined for non-existent label', () => {
    labels.value = [makeLabel({ name: 'Push' })];
    expect(getLabelByName('Nonexistent')).toBeUndefined();
  });
});

describe('labelUsageCount', () => {
  beforeEach(resetSignals);

  it('counts exercises that use a given label', () => {
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Push, Shoulders' }),
      makeExercise({ id: 'ex3', tags: 'Pull, Back' }),
    ];

    expect(labelUsageCount('Push')).toBe(2);
    expect(labelUsageCount('Pull')).toBe(1);
    expect(labelUsageCount('Core')).toBe(0);
  });
});

describe('showToast', () => {
  beforeEach(resetSignals);

  it('adds a toast to the toasts signal', () => {
    showToast('Hello', 'info');
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].text).toBe('Hello');
    expect(toasts.value[0].type).toBe('info');
  });

  it('adds multiple toasts', () => {
    showToast('First', 'success');
    showToast('Second', 'error');
    expect(toasts.value).toHaveLength(2);
    expect(toasts.value[0].text).toBe('First');
    expect(toasts.value[1].text).toBe('Second');
  });

  it('assigns unique IDs to each toast', () => {
    showToast('A', 'info');
    showToast('B', 'info');
    expect(toasts.value[0].id).not.toBe(toasts.value[1].id);
  });

  it('defaults type to info', () => {
    showToast('Default type');
    expect(toasts.value[0].type).toBe('info');
  });
});
