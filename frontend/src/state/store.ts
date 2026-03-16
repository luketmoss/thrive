import { signal, computed } from '@preact/signals';
import type { ExerciseWithRow, LabelWithRow, Template, WorkoutWithRow, SetWithRow, WorkoutType } from '../api/types';

// Core data signals
export const exercises = signal<ExerciseWithRow[]>([]);
export const labels = signal<LabelWithRow[]>([]);
export const templates = signal<Template[]>([]);
export const workouts = signal<WorkoutWithRow[]>([]);
export const sets = signal<SetWithRow[]>([]);
export const loading = signal(true);

// Warmup exercise metadata (no sets — display only in tracker)
export interface WarmupExerciseInfo {
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
}

// UI state
export const activeWorkoutId = signal<string | null>(null);
export const activeWorkoutSets = signal<SetWithRow[]>([]);
export const activeWarmupExercises = signal<WarmupExerciseInfo[]>([]);
export const isEditMode = signal(false);
export const filterType = signal<WorkoutType | null>(null);
export const filterTags = signal<string[]>([]);

// Derived signals
export const filteredWorkouts = computed(() => {
  let result = workouts.value;
  if (filterType.value) {
    result = result.filter(w => w.type === filterType.value);
  }
  // Tag filter: show workouts that contain exercises matching ANY selected tag
  if (filterTags.value.length > 0) {
    const tagSet = new Set(filterTags.value);
    result = result.filter(w => {
      // Find exercise IDs in this workout's sets
      const workoutSets = sets.value.filter(s => s.workout_id === w.id);
      const exerciseIds = new Set(workoutSets.map(s => s.exercise_id));
      // Check if any of those exercises have a matching tag
      return exercises.value.some(ex => {
        if (!exerciseIds.has(ex.id)) return false;
        const exTags = ex.tags.split(',').map(t => t.trim()).filter(Boolean);
        return exTags.some(t => tagSet.has(t));
      });
    });
  }
  return result.sort((a, b) => {
    const dateA = a.date + 'T' + (a.time || '00:00');
    const dateB = b.date + 'T' + (b.time || '00:00');
    return dateB.localeCompare(dateA);
  });
});

// allTags: sourced from labels signal (backwards compat for filter rows)
export const allTags = computed(() => {
  return labels.value.map(l => l.name).sort();
});

/** Look up a label by name. */
export function getLabelByName(name: string): LabelWithRow | undefined {
  return labels.value.find(l => l.name === name);
}

/** Count how many exercises use a given label name. */
export function labelUsageCount(labelName: string): number {
  return exercises.value.filter(ex =>
    ex.tags.split(',').map(t => t.trim()).filter(Boolean).includes(labelName),
  ).length;
}

// Toast system
export interface ToastMessage {
  id: number;
  text: string;
  type: 'info' | 'error' | 'success';
}
let _toastId = 0;
export const toasts = signal<ToastMessage[]>([]);

export function showToast(text: string, type: ToastMessage['type'] = 'info') {
  const id = ++_toastId;
  toasts.value = [...toasts.value, { id, text, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, 4000);
}
