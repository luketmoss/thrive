import type { WorkoutWithRow, SetWithRow, ExerciseWithRow } from '../../api/types';

// ── Equipment / non-muscle tags to exclude from card pills ───────────
export const EQUIPMENT_TAGS = new Set(['BB', 'DB', 'FT', 'Warmup']);

// ── Date grouping (week-based) ───────────────────────────────────────

export interface WorkoutGroup {
  label: string;
  workouts: WorkoutWithRow[];
}

/**
 * Groups workouts into weekly sections: "This Week" (current Mon–Sun),
 * "Last Week" (previous Mon–Sun), and "Earlier" (everything before last week).
 * Each workout appears in exactly one section. Empty sections are omitted.
 * Preserves the order of workouts within each section.
 */
export function groupWorkoutsByDate(
  workouts: WorkoutWithRow[],
  todayStr: string,
): WorkoutGroup[] {
  if (workouts.length === 0) return [];

  const today = new Date(todayStr + 'T00:00:00');
  const day = today.getDay(); // 0=Sun…6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;

  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - diffToMonday);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const thisMondayStr = toLocalDateStr(thisMonday);
  const lastMondayStr = toLocalDateStr(lastMonday);

  const groups = new Map<string, WorkoutWithRow[]>();

  for (const w of workouts) {
    let label: string;
    if (w.date >= thisMondayStr) {
      label = 'This Week';
    } else if (w.date >= lastMondayStr) {
      label = 'Last Week';
    } else {
      label = 'Earlier';
    }

    let arr = groups.get(label);
    if (!arr) {
      arr = [];
      groups.set(label, arr);
    }
    arr.push(w);
  }

  // Enforce canonical order regardless of insertion order
  const ORDER = ['This Week', 'Last Week', 'Earlier'];
  return ORDER
    .filter(label => groups.has(label))
    .map(label => ({ label, workouts: groups.get(label)! }));
}

// ── Weekly streak ────────────────────────────────────────────────────

export interface WeekDay {
  label: string;  // 'M' | 'T' | 'W' | 'T' | 'F' | 'S' | 'S'
  date: string;   // ISO yyyy-mm-dd
  hasWorkout: boolean;
  isToday: boolean;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Format a Date as 'YYYY-MM-DD' in local time (avoids UTC shift from toISOString). */
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the Mon–Sun week days for the week containing `todayStr`,
 * with `hasWorkout` true for days that have at least one workout.
 * Reads from all workouts (unfiltered).
 */
export function getWeekStreak(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): WeekDay[] {
  const today = new Date(todayStr + 'T00:00:00');
  const day = today.getDay(); // 0=Sun…6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;

  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  // Build set of workout dates this week for fast lookup
  const workoutDates = new Set(allWorkouts.map(w => w.date));

  return DAY_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toLocalDateStr(d);
    return {
      label,
      date: dateStr,
      hasWorkout: workoutDates.has(dateStr),
      isToday: dateStr === todayStr,
    };
  });
}

/**
 * Returns the count of workouts in the Mon–Sun week containing `todayStr`.
 */
export function getWeekWorkoutCount(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const days = getWeekStreak(allWorkouts, todayStr);
  const weekDates = new Set(days.map(d => d.date));
  return allWorkouts.filter(w => weekDates.has(w.date)).length;
}

/**
 * Returns the total duration in minutes for workouts in the Mon–Sun week
 * containing `todayStr`. Skips workouts with empty or non-numeric duration_min.
 */
export function getWeekTotalMinutes(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const days = getWeekStreak(allWorkouts, todayStr);
  const weekDates = new Set(days.map(d => d.date));
  let total = 0;
  for (const w of allWorkouts) {
    if (!weekDates.has(w.date)) continue;
    const mins = parseInt(w.duration_min, 10);
    if (!isNaN(mins)) total += mins;
  }
  return total;
}

// ── Last-week helpers ────────────────────────────────────────────────

/** Returns the set of ISO date strings for the Mon–Sun week before `todayStr`. */
function getLastWeekDateSet(todayStr: string): Set<string> {
  const today = new Date(todayStr + 'T00:00:00');
  const day = today.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;

  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - diffToMonday);

  const dates = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - 7 + i);
    dates.add(toLocalDateStr(d));
  }
  return dates;
}

/**
 * Returns the count of workouts in the Mon–Sun week prior to the week
 * containing `todayStr`.
 */
export function getLastWeekWorkoutCount(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const lastWeekDates = getLastWeekDateSet(todayStr);
  return allWorkouts.filter(w => lastWeekDates.has(w.date)).length;
}

/**
 * Returns the total duration in minutes for workouts in the Mon–Sun week
 * prior to the week containing `todayStr`.
 */
export function getLastWeekTotalMinutes(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const lastWeekDates = getLastWeekDateSet(todayStr);
  let total = 0;
  for (const w of allWorkouts) {
    if (!lastWeekDates.has(w.date)) continue;
    const mins = parseInt(w.duration_min, 10);
    if (!isNaN(mins)) total += mins;
  }
  return total;
}

// ── This-month helpers ───────────────────────────────────────────────

/**
 * Returns the count of workouts in the current calendar month (1st to today).
 */
export function getMonthWorkoutCount(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const today = new Date(todayStr + 'T00:00:00');
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();
  return allWorkouts.filter(w => {
    const d = new Date(w.date + 'T00:00:00');
    return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
  }).length;
}

/**
 * Returns the total duration in minutes for workouts in the current calendar
 * month. Workouts with no duration contribute 0 minutes.
 */
export function getMonthTotalMinutes(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const today = new Date(todayStr + 'T00:00:00');
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();
  let total = 0;
  for (const w of allWorkouts) {
    const d = new Date(w.date + 'T00:00:00');
    if (d.getFullYear() !== thisYear || d.getMonth() !== thisMonth) continue;
    const mins = parseInt(w.duration_min, 10);
    if (!isNaN(mins)) total += mins;
  }
  return total;
}

// ── Tag aggregation ──────────────────────────────────────────────────

/**
 * Returns up to 3 most common muscle-group tags for a workout's exercises.
 * Excludes equipment tags (BB, DB, FT) and Warmup.
 */
export function getWorkoutTags(
  workoutSets: SetWithRow[],
  allExercises: ExerciseWithRow[],
): string[] {
  if (workoutSets.length === 0) return [];

  // Unique exercise IDs in this workout
  const exerciseIds = new Set(workoutSets.map(s => s.exercise_id));

  // Count tag occurrences across exercises (not sets)
  const tagCounts = new Map<string, number>();
  for (const ex of allExercises) {
    if (!exerciseIds.has(ex.id)) continue;
    const tags = ex.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const tag of tags) {
      if (EQUIPMENT_TAGS.has(tag)) continue;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // Sort by count desc, then alphabetically for ties
  return Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);
}
