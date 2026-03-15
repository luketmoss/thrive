import type { WorkoutWithRow, SetWithRow, ExerciseWithRow } from '../../api/types';

// ── Equipment / non-muscle tags to exclude from card pills ───────────
export const EQUIPMENT_TAGS = new Set(['BB', 'DB', 'FT', 'Warmup']);

// ── Date grouping ────────────────────────────────────────────────────

export interface WorkoutGroup {
  label: string;
  workouts: WorkoutWithRow[];
}

/** Get the Monday of the week containing `dateStr` (ISO yyyy-mm-dd). */
function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? 6 : day - 1; // shift so Monday=0
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Groups workouts into date buckets: "This Week", "Last Week", then "Month Year".
 * Preserves the order of workouts within each group.
 * Empty groups are omitted.
 */
export function groupWorkoutsByDate(
  workouts: WorkoutWithRow[],
  todayStr: string,
): WorkoutGroup[] {
  if (workouts.length === 0) return [];

  const thisMonday = getMonday(todayStr);
  // Last week's Monday = this Monday - 7 days
  const lastMondayDate = new Date(thisMonday + 'T00:00:00');
  lastMondayDate.setDate(lastMondayDate.getDate() - 7);
  const lastMonday = lastMondayDate.toISOString().slice(0, 10);

  // Ordered map: label → workouts
  const groups = new Map<string, WorkoutWithRow[]>();

  for (const w of workouts) {
    const wMonday = getMonday(w.date);
    let label: string;
    if (wMonday === thisMonday) {
      label = 'This Week';
    } else if (wMonday === lastMonday) {
      label = 'Last Week';
    } else {
      // "Month Year"
      const d = new Date(w.date + 'T00:00:00');
      label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
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
