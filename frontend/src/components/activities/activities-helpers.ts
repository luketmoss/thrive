import type { WorkoutWithRow, SetWithRow, ExerciseWithRow, Effort } from '../../api/types';
import { formatDuration } from '../../api/duration';

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
 * containing `todayStr`. Sums elapsed seconds and converts once at the end, so
 * no per-workout rounding accumulates. Workouts with an empty or non-numeric
 * `elapsed_seconds` are skipped, not counted as zero.
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
    const seconds = parseInt(w.elapsed_seconds, 10);
    if (!isNaN(seconds)) total += seconds;
  }
  return Math.round(total / 60);
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
 * prior to the week containing `todayStr`. Sums elapsed seconds and converts
 * once at the end; workouts with no duration are skipped, not counted as zero.
 */
export function getLastWeekTotalMinutes(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): number {
  const lastWeekDates = getLastWeekDateSet(todayStr);
  let total = 0;
  for (const w of allWorkouts) {
    if (!lastWeekDates.has(w.date)) continue;
    const seconds = parseInt(w.elapsed_seconds, 10);
    if (!isNaN(seconds)) total += seconds;
  }
  return Math.round(total / 60);
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
 * month. Sums elapsed seconds and converts once at the end. Workouts with no
 * duration are skipped, not counted as zero — a month with one 60-minute
 * session and three untimed ones totals 60, not an average of 15.
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
    const seconds = parseInt(w.elapsed_seconds, 10);
    if (!isNaN(seconds)) total += seconds;
  }
  return Math.round(total / 60);
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

// ── Planned workout scheduling (issue #99) ───────────────────────────

/** Whole-day difference between two 'YYYY-MM-DD' strings (b - a), local time. */
function dayDiff(fromStr: string, toStr: string): number {
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Formats a planned workout's scheduled date for display on its card.
 *
 * Today/Tomorrow/Yesterday read relatively; dates 2–6 days out get a weekday
 * so the user can plan around them; everything else falls back to a short
 * date, carrying the year only when it differs from the current one.
 */
export function formatPlannedDate(dateStr: string, todayStr: string): string {
  const diff = dayDiff(todayStr, dateStr);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';

  const date = new Date(dateStr + 'T00:00:00');
  const sameYear = date.getFullYear() === new Date(todayStr + 'T00:00:00').getFullYear();

  // 2–6 days out: weekday is more useful than the bare date
  if (diff >= 2 && diff <= 6) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** True when a planned workout's scheduled date has already passed. */
export function isOverdue(dateStr: string, todayStr: string): boolean {
  return dateStr < todayStr;
}

/**
 * Orders planned workouts soonest-first. A single ascending date sort also
 * satisfies "overdue above upcoming", since past dates sort before today.
 * Ties break on `created` then `id` so the order is stable across renders.
 */
export function sortPlannedWorkouts(workouts: WorkoutWithRow[]): WorkoutWithRow[] {
  return [...workouts].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.created.localeCompare(b.created) ||
      a.id.localeCompare(b.id),
  );
}

// ── Cardio aggregation (#105) ────────────────────────────────────────

/**
 * A total that cannot be rendered without its coverage.
 *
 * `withData` of `of` activities contributed to `total`; the rest recorded
 * nothing and were skipped, not counted as zero. Returning the pair in one
 * value is deliberate — a caller cannot reach for a bare total by accident,
 * and "58 mi" alone would silently overstate a week where only four of five
 * rides were measured.
 */
export interface CoveredTotal {
  total: number;
  withData: number;
  of: number;
}

/**
 * Names the activities being counted, so "2/3 rides" is accurate rather than
 * merely conventional — a week of hikes must not report rides.
 */
export function cardioNoun(cardio: WorkoutWithRow[]): string {
  const types = new Set(cardio.map((w) => w.type));
  if (types.size === 1) return types.has('bike') ? 'rides' : 'hikes';
  return 'activities';
}

/**
 * Renders coverage as a suffix naming *what* is counted — " · 4/5 rides",
 * never "(4 of 5)", which reads as four of five *miles*.
 *
 * Returns '' at full coverage: the total then stands alone, because coverage
 * is information about a gap and there is no gap to report.
 */
export function coverageSuffix(c: CoveredTotal, noun = 'rides'): string {
  return c.withData === c.of ? '' : ` · ${c.withData}/${c.of} ${noun}`;
}

/** Activities that can carry cardio attributes; see #103. */
const CARDIO_TYPES = new Set(['bike', 'hike']);

export function isCardioWorkout(w: WorkoutWithRow): boolean {
  return CARDIO_TYPES.has(w.type);
}

/**
 * Sums one nullable numeric field across the cardio activities in a set,
 * skipping those that recorded nothing while still counting them in `of`,
 * so the gap stays visible rather than having to be inferred.
 */
function sumCovered(
  cardio: WorkoutWithRow[],
  field: (w: WorkoutWithRow) => string,
): CoveredTotal {
  let total = 0;
  let withData = 0;
  for (const w of cardio) {
    const n = parseInt(field(w), 10);
    if (isNaN(n)) continue;
    total += n;
    withData += 1;
  }
  return { total, withData, of: cardio.length };
}

/** The cardio activities in the Mon–Sun week containing `todayStr`. */
export function getWeekCardioWorkouts(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): WorkoutWithRow[] {
  const weekDates = new Set(getWeekStreak(allWorkouts, todayStr).map((d) => d.date));
  return allWorkouts.filter((w) => weekDates.has(w.date) && isCardioWorkout(w));
}

/** Total distance in meters for this week's cardio, with coverage. */
export function getWeekCardioDistance(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): CoveredTotal {
  return sumCovered(getWeekCardioWorkouts(allWorkouts, todayStr), (w) => w.distance_m);
}

/** Total ascent in meters for this week's cardio, with its own coverage. */
export function getWeekCardioAscent(
  allWorkouts: WorkoutWithRow[],
  todayStr: string,
): CoveredTotal {
  // Counted independently of distance — a ride may have one and not the other.
  return sumCovered(getWeekCardioWorkouts(allWorkouts, todayStr), (w) => w.ascent_m);
}

// ── Card effort indicator (#113) ─────────────────────────────────────

/** `"5 exercises"` / `"1 exercise"`. */
export function pluralExercise(n: number): string {
  return `${n} exercise${n !== 1 ? 's' : ''}`;
}

/**
 * The spoken form of a workout's session effort, or `''` when nobody said.
 *
 * `''` is a legitimate permanent state (#101), so an unrated workout adds
 * nothing to its label rather than announcing "no effort" — which would be a
 * claim the data does not make.
 */
export function effortForSpeech(effort: Effort | ''): string {
  return effort ? `${effort.toLowerCase()} effort` : '';
}

/**
 * The full `aria-label` for a completed workout card.
 *
 * Lives here, and is the single source for the label, because the visible card
 * and its label are assembled from the same parts. When they were two separate
 * expressions in the screen, adding one optional part meant getting the
 * separator right twice.
 *
 * Effort is appended last so the opening of the label stays stable — screen
 * reader users scan these by their first words, and an unrated card's label is
 * unchanged from what it has always been.
 */
export function workoutCardAriaLabel(
  w: WorkoutWithRow,
  exerciseCount: number,
): string {
  return [
    w.name || w.type,
    w.type,
    w.date,
    formatDuration(w.elapsed_seconds),
    exerciseCount > 0 ? pluralExercise(exerciseCount) : '',
    effortForSpeech(w.effort),
  ].filter(Boolean).join(', ');
}
