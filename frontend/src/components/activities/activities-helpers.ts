import type { WorkoutWithRow, SetWithRow, ExerciseWithRow } from '../../api/types';

// ── Equipment / non-muscle tags to exclude from card pills ───────────
export const EQUIPMENT_TAGS = new Set(['BB', 'DB', 'FT', 'Warmup']);

// ── Date grouping (month-based) ──────────────────────────────────────

export interface WorkoutGroup {
  label: string;
  workouts: WorkoutWithRow[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Groups workouts into calendar-month buckets: "This Month", "Last Month",
 * then "Month Year" for older entries. Each workout appears in exactly one group.
 * Preserves the order of workouts within each group. Empty groups are omitted.
 */
export function groupWorkoutsByDate(
  workouts: WorkoutWithRow[],
  todayStr: string,
): WorkoutGroup[] {
  if (workouts.length === 0) return [];

  const today = new Date(todayStr + 'T00:00:00');
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();

  const lastMonthDate = new Date(today);
  lastMonthDate.setDate(1);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastYear = lastMonthDate.getFullYear();
  const lastMonth = lastMonthDate.getMonth();

  const groups = new Map<string, WorkoutWithRow[]>();

  for (const w of workouts) {
    const d = new Date(w.date + 'T00:00:00');
    const wYear = d.getFullYear();
    const wMonth = d.getMonth();

    let label: string;
    if (wYear === thisYear && wMonth === thisMonth) {
      label = 'This Month';
    } else if (wYear === lastYear && wMonth === lastMonth) {
      label = 'Last Month';
    } else {
      label = `${MONTH_NAMES[wMonth]} ${wYear}`;
    }

    let arr = groups.get(label);
    if (!arr) {
      arr = [];
      groups.set(label, arr);
    }
    arr.push(w);
  }

  return Array.from(groups.entries()).map(([label, wks]) => ({ label, workouts: wks }));
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
