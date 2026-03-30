import { describe, it, expect } from 'vitest';
import { groupWorkoutsByDate, getWeekStreak, getWeekWorkoutCount, getWeekTotalMinutes, getWorkoutTags, EQUIPMENT_TAGS, toLocalDateStr } from './activities-helpers';
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
    status: '',
    sheetRow: 2,
    ...overrides,
  };
}

// ── toLocalDateStr ───────────────────────────────────────────────────

describe('toLocalDateStr', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    const d = new Date(2026, 2, 15); // March 15, 2026 local
    expect(toLocalDateStr(d)).toBe('2026-03-15');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5); // January 5
    expect(toLocalDateStr(d)).toBe('2026-01-05');
  });

  it('uses local date, not UTC (avoids timezone shift)', () => {
    // Create a date at local midnight — toISOString would shift this to
    // the previous day for timezones west of UTC
    const d = new Date('2026-03-15T00:00:00'); // local midnight
    expect(toLocalDateStr(d)).toBe('2026-03-15');
  });
});

// ── Month-based date grouping ────────────────────────────────────────

describe('groupWorkoutsByDate', () => {
  // today = 2026-03-15 → "This Month" = March 2026, "Last Month" = February 2026
  const today = '2026-03-15';

  it('returns empty array for no workouts', () => {
    expect(groupWorkoutsByDate([], today)).toEqual([]);
  });

  it('groups workouts in the current month into "This Month"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-01' }),
      makeWorkout({ id: 'w2', date: '2026-03-15' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Month');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups workouts in the previous month into "Last Month"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-02-01' }),
      makeWorkout({ id: 'w2', date: '2026-02-28' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Last Month');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups older workouts by "Month Year"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-01-15' }),
      makeWorkout({ id: 'w2', date: '2025-12-20' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('January 2026');
    expect(groups[1].label).toBe('December 2025');
  });

  it('handles mixed groups in correct order', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-10' }), // This Month
      makeWorkout({ id: 'w2', date: '2026-02-20' }), // Last Month
      makeWorkout({ id: 'w3', date: '2026-01-05' }), // January 2026
      makeWorkout({ id: 'w4', date: '2025-11-10' }), // November 2025
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups.map(g => g.label)).toEqual([
      'This Month',
      'Last Month',
      'January 2026',
      'November 2025',
    ]);
  });

  it('omits empty groups', () => {
    const workouts = [makeWorkout({ date: '2026-02-10' })];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Last Month');
  });

  it('no duplicates — month boundary workout falls into exactly one group', () => {
    // Mar 1 is "This Month", Feb 28 is "Last Month" — no overlap
    // Input already sorted newest-first (as filteredWorkouts provides)
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-01' }),
      makeWorkout({ id: 'w2', date: '2026-02-28' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('This Month');
    expect(groups[0].workouts).toHaveLength(1);
    expect(groups[0].workouts[0].date).toBe('2026-03-01');
    expect(groups[1].label).toBe('Last Month');
    expect(groups[1].workouts).toHaveLength(1);
    expect(groups[1].workouts[0].date).toBe('2026-02-28');
  });

  it('handles January today with December as Last Month', () => {
    const janToday = '2026-01-15';
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-01-10' }),
      makeWorkout({ id: 'w2', date: '2025-12-20' }),
    ];
    const groups = groupWorkoutsByDate(workouts, janToday);
    expect(groups[0].label).toBe('This Month');
    expect(groups[1].label).toBe('Last Month');
  });
});

// ── Weekly streak ────────────────────────────────────────────────────

describe('getWeekStreak', () => {
  // 2026-03-15 is a Sunday; Mon of that week = 2026-03-09
  const today = '2026-03-15';

  it('returns 7 days', () => {
    expect(getWeekStreak([], today)).toHaveLength(7);
  });

  it('starts on Monday', () => {
    const days = getWeekStreak([], today);
    expect(days[0].date).toBe('2026-03-09'); // Monday
    expect(days[0].label).toBe('M');
  });

  it('ends on Sunday', () => {
    const days = getWeekStreak([], today);
    expect(days[6].date).toBe('2026-03-15'); // Sunday
    expect(days[6].label).toBe('S');
  });

  it('marks today correctly', () => {
    const days = getWeekStreak([], today);
    const todayDay = days.find(d => d.isToday);
    expect(todayDay?.date).toBe('2026-03-15');
    expect(todayDay?.isToday).toBe(true);
    expect(days.filter(d => d.isToday)).toHaveLength(1);
  });

  it('marks days with workouts as hasWorkout=true', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09' }), // Monday
      makeWorkout({ id: 'w2', date: '2026-03-11' }), // Wednesday
    ];
    const days = getWeekStreak(workouts, today);
    expect(days[0].hasWorkout).toBe(true);  // Mon
    expect(days[1].hasWorkout).toBe(false); // Tue
    expect(days[2].hasWorkout).toBe(true);  // Wed
    expect(days[3].hasWorkout).toBe(false); // Thu
  });

  it('ignores workouts outside the current week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-01' }), // last week
      makeWorkout({ id: 'w2', date: '2026-03-20' }), // next week
    ];
    const days = getWeekStreak(workouts, today);
    expect(days.every(d => !d.hasWorkout)).toBe(true);
  });

  it('all days empty when no workouts', () => {
    const days = getWeekStreak([], today);
    expect(days.every(d => !d.hasWorkout)).toBe(true);
  });

  it('works correctly when today is Monday', () => {
    const monday = '2026-03-09';
    const days = getWeekStreak([], monday);
    expect(days[0].date).toBe('2026-03-09');
    expect(days[6].date).toBe('2026-03-15');
    expect(days[0].isToday).toBe(true);
  });

  it('uses local dates (no UTC shift from toISOString)', () => {
    // All generated dates should match the expected local-time dates,
    // regardless of the runtime timezone offset
    const days = getWeekStreak([], '2026-03-15');
    const dates = days.map(d => d.date);
    expect(dates).toEqual([
      '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12',
      '2026-03-13', '2026-03-14', '2026-03-15',
    ]);
  });
});

