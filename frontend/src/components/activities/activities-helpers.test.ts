import { describe, it, expect } from 'vitest';
import {
  groupWorkoutsByDate,
  getWeekStreak,
  getWeekWorkoutCount,
  getWeekTotalMinutes,
  getLastWeekWorkoutCount,
  getLastWeekTotalMinutes,
  getMonthWorkoutCount,
  getMonthTotalMinutes,
  getWorkoutTags,
  EQUIPMENT_TAGS,
  toLocalDateStr,
} from './activities-helpers';
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
    const d = new Date('2026-03-15T00:00:00'); // local midnight
    expect(toLocalDateStr(d)).toBe('2026-03-15');
  });
});

// ── Weekly section grouping ──────────────────────────────────────────
// today = '2026-03-18' (Wednesday)
// This week: 2026-03-16 (Mon) – 2026-03-22 (Sun)
// Last week: 2026-03-09 (Mon) – 2026-03-15 (Sun)
// Earlier:   anything before 2026-03-09

describe('groupWorkoutsByDate', () => {
  const today = '2026-03-18'; // Wednesday

  it('returns empty array for no workouts', () => {
    expect(groupWorkoutsByDate([], today)).toEqual([]);
  });

  it('groups workouts in the current Mon–Sun week into "This Week"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-16' }), // Mon
      makeWorkout({ id: 'w2', date: '2026-03-18' }), // Wed (today)
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Week');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups workouts in the previous Mon–Sun week into "Last Week"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09' }), // Mon last week
      makeWorkout({ id: 'w2', date: '2026-03-15' }), // Sun last week
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Last Week');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('groups workouts before last week into "Earlier"', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-08' }), // day before last Mon
      makeWorkout({ id: 'w2', date: '2025-12-01' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Earlier');
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('handles mixed groups in correct order: This Week → Last Week → Earlier', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-18' }), // This Week
      makeWorkout({ id: 'w2', date: '2026-03-12' }), // Last Week
      makeWorkout({ id: 'w3', date: '2026-03-01' }), // Earlier
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups.map(g => g.label)).toEqual(['This Week', 'Last Week', 'Earlier']);
  });

  it('omits empty sections', () => {
    const workouts = [makeWorkout({ date: '2026-03-18' })];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Week');
  });

  it('no duplicates — week boundary workout falls into exactly one section', () => {
    // Sunday of last week vs Monday of this week
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-16' }), // Mon this week
      makeWorkout({ id: 'w2', date: '2026-03-15' }), // Sun last week
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('This Week');
    expect(groups[0].workouts).toHaveLength(1);
    expect(groups[0].workouts[0].date).toBe('2026-03-16');
    expect(groups[1].label).toBe('Last Week');
    expect(groups[1].workouts).toHaveLength(1);
    expect(groups[1].workouts[0].date).toBe('2026-03-15');
  });

  it('works correctly when today is Monday', () => {
    // today = 2026-03-16 (Monday)
    // This week: Mar 16–22; Last week: Mar 9–15
    const monday = '2026-03-16';
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-16' }), // This Week (today)
      makeWorkout({ id: 'w2', date: '2026-03-15' }), // Last Week (Sun)
      makeWorkout({ id: 'w3', date: '2026-03-09' }), // Last Week (Mon)
      makeWorkout({ id: 'w4', date: '2026-03-08' }), // Earlier
    ];
    const groups = groupWorkoutsByDate(workouts, monday);
    expect(groups.map(g => g.label)).toEqual(['This Week', 'Last Week', 'Earlier']);
    expect(groups[0].workouts).toHaveLength(1);
    expect(groups[1].workouts).toHaveLength(2);
    expect(groups[2].workouts).toHaveLength(1);
  });

  it('works correctly when today is Sunday', () => {
    // today = 2026-03-22 (Sunday)
    // This week: Mar 16–22; Last week: Mar 9–15
    const sunday = '2026-03-22';
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-22' }), // This Week (today)
      makeWorkout({ id: 'w2', date: '2026-03-16' }), // This Week (Mon)
      makeWorkout({ id: 'w3', date: '2026-03-15' }), // Last Week (Sun)
    ];
    const groups = groupWorkoutsByDate(workouts, sunday);
    expect(groups.map(g => g.label)).toEqual(['This Week', 'Last Week']);
    expect(groups[0].workouts).toHaveLength(2);
  });

  it('preserves reverse-chronological order within each section', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-18' }),
      makeWorkout({ id: 'w2', date: '2026-03-16' }),
    ];
    const groups = groupWorkoutsByDate(workouts, today);
    expect(groups[0].workouts[0].date).toBe('2026-03-18');
    expect(groups[0].workouts[1].date).toBe('2026-03-16');
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

// ── Last week stats ──────────────────────────────────────────────────
// today = '2026-03-18' (Wed); last week = Mar 9–15

