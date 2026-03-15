import { describe, it, expect } from 'vitest';
import { groupWorkoutsByDate, getWorkoutTags, EQUIPMENT_TAGS } from './activities-helpers';
import type { WorkoutWithRow, SetWithRow, ExerciseWithRow } from '../../api/types';

function makeWorkout(overrides: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id: 'w1',
    date: '2026-03-15',
    time: '07:00',
    type: 'weight',
    name: 'Upper Push A',
    template_id: '',
    notes: '',
    duration_min: '60',
    created: '',
    copied_from: '',
    sheetRow: 2,
    ...overrides,
  };
}

// ── Date grouping ────────────────────────────────────────────────────

describe('groupWorkoutsByDate', () => {
  // Use 2026-03-15 (Sunday) as "today"
  const today = '2026-03-15';

  it('returns empty array for no workouts', () => {
    expect(groupWorkoutsByDate([], today)).toEqual([]);
  });

  it('groups a workout from today into "This Week"', () => {
    const workouts = [makeWorkout({ date: '2026-03-15' })];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Week');
    expect(groups[0].workouts).toHaveLength(1);
  });

  it('groups workouts from current Mon-Sun into "This Week"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09' }), // Monday of this week
      makeWorkout({ id: 'w2', date: '2026-03-15' }), // Sunday (today)
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Week');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups previous week into "Last Week"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-02' }), // Mon of last week
      makeWorkout({ id: 'w2', date: '2026-03-08' }), // Sun of last week
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Last Week');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups older workouts by month/year', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-02-15' }),
      makeWorkout({ id: 'w2', date: '2026-02-20' }),
      makeWorkout({ id: 'w3', date: '2026-01-05' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('February 2026');
    expect(groups[0].workouts).toHaveLength(2);
    expect(groups[1].label).toBe('January 2026');
    expect(groups[1].workouts).toHaveLength(1);
  });

  it('handles mixed groups in correct order', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-15' }),  // This Week
      makeWorkout({ id: 'w2', date: '2026-03-05' }),  // Last Week
      makeWorkout({ id: 'w3', date: '2026-02-10' }),  // February
      makeWorkout({ id: 'w4', date: '2026-01-20' }),  // January
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups.map(g => g.label)).toEqual([
      'This Week',
      'Last Week',
      'February 2026',
      'January 2026',
    ]);
  });

  it('omits empty groups', () => {
    // Only a workout in "last week" — no "This Week" group should appear
    const workouts = [makeWorkout({ date: '2026-03-05' })];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Last Week');
  });
});

// ── Tag aggregation ──────────────────────────────────────────────────

describe('getWorkoutTags', () => {
  const exercises: ExerciseWithRow[] = [
    { id: 'ex1', name: 'Bench Press BB', tags: 'Push, Chest, BB', notes: '', created: '', sheetRow: 2 },
    { id: 'ex2', name: 'Incline Press DB', tags: 'Push, Chest, DB', notes: '', created: '', sheetRow: 3 },
    { id: 'ex3', name: 'Lateral Raise DB', tags: 'Push, Shoulders, DB', notes: '', created: '', sheetRow: 4 },
    { id: 'ex4', name: 'Ab Wheel', tags: 'Core', notes: '', created: '', sheetRow: 5 },
  ];

  const workoutSets: SetWithRow[] = [
    { workout_id: 'w1', exercise_id: 'ex1', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 2 },
    { workout_id: 'w1', exercise_id: 'ex2', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 2, set_number: 1, planned_reps: '', weight: '55', reps: '12', effort: 'Medium', notes: '', sheetRow: 3 },
    { workout_id: 'w1', exercise_id: 'ex3', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 3, set_number: 1, planned_reps: '', weight: '15', reps: '15', effort: 'Easy', notes: '', sheetRow: 4 },
    { workout_id: 'w1', exercise_id: 'ex4', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 4, set_number: 1, planned_reps: '', weight: '', reps: '10', effort: 'Medium', notes: '', sheetRow: 5 },
  ];

  it('returns top 3 most common muscle group tags', () => {
    const tags = getWorkoutTags(workoutSets, exercises);
    // Push appears on ex1, ex2, ex3 = 3 times
    // Chest appears on ex1, ex2 = 2 times
    // Shoulders appears on ex3 = 1 time
    // Core appears on ex4 = 1 time
    expect(tags).toHaveLength(3);
    expect(tags[0]).toBe('Push'); // 3 occurrences
    expect(tags[1]).toBe('Chest'); // 2 occurrences
    // Third could be Shoulders or Core (both 1); alphabetical tiebreak
    expect(['Core', 'Shoulders']).toContain(tags[2]);
  });

  it('excludes equipment tags (BB, DB, FT)', () => {
    const tags = getWorkoutTags(workoutSets, exercises);
    for (const tag of tags) {
      expect(EQUIPMENT_TAGS).not.toContain(tag);
    }
  });

  it('returns empty array for empty sets', () => {
    expect(getWorkoutTags([], exercises)).toEqual([]);
  });

  it('returns empty array when exercises have no tags', () => {
    const noTagExercises: ExerciseWithRow[] = [
      { id: 'ex1', name: 'Custom Exercise', tags: '', notes: '', created: '', sheetRow: 2 },
    ];
    const singleSet: SetWithRow[] = [
      { workout_id: 'w1', exercise_id: 'ex1', exercise_name: 'Custom Exercise', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '', effort: '', notes: '', sheetRow: 2 },
    ];
    expect(getWorkoutTags(singleSet, noTagExercises)).toEqual([]);
  });

  it('returns fewer than 3 if not enough unique tags', () => {
    const singleEx: ExerciseWithRow[] = [
      { id: 'ex4', name: 'Ab Wheel', tags: 'Core', notes: '', created: '', sheetRow: 5 },
    ];
    const singleSet: SetWithRow[] = [
      { workout_id: 'w1', exercise_id: 'ex4', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '10', effort: '', notes: '', sheetRow: 2 },
    ];
    const tags = getWorkoutTags(singleSet, singleEx);
    expect(tags).toEqual(['Core']);
  });

  it('excludes Warmup tag', () => {
    const warmupEx: ExerciseWithRow[] = [
      { id: 'ex1', name: 'Push Ups', tags: 'Warmup, Push, Chest', notes: '', created: '', sheetRow: 2 },
    ];
    const warmupSets: SetWithRow[] = [
      { workout_id: 'w1', exercise_id: 'ex1', exercise_name: 'Push Ups', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '15', effort: '', notes: '', sheetRow: 2 },
    ];
    const tags = getWorkoutTags(warmupSets, warmupEx);
    expect(tags).not.toContain('Warmup');
    expect(tags).toContain('Push');
    expect(tags).toContain('Chest');
  });
});