describe('getWeekWorkoutCount', () => {
  const today = '2026-03-15'; // Sunday; week = Mar 9–15

  it('returns 0 for no workouts', () => {
    expect(getWeekWorkoutCount([], today)).toBe(0);
  });

  it('counts workouts only within the current week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09' }),
      makeWorkout({ id: 'w2', date: '2026-03-11' }),
      makeWorkout({ id: 'w3', date: '2026-03-01' }), // outside week
    ];
    expect(getWeekWorkoutCount(workouts, today)).toBe(2);
  });

  it('counts multiple workouts on the same day', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', time: '07:00' }),
      makeWorkout({ id: 'w2', date: '2026-03-09', time: '18:00' }),
    ];
    expect(getWeekWorkoutCount(workouts, today)).toBe(2);
  });
});

// ── Weekly total minutes ─────────────────────────────────────────────

describe('getWeekTotalMinutes', () => {
  const today = '2026-03-15'; // Sunday; week = Mar 9–15

  it('AC1: sums all durations when every workout has one', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-11', duration_min: '45' }),
      makeWorkout({ id: 'w3', date: '2026-03-15', duration_min: '45' }),
    ];
    expect(getWeekTotalMinutes(workouts, today)).toBe(150);
  });

  it('AC2: sums only workouts that have a duration (partial)', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-11', duration_min: '' }),
      makeWorkout({ id: 'w3', date: '2026-03-13', duration_min: '45' }),
    ];
    expect(getWeekTotalMinutes(workouts, today)).toBe(105);
  });

  it('AC3: returns 0 when no workouts have a duration', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '' }),
      makeWorkout({ id: 'w2', date: '2026-03-11', duration_min: '' }),
    ];
    expect(getWeekTotalMinutes(workouts, today)).toBe(0);
  });

  it('AC4: returns 0 for no workouts', () => {
    expect(getWeekTotalMinutes([], today)).toBe(0);
  });

  it('ignores workouts outside the current week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-01', duration_min: '90' }), // outside week
    ];
    expect(getWeekTotalMinutes(workouts, today)).toBe(60);
  });
});

// ── Planned workout exclusion (caller responsibility) ────────────────
// The helpers receive pre-filtered workout lists. These tests confirm
// that passing only completedWorkouts (status !== 'planned') correctly
// excludes planned workouts from streak / stats.

describe('week stats exclude planned workouts (via caller filtering)', () => {
  const today = '2026-03-15'; // week = Mar 9–15

  it('getWeekStreak: planned workouts filtered out by caller are not counted', () => {
    const planned = makeWorkout({ id: 'w_planned', date: '2026-03-11', status: 'planned' });
    const completed = makeWorkout({ id: 'w_done', date: '2026-03-09', status: '' });

    // Caller filters out planned before passing
    const completedOnly = [completed];
    const days = getWeekStreak(completedOnly, today);

    expect(days[0].hasWorkout).toBe(true);  // Mon Mar 9 — completed
    expect(days[2].hasWorkout).toBe(false); // Wed Mar 11 — planned was excluded
  });

  it('getWeekWorkoutCount: planned workouts filtered out by caller are not counted', () => {
    const planned = makeWorkout({ id: 'w_planned', date: '2026-03-11', status: 'planned' });
    const completed = makeWorkout({ id: 'w_done', date: '2026-03-09', status: '' });
    const completedOnly = [completed];
    expect(getWeekWorkoutCount(completedOnly, today)).toBe(1);
  });

  it('getWeekTotalMinutes: planned workouts filtered out by caller are not summed', () => {
    const planned = makeWorkout({ id: 'w_planned', date: '2026-03-11', duration_min: '45', status: 'planned' });
    const completed = makeWorkout({ id: 'w_done', date: '2026-03-09', duration_min: '60', status: '' });
    const completedOnly = [completed];
    expect(getWeekTotalMinutes(completedOnly, today)).toBe(60);
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
    expect(tags).toHaveLength(3);
    expect(tags[0]).toBe('Push');
    expect(tags[1]).toBe('Chest');
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
    expect(getWorkoutTags(singleSet, singleEx)).toEqual(['Core']);
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