describe('getLastWeekWorkoutCount', () => {
  const today = '2026-03-18';

  it('returns 0 for no workouts', () => {
    expect(getLastWeekWorkoutCount([], today)).toBe(0);
  });

  it('counts workouts in the previous Mon–Sun week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09' }), // Mon last week
      makeWorkout({ id: 'w2', date: '2026-03-12' }), // Thu last week
      makeWorkout({ id: 'w3', date: '2026-03-15' }), // Sun last week
      makeWorkout({ id: 'w4', date: '2026-03-16' }), // This week (excluded)
      makeWorkout({ id: 'w5', date: '2026-03-08' }), // Earlier (excluded)
    ];
    expect(getLastWeekWorkoutCount(workouts, today)).toBe(3);
  });

  it('returns 0 when no workouts fall in last week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-17' }), // This week
      makeWorkout({ id: 'w2', date: '2026-03-01' }), // Earlier
    ];
    expect(getLastWeekWorkoutCount(workouts, today)).toBe(0);
  });

  it('AC4: planned workouts filtered by caller are excluded', () => {
    const completed = makeWorkout({ id: 'w1', date: '2026-03-11', status: '' });
    expect(getLastWeekWorkoutCount([completed], today)).toBe(1);
  });
});

describe('getLastWeekTotalMinutes', () => {
  const today = '2026-03-18'; // last week = Mar 9–15

  it('returns 0 for no workouts', () => {
    expect(getLastWeekTotalMinutes([], today)).toBe(0);
  });

  it('sums durations for last week only', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-12', duration_min: '45' }),
      makeWorkout({ id: 'w3', date: '2026-03-16', duration_min: '30' }), // This week (excluded)
      makeWorkout({ id: 'w4', date: '2026-03-01', duration_min: '90' }), // Earlier (excluded)
    ];
    expect(getLastWeekTotalMinutes(workouts, today)).toBe(105);
  });

  it('skips workouts with no duration (contributes 0 min but still counted)', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-09', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-11', duration_min: '' }),
    ];
    expect(getLastWeekTotalMinutes(workouts, today)).toBe(60);
  });
});

// ── This month stats ─────────────────────────────────────────────────
// today = '2026-03-18'; this month = March 2026

describe('getMonthWorkoutCount', () => {
  const today = '2026-03-18';

  it('returns 0 for no workouts', () => {
    expect(getMonthWorkoutCount([], today)).toBe(0);
  });

  it('counts workouts in the current calendar month', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-01' }),
      makeWorkout({ id: 'w2', date: '2026-03-15' }),
      makeWorkout({ id: 'w3', date: '2026-03-18' }),
      makeWorkout({ id: 'w4', date: '2026-02-28' }), // Last month (excluded)
      makeWorkout({ id: 'w5', date: '2026-04-01' }), // Next month (excluded)
    ];
    expect(getMonthWorkoutCount(workouts, today)).toBe(3);
  });

  it('returns 0 when no workouts this month', () => {
    const workouts = [makeWorkout({ date: '2026-02-15' })];
    expect(getMonthWorkoutCount(workouts, today)).toBe(0);
  });

  it('handles January correctly (year boundary)', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-01-10' }),
      makeWorkout({ id: 'w2', date: '2025-12-31' }), // Last year (excluded)
    ];
    expect(getMonthWorkoutCount(workouts, '2026-01-15')).toBe(1);
  });

  it('AC5: excludes planned workouts when caller passes completedWorkouts', () => {
    const completed = makeWorkout({ id: 'w1', date: '2026-03-15', status: '' });
    expect(getMonthWorkoutCount([completed], today)).toBe(1);
  });
});

describe('getMonthTotalMinutes', () => {
  const today = '2026-03-18';

  it('returns 0 for no workouts', () => {
    expect(getMonthTotalMinutes([], today)).toBe(0);
  });

  it('sums durations for this month only', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-01', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-15', duration_min: '45' }),
      makeWorkout({ id: 'w3', date: '2026-02-28', duration_min: '90' }), // Last month (excluded)
    ];
    expect(getMonthTotalMinutes(workouts, today)).toBe(105);
  });

  it('AC4: workouts with no duration contribute 0 min but count in workout count', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-03-10', duration_min: '60' }),
      makeWorkout({ id: 'w2', date: '2026-03-12', duration_min: '' }),
    ];
    expect(getMonthTotalMinutes(workouts, today)).toBe(60);
    expect(getMonthWorkoutCount(workouts, today)).toBe(2);
  });
});

// ── Planned workout exclusion (caller responsibility) ────────────────

describe('week stats exclude planned workouts (via caller filtering)', () => {
  const today = '2026-03-15'; // week = Mar 9–15

  it('getWeekStreak: planned workouts filtered out by caller are not counted', () => {
    const completed = makeWorkout({ id: 'w_done', date: '2026-03-09', status: '' });
    const completedOnly = [completed];
    const days = getWeekStreak(completedOnly, today);

    expect(days[0].hasWorkout).toBe(true);  // Mon Mar 9 — completed
    expect(days[2].hasWorkout).toBe(false); // Wed Mar 11 — planned was excluded
  });

  it('getWeekWorkoutCount: planned workouts filtered out by caller are not counted', () => {
    const completed = makeWorkout({ id: 'w_done', date: '2026-03-09', status: '' });
    const completedOnly = [completed];
    expect(getWeekWorkoutCount(completedOnly, today)).toBe(1);
  });

  it('getWeekTotalMinutes: planned workouts filtered out by caller are not summed', () => {
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
