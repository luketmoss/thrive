// Demo mode detection and seed data for offline/preview usage.

import type { ExerciseWithRow, LabelWithRow, JournalEntryWithRow, TemplateRowWithRow, Template, Workout, WorkoutWithRow, SetWithRow } from './types';
import type { DailyHealthRow, BodyMeasurementRow, DailySummaryRow } from './health-api';
import { colorKeyFromName } from './label-colors';
import type { SyncLogEntryWithRow } from './sync-log-api';
import { SyncLogNotSetUpError } from './sync-log-errors';
import { addDays, dayNumber, todayInDenver } from '../day/dates'; // the one copy of the Denver date rule (#262)

let _isDemo: boolean | null = null;

/** Returns true if the app is running in demo mode (env var or query param). */
export function isDemo(): boolean {
  if (_isDemo !== null) return _isDemo;
  _isDemo =
    import.meta.env.VITE_DEMO_MODE === 'true' ||
    new URLSearchParams(window.location.search).has('demo');
  return _isDemo;
}

export const DEMO_EXERCISES: ExerciseWithRow[] = [
  { id: 'ex_demo001', name: 'Bench Press BB', tags: 'Push, Chest, BB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 2 },
  { id: 'ex_demo002', name: 'Incline Press DB', tags: 'Push, Chest, DB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 3 },
  { id: 'ex_demo003', name: 'Cable Fly FT', tags: 'Push, Chest, FT', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 4 },
  { id: 'ex_demo004', name: 'Squat BB', tags: 'Legs, BB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 5 },
  { id: 'ex_demo005', name: 'Bulgarian Split Squats DB', tags: 'Legs, DB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 6 },
  { id: 'ex_demo006', name: 'RDL BB', tags: 'Legs, BB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 7 },
  { id: 'ex_demo007', name: 'Pullups', tags: 'Pull, Back', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 8 },
  { id: 'ex_demo008', name: 'Row BB', tags: 'Pull, Back, BB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 9 },
  { id: 'ex_demo009', name: 'Lateral Raise DB', tags: 'Push, Shoulders, DB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 10 },
  { id: 'ex_demo010', name: 'Rope Tricep Pushdown FT', tags: 'Push, Arms, FT', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 11 },
  { id: 'ex_demo011', name: 'Hammer Curls DB', tags: 'Pull, Arms, DB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 12 },
  { id: 'ex_demo012', name: 'Ab Wheel', tags: 'Core', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 13 },
  { id: 'ex_demo013', name: 'Crunch FT', tags: 'Core, FT', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 14 },
  { id: 'ex_demo014', name: 'Face Pulls FT', tags: 'Pull, Shoulders, FT', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 15 },
  { id: 'ex_demo015', name: 'OH Press BB', tags: 'Push, Shoulders, BB', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 16 },
  { id: 'ex_demo_pushup', name: 'Push Ups', tags: 'Warmup, Push, Chest', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 17 },
];

// Build demo labels from the unique tags in demo exercises
function buildDemoLabels(): LabelWithRow[] {
  const tagSet = new Set<string>();
  for (const ex of DEMO_EXERCISES) {
    if (ex.tags) {
      ex.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
  }
  const sorted = Array.from(tagSet).sort();
  return sorted.map((name, i) => ({
    id: `lbl_demo${String(i + 1).padStart(3, '0')}`,
    name,
    color_key: colorKeyFromName(name),
    created: '2025-01-01T00:00:00.000Z',
    sheetRow: i + 2,
  }));
}

export const DEMO_LABELS: LabelWithRow[] = buildDemoLabels();

const now = '2025-01-15T00:00:00.000Z';

export const DEMO_TEMPLATE_ROWS: TemplateRowWithRow[] = [
  // Upper Push A
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'warmup', sets: '', reps: '', sheetRow: 3 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 3, exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', sets: '5', reps: '4-6', sheetRow: 4 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 4, exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', sets: '3', reps: '12', sheetRow: 5 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 5, exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', sets: '3', reps: '15', sheetRow: 6 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 6, exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', sets: '3', reps: '15', sheetRow: 7 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 7, exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', sets: '3', reps: '15', sheetRow: 8 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 8, exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', sets: '3', reps: '10', sheetRow: 9 },

  // Upper Pull A
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 1, exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'warmup', sets: '', reps: '', sheetRow: 10 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 2, exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', sets: '5', reps: '6', sheetRow: 11 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 3, exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', sets: '3', reps: '10', sheetRow: 12 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 4, exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', sets: '3', reps: '15', sheetRow: 13 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 5, exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', sets: '3', reps: '12', sheetRow: 14 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 6, exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', sets: '3', reps: '15', sheetRow: 15 },
];

/** Group flat template rows into Template objects. */
function groupRows(rows: TemplateRowWithRow[]): Template[] {
  const map = new Map<string, Template>();
  for (const row of rows) {
    let tpl = map.get(row.template_id);
    if (!tpl) {
      tpl = { id: row.template_id, name: row.template_name, exercises: [] };
      map.set(row.template_id, tpl);
    }
    tpl.exercises.push(row);
  }
  // Sort exercises within each template by order
  for (const tpl of map.values()) {
    tpl.exercises.sort((a, b) => a.order - b.order);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export const DEMO_TEMPLATES: Template[] = groupRows(DEMO_TEMPLATE_ROWS);

// ── Demo Workouts ────────────────────────────────────────────────────

const workoutDate = '2025-01-14';

export const DEMO_WORKOUTS: WorkoutWithRow[] = [
  { id: 'w_demo001', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Felt strong today', elapsed_seconds: '3720', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Hard', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 2 },
  { id: 'w_demo002', date: '2025-01-13', time: '07:00', type: 'stretch', name: 'Morning Stretch', template_id: '', notes: 'Full body stretch, focused on hamstrings and hip flexors', elapsed_seconds: '1200', created: '2025-01-13T07:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Easy', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 3 },
  { id: 'w_demo003', date: '2025-01-12', time: '17:30', type: 'bike', name: 'Evening Ride', template_id: '', notes: 'Easy 30 min zone 2 ride on the trainer', elapsed_seconds: '1800', created: '2025-01-12T17:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Medium', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 4 },
  { id: 'w_demo004', date: '2025-01-07', time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Good session', elapsed_seconds: '3480', created: '2025-01-07T06:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 5 },
  // #129: one indoor and one outdoor sub-typed activity, so the venue-driven
  // field rules are exercised in demo mode.
  { id: 'w_demo006', date: '2025-01-11', time: '06:00', type: 'run', name: 'Treadmill Run', template_id: '', notes: 'Easy shakeout indoors', elapsed_seconds: '1860', created: '2025-01-11T06:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Easy', distance_m: '4828', ascent_m: '', descent_m: '', avg_hr: '142', sub_type: 'indoor', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 7 },
  { id: 'w_demo007', date: '2025-01-10', time: '15:00', type: 'walk', name: 'Neighborhood Walk', template_id: '', notes: '', elapsed_seconds: '2700', created: '2025-01-10T15:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: '', distance_m: '3219', ascent_m: '46', descent_m: '', avg_hr: '', sub_type: 'outdoor', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 8 },
  // #172: one COROS-synced hike with a duration and distance that the edit
  // form's whole minutes and tenths of a mile cannot represent, so demo mode
  // can show that an untouched measure survives a save exactly. It is also
  // #157's Synced example. #260: its fake, digit-only COROS ID and sport
  // code (104, hike) make demo mode show the "View on COROS" link; the
  // portal will say the activity does not exist, which is expected.
  { id: 'w_demo008', date: '2025-01-09', time: '08:10', type: 'hike', name: 'Ridge Trail', template_id: '', notes: '', elapsed_seconds: '5143', created: '2025-01-09T16:00:00.000Z', copied_from: '', status: '', moving_seconds: '4620', effort: '', distance_m: '6512', ascent_m: '293', descent_m: '288', avg_hr: '131', sub_type: 'outdoor', source: 'coros', source_activity_id: '100000000000000008', raw_ref: 'demo/raw/100000000000000008.json', fit_ref: '', fit_fetched_at: '', synced_at: '2025-01-09T18:00:00.000Z', started_at_utc: '2025-01-09T16:10:00.000Z', calories: '540', estimated_seconds: '', sport_type: '104', sheetRow: 9 },
  // #157: the Enriched example (sync plan §7). Logged by hand, so `source`
  // stays blank, then matched to a COROS strength activity, which filled only
  // the blanks: moving time, heart rate and calories. The hand-timed elapsed
  // and the effort are the user's and were left alone. `synced_at` is when it
  // was enriched. #260: a fake digit-only ID and the strength code (402), so
  // the link shows here too.
  { id: 'w_demo009', date: '2025-01-08', time: '06:45', type: 'weight', name: 'Leg Day', template_id: '', notes: '', elapsed_seconds: '3947', created: '2025-01-08T13:45:00.000Z', copied_from: '', status: '', moving_seconds: '3611', effort: 'Medium', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '112', sub_type: '', source: '', source_activity_id: '100000000000000009', raw_ref: 'demo/raw/100000000000000009.json', fit_ref: '', fit_fetched_at: '', synced_at: '2025-01-08T15:02:37.000Z', started_at_utc: '', calories: '387', estimated_seconds: '', sport_type: '402', sheetRow: 10 },
  { id: 'w_demo005', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Pull A', template_id: 'tpl_demo002', notes: '', elapsed_seconds: '', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: 'planned', moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '2820', sport_type: '', sheetRow: 6 },
  // #347: a plan from two days before the anchor that was never started, so
  // demo mode carries it onto today's Training panel as Overdue, with Move to
  // today, Reschedule and Start now to exercise.
  { id: 'w_demo010', date: '2025-01-12', time: '', type: 'weight', name: 'Lower Body B', template_id: '', notes: '', elapsed_seconds: '', created: '2025-01-11T20:00:00.000Z', copied_from: '', status: 'planned', moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '2400', sport_type: '', sheetRow: 11 },
];

// ── Demo workout dates relative to today (#250) ──────────────────────
//
// `DEMO_WORKOUTS` keeps its literal January 2025 dates (demo-provenance.test.ts
// asserts on them). The Day view and Activities read "today", so the read
// boundary (`fetchWorkouts`) shifts the whole fixture by one whole-day delta.
// Every workout moves together, so done/planned ordering stays coherent.

/** The fixture's own "today": carries both a done and a planned workout. */
export const DEMO_ANCHOR_DATE = '2025-01-14';

const MS_PER_DAY = 86_400_000;

/** Shifts an ISO-8601 timestamp by whole days, preserving time-of-day. Blank stays blank. */
export function addDaysToIso(iso: string, days: number): string {
  if (!iso) return iso;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * MS_PER_DAY).toISOString();
}

/**
 * The fixture with every date moved so `DEMO_ANCHOR_DATE` lands on today in
 * Denver. Pure and deterministic; never mutates the fixture.
 */
export function shiftDemoWorkouts(now: Date, fixture: WorkoutWithRow[] = DEMO_WORKOUTS): WorkoutWithRow[] {
  const delta = dayNumber(todayInDenver(now)) - dayNumber(DEMO_ANCHOR_DATE);
  return fixture.map((w) => ({
    ...w,
    date: w.date ? addDays(w.date, delta) : w.date,
    created: addDaysToIso(w.created, delta),
    synced_at: addDaysToIso(w.synced_at, delta),
    started_at_utc: addDaysToIso(w.started_at_utc, delta),
    fit_fetched_at: addDaysToIso(w.fit_fetched_at, delta),
  }));
}

// ── Demo Journal (#233) ──────────────────────────────────────────────
//
// Literal dates around DEMO_ANCHOR_DATE, like DEMO_WORKOUTS; `fetchJournal`
// shifts them with `shiftDemoJournal` so "today" and the days behind it stay
// current. One note per day, none blank, sheet order (oldest first).
export const DEMO_JOURNAL: JournalEntryWithRow[] = [
  { date: '2024-12-20', note: 'Travel day. No training, long walk at the airport.', created: '2024-12-20T23:10:00.000Z', updated: '2024-12-20T23:10:00.000Z', sheetRow: 2 },
  { date: '2025-01-02', note: 'Back in the gym after the break. Legs felt heavy, kept the weights light.', created: '2025-01-02T19:40:00.000Z', updated: '2025-01-02T19:55:00.000Z', sheetRow: 3 },
  { date: '2025-01-08', note: 'Squats moved well. Slept badly the night before but energy was fine.', created: '2025-01-08T20:05:00.000Z', updated: '2025-01-08T20:05:00.000Z', sheetRow: 4 },
  { date: '2025-01-12', note: 'Easy hike with the dog. Left knee a little sore on the descent.', created: '2025-01-12T22:30:00.000Z', updated: '2025-01-13T14:02:00.000Z', sheetRow: 5 },
  { date: '2025-01-13', note: 'Rest day. Stretched for twenty minutes, meal prepped for the week.', created: '2025-01-13T21:15:00.000Z', updated: '2025-01-13T21:15:00.000Z', sheetRow: 6 },
  { date: '2025-01-14', note: 'Bench felt strong, hit 185 for five. Shoulder is fine. Pull day tomorrow.', created: '2025-01-14T18:20:00.000Z', updated: '2025-01-14T18:20:00.000Z', sheetRow: 7 },
];

/** The demo journal with every date moved as `shiftDemoWorkouts` moves the workouts. Pure. */
export function shiftDemoJournal(now: Date, fixture: JournalEntryWithRow[] = DEMO_JOURNAL): JournalEntryWithRow[] {
  const delta = dayNumber(todayInDenver(now)) - dayNumber(DEMO_ANCHOR_DATE);
  return fixture.map((e) => ({
    ...e,
    date: addDays(e.date, delta),
    created: addDaysToIso(e.created, delta),
    updated: addDaysToIso(e.updated, delta),
  }));
}

export const DEMO_SETS: SetWithRow[] = [
  // Warmup — Push Ups (no weight/reps tracked for warmup)
  { workout_id: 'w_demo001', exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '15', effort: '', sheetRow: 2 },
  // Warmup — Bench Press light
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'warmup', exercise_order: 2, set_number: 1, planned_reps: '', weight: '95', reps: '10', effort: 'Easy', sheetRow: 3 },
  // Primary — Bench Press working sets
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '185', reps: '6', effort: 'Medium', sheetRow: 4 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Medium', sheetRow: 5 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Hard', sheetRow: 6 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 4, planned_reps: '4-6', weight: '185', reps: '4', effort: 'Hard', sheetRow: 7 },
  // SS1 — Incline Press DB
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '10-12', weight: '55', reps: '12', effort: 'Medium', sheetRow: 8 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '10-12', weight: '55', reps: '11', effort: 'Medium', sheetRow: 9 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '10-12', weight: '55', reps: '10', effort: 'Hard', sheetRow: 10 },
  // SS1 — Cable Fly FT
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 1, planned_reps: '12-15', weight: '25', reps: '15', effort: 'Easy', sheetRow: 11 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 2, planned_reps: '12-15', weight: '25', reps: '14', effort: 'Medium', sheetRow: 12 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 3, planned_reps: '12-15', weight: '25', reps: '12', effort: 'Medium', sheetRow: 13 },
  // SS2 — Lateral Raise DB
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 1, planned_reps: '12-15', weight: '15', reps: '15', effort: 'Medium', sheetRow: 14 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 2, planned_reps: '12-15', weight: '15', reps: '13', effort: 'Medium', sheetRow: 15 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 3, planned_reps: '12-15', weight: '15', reps: '12', effort: 'Hard', sheetRow: 16 },
  // SS2 — Rope Tricep Pushdown FT
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 1, planned_reps: '12-15', weight: '40', reps: '15', effort: 'Medium', sheetRow: 17 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 2, planned_reps: '12-15', weight: '40', reps: '13', effort: 'Medium', sheetRow: 18 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 3, planned_reps: '12-15', weight: '40', reps: '12', effort: 'Hard', sheetRow: 19 },
  // Burnout — Ab Wheel
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 1, planned_reps: '6-10', weight: '', reps: '10', effort: 'Medium', sheetRow: 20 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 2, planned_reps: '6-10', weight: '', reps: '8', effort: 'Hard', sheetRow: 21 },

  // ── Previous workout (w_demo004 — Jan 7) for last-time panel testing ──
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '175', reps: '6', effort: 'Medium', sheetRow: 22 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '175', reps: '6', effort: 'Medium', sheetRow: 23 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '175', reps: '5', effort: 'Hard', sheetRow: 24 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '10-12', weight: '50', reps: '12', effort: 'Easy', sheetRow: 25 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '10-12', weight: '50', reps: '11', effort: 'Medium', sheetRow: 26 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '10-12', weight: '50', reps: '10', effort: 'Medium', sheetRow: 27 },

  // ── Planned workout (w_demo005 — Upper Pull A) — prepopulated set structure ──
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '4-6', weight: '', reps: '', effort: '', sheetRow: 28 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 2, planned_reps: '4-6', weight: '', reps: '', effort: '', sheetRow: 29 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 3, planned_reps: '4-6', weight: '', reps: '', effort: '', sheetRow: 30 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 4, planned_reps: '4-6', weight: '', reps: '', effort: '', sheetRow: 31 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 5, planned_reps: '4-6', weight: '', reps: '', effort: '', sheetRow: 32 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 1, planned_reps: '10', weight: '', reps: '', effort: '', sheetRow: 33 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 2, planned_reps: '10', weight: '', reps: '', effort: '', sheetRow: 34 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 3, planned_reps: '10', weight: '', reps: '', effort: '', sheetRow: 35 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 36 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 37 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 38 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 1, planned_reps: '12', weight: '', reps: '', effort: '', sheetRow: 39 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 2, planned_reps: '12', weight: '', reps: '', effort: '', sheetRow: 40 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 3, planned_reps: '12', weight: '', reps: '', effort: '', sheetRow: 41 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 1, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 42 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 2, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 43 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 3, planned_reps: '15', weight: '', reps: '', effort: '', sheetRow: 44 },

  // ── Enriched workout (w_demo009 — Leg Day, Jan 8, #157) ──
  { workout_id: 'w_demo009', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '5', weight: '225', reps: '5', effort: 'Medium', sheetRow: 45 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 2, planned_reps: '5', weight: '225', reps: '5', effort: 'Medium', sheetRow: 46 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 3, planned_reps: '5', weight: '225', reps: '4', effort: 'Hard', sheetRow: 47 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo006', exercise_name: 'RDL BB', section: 'SS1', exercise_order: 2, set_number: 1, planned_reps: '8', weight: '185', reps: '8', effort: 'Medium', sheetRow: 48 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo006', exercise_name: 'RDL BB', section: 'SS1', exercise_order: 2, set_number: 2, planned_reps: '8', weight: '185', reps: '7', effort: 'Hard', sheetRow: 49 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo005', exercise_name: 'Bulgarian Split Squats DB', section: 'SS1', exercise_order: 3, set_number: 1, planned_reps: '10', weight: '40', reps: '10', effort: 'Medium', sheetRow: 50 },
  { workout_id: 'w_demo009', exercise_id: 'ex_demo005', exercise_name: 'Bulgarian Split Squats DB', section: 'SS1', exercise_order: 3, set_number: 2, planned_reps: '10', weight: '40', reps: '9', effort: 'Hard', sheetRow: 51 },
  // ── Overdue planned workout (w_demo010 — Lower Body B, Jan 12, #347) ──
  { workout_id: 'w_demo010', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '5', weight: '', reps: '', effort: '', sheetRow: 52 },
  { workout_id: 'w_demo010', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 2, planned_reps: '5', weight: '', reps: '', effort: '', sheetRow: 53 },
  { workout_id: 'w_demo010', exercise_id: 'ex_demo004', exercise_name: 'Squat BB', section: 'primary', exercise_order: 1, set_number: 3, planned_reps: '5', weight: '', reps: '', effort: '', sheetRow: 54 },
  { workout_id: 'w_demo010', exercise_id: 'ex_demo006', exercise_name: 'RDL BB', section: 'SS1', exercise_order: 2, set_number: 1, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: 55 },
  { workout_id: 'w_demo010', exercise_id: 'ex_demo006', exercise_name: 'RDL BB', section: 'SS1', exercise_order: 2, set_number: 2, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: 56 },
];

// ── Demo SyncLog (#157) ──────────────────────────────────────────────
//
// Generated relative to `now`, since the Settings line shows an age: fixed
// dates would read as stale forever. `?demo=true&synclog=<scenario>` previews
// each state; the default is a healthy log.

export type DemoSyncScenario = 'ok' | 'stale' | 'failed' | 'partial' | 'empty' | 'error';

const DEMO_SYNC_SCENARIOS: Record<Exclude<DemoSyncScenario, 'error'>, { hoursAgo: number; status: 'ok' | 'partial' | 'failed' }[]> = {
  // Newest first. Gaps echo the real 4/5/6/9 h schedule; minutes are odd on
  // purpose so nothing reads as a rounded fixture.
  ok:      [{ hoursAgo: 2.37, status: 'ok' }, { hoursAgo: 7.37, status: 'ok' }, { hoursAgo: 11.37, status: 'ok' }, { hoursAgo: 20.37, status: 'ok' }],
  // The job stopped: nothing for 19 h, past the watchdog's 16.
  stale:   [{ hoursAgo: 19.62, status: 'ok' }, { hoursAgo: 25.62, status: 'ok' }, { hoursAgo: 29.62, status: 'ok' }],
  // Two failed runs, so the "last successful" line has something to say.
  failed:  [{ hoursAgo: 1.21, status: 'failed' }, { hoursAgo: 6.21, status: 'failed' }, { hoursAgo: 10.21, status: 'ok' }],
  partial: [{ hoursAgo: 3.08, status: 'partial' }, { hoursAgo: 8.08, status: 'ok' }],
  empty:   [],
};

export function demoSyncScenario(): DemoSyncScenario {
  const raw = new URLSearchParams(window.location.search).get('synclog');
  return raw && (raw === 'error' || raw in DEMO_SYNC_SCENARIOS) ? raw as DemoSyncScenario : 'ok';
}

/** Builds a scenario's runs, oldest row first — shared by COROS and Withings so their fixtures agree in shape. */
function buildDemoSyncRuns(now: Date, scenario: Exclude<DemoSyncScenario, 'error'>, idPrefix: string): SyncLogEntryWithRow[] {
  const runs = DEMO_SYNC_SCENARIOS[scenario];
  return runs.slice().reverse().map((run, i) => {
    const started = new Date(now.getTime() - Math.round(run.hoursAgo * 3600_000));
    const finished = new Date(started.getTime() + 47_318);
    const failed = run.status === 'failed';
    return {
      run_id: `${idPrefix}${1000 + i}-1`,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      // D - 10 to D + 1, as the sync's window is (#156).
      window_start: new Date(started.getTime() - 10 * 86400_000).toISOString().slice(0, 10),
      window_end: new Date(started.getTime() + 86400_000).toISOString().slice(0, 10),
      n_seen: failed ? '0' : '3',
      n_new: '0',
      n_updated: '0',
      n_enriched: '0',
      n_fit_fetched: failed ? '0' : '1',
      n_errors: run.status === 'ok' ? '0' : '1',
      status: run.status,
      error_detail: failed ? 'CorosApiError: demo failure (never shown in the app)' : run.status === 'partial' ? 'demo_act_003: demo failure (never shown in the app)' : '',
      notes: '',
      sheetRow: i + 2,
    };
  });
}

/** The demo SyncLog as the sheet would hold it, oldest row first. */
export function demoSyncLog(now: Date, scenario: DemoSyncScenario = demoSyncScenario()): SyncLogEntryWithRow[] {
  if (scenario === 'error') throw new Error('Demo: SyncLog unreadable (synclog=error)');
  return buildDemoSyncRuns(now, scenario, 'schedule-demo');
}

// ── Demo WithingsSyncLog (#200, #210) ────────────────────────────────
//
// Same scenarios as COROS, plus `missing`, which previews AC3's "the tab
// doesn't exist yet" state. `?demo=true&withingslog=<scenario>` drives it
// independently of `synclog=`, so the two rows can be previewed in any
// combination.

export type DemoWithingsSyncScenario = DemoSyncScenario | 'missing';

export function demoWithingsSyncScenario(): DemoWithingsSyncScenario {
  const raw = new URLSearchParams(window.location.search).get('withingslog');
  return raw && (raw === 'error' || raw === 'missing' || raw in DEMO_SYNC_SCENARIOS)
    ? raw as DemoWithingsSyncScenario
    : 'ok';
}

/** The demo WithingsSyncLog as the sheet would hold it, oldest row first. */
export function demoWithingsSyncLog(
  now: Date,
  scenario: DemoWithingsSyncScenario = demoWithingsSyncScenario(),
): SyncLogEntryWithRow[] {
  if (scenario === 'missing') throw new SyncLogNotSetUpError('Demo: WithingsSyncLog not set up (withingslog=missing)');
  if (scenario === 'error') throw new Error('Demo: WithingsSyncLog unreadable (withingslog=error)');
  return buildDemoSyncRuns(now, scenario, 'withings-schedule-demo');
}

// ── Demo health data (#236) ──────────────────────────────────────────
//
// 90 local days of DailyHealth, BodyMeasurements and DailySummary ending
// today in Denver, generated relative to `now` so the Day view and Trends
// always have a recent history. Deterministic: every value is a function of
// its date alone (a hash of the day number, never Math.random), so the same
// date always shows the same values. The one exception is today, which is a
// partial day: steps so far, and only the readings taken before `now`.
//
// Gaps and edge cases repeat on a 30-day cycle keyed by the day number, so
// the 90 days carry each of them at least twice, and every 30-day window
// holds exactly one cycle (health-demo.test.ts checks the invariants).
//
// `?demo=true&health=empty` loads all three tabs empty and `health=error`
// fails all three, following `synclog=`. `health=presync` (#239) is the
// morning before the day's first sync: today has no DailyHealth row and no
// BodyMeasurements readings, and DailySummary is rolled up without them.

export type DemoHealthScenario = 'ok' | 'empty' | 'error' | 'presync';

export function demoHealthScenario(): DemoHealthScenario {
  const raw = new URLSearchParams(window.location.search).get('health');
  return raw === 'empty' || raw === 'error' || raw === 'presync' ? raw : 'ok';
}

/** How many local days the demo history spans, today included. */
export const DEMO_HEALTH_DAYS = 90;

/** The oldest days' rows sit at the end of the sheet, as a backfill leaves them. */
const DEMO_BACKFILLED_DAYS = 10;

// Positions in the 30-day cycle (day number mod 30).
const HEALTH_NO_ROW = [5, 6, 7, 19];         // no DailyHealth row at all; 5-7 is a run of 3
const HEALTH_CHARGER_NIGHT = [12, 25];       // steps present, sleep (and its HRV) blank
const HEALTH_HRV_BLANK = [9, 22];            // slept, but no HRV average
const SCALE_NONE = [2, 5, 6, 7, 13, 20, 27]; // mornings with no scale reading
const SCALE_TWO = 10;                        // a morning and an evening weigh-in
const SCALE_NO_WEIGHT_FIRST = 16;            // the first reading has no weight, the second does
const SCALE_NO_WEIGHT_ONLY = 23;             // the day's only reading has no weight
const SCALE_WEIGHT_ONLY = 24;                // a weight with no body composition
const ACTIVITY_PARTIAL = 11;                 // two outdoor sessions, one unmeasured
const ACTIVITY_ZERO_DISTANCE = 26;           // a measured 0 distance
const ACTIVITY_INDOOR_ONLY = 13;             // an indoor ride: no outdoor distance at all
const ACTIVITY_MIXED_VENUE = 14;             // an indoor ride and an outdoor hike on one day (#266)
const ACTIVITY_TWO_EFFORTS = 28;             // a hard ride and an easy walk: two effort levels (#266)
// #239: one day a cycle outside your range the unwelcome way, so the Day view's
// colouring can always be seen within the last 30 days.
const HEALTH_RHR_HIGH = 4;                   // resting HR well above its range
const HEALTH_HRV_LOW = 15;                   // HRV well below its range
// #253: stress_avg has its own gaps, independent of the other metrics (a row
// can exist without it; 10-12 is a run of 3), and one high-stress day a cycle.
const HEALTH_STRESS_BLANK = [10, 11, 12, 23]; // a row, but COROS gave no stress average
const HEALTH_STRESS_HIGH = 8;                // average stress well above its range

function cyclePos(day: number): number {
  return ((day % 30) + 30) % 30;
}

/** A deterministic value in [0, 1) for a day and a salt. */
function demoNoise(day: number, salt: number): number {
  let x = (Math.imul(day, 374761393) + Math.imul(salt, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function wave(day: number, period: number): number {
  return Math.sin((2 * Math.PI * day) / period);
}

function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Denver's UTC offset on a local date, as "-06:00" or "-07:00" (read at noon, clear of the 02:00 switch). */
function denverOffset(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23',
  }).format(noonUtc));
  const off = hour - 12;
  return `${off < 0 ? '-' : '+'}${String(Math.abs(off)).padStart(2, '0')}:00`;
}

/** An instant no later than `now`, as ISO. */
function notAfter(t: number, now: Date): string {
  return new Date(Math.min(t, now.getTime())).toISOString();
}

/** The 90 local days ending today, oldest first, with their day numbers. */
function demoHealthDays(now: Date): { date: string; day: number; isToday: boolean }[] {
  const today = todayInDenver(now);
  const todayNum = dayNumber(today);
  const days = [];
  for (let i = DEMO_HEALTH_DAYS - 1; i >= 0; i--) {
    days.push({ date: addDays(today, -i), day: todayNum - i, isToday: i === 0 });
  }
  return days;
}

/** Sheet order after a backfill: the oldest days' rows were appended last. */
function asBackfilled<T extends { date: string; sheetRow: number }>(rows: Omit<T, 'sheetRow'>[], oldestDate: string): T[] {
  const cutoff = addDays(oldestDate, DEMO_BACKFILLED_DAYS);
  const recent = rows.filter((r) => r.date >= cutoff);
  const backfilled = rows.filter((r) => r.date < cutoff);
  return [...recent, ...backfilled].map((r, i) => ({ ...r, sheetRow: i + 2 }) as T);
}

function buildDemoDailyHealth(now: Date, presync = false): DailyHealthRow[] {
  const days = demoHealthDays(now).filter((d) => !(presync && d.isToday));
  const rows: Omit<DailyHealthRow, 'sheetRow'>[] = [];
  for (const { date, day, isToday } of days) {
    const p = cyclePos(day);
    // Today always has its partial row, whatever the cycle says.
    if (!isToday && HEALTH_NO_ROW.includes(p)) continue;

    const charger = !isToday && HEALTH_CHARGER_NIGHT.includes(p);
    const hrvBlank = charger || (!isToday && HEALTH_HRV_BLANK.includes(p));
    const fullSteps = Math.round(8800 + 3200 * wave(day, 7) + 3000 * (demoNoise(day, 3) - 0.5));
    // Today is partial: the steps and calories so far.
    const steps = isToday ? Math.round(fullSteps * 0.4) : fullSteps;
    const calories = Math.round((isToday ? 900 : 1950) + steps * 0.04 + 120 * demoNoise(day, 4));

    const sleepMin = 6 * 60 + Math.round(150 * demoNoise(day, 5));
    const awakeMin = Math.round(sleepMin * (0.03 + 0.04 * demoNoise(day, 6)));
    const deepMin = Math.round(sleepMin * (0.13 + 0.05 * demoNoise(day, 7)));
    const remMin = Math.round(sleepMin * (0.19 + 0.05 * demoNoise(day, 8)));
    const lightMin = sleepMin - awakeMin - deepMin - remMin;
    const bedMin = 21 * 60 + 45 + Math.round(75 * demoNoise(day, 9));
    // Average stress: low is better, whole numbers, 19-35 on an ordinary day. Today's is
    // the average so far, still a value. The high day is pinned, not noise-dependent.
    const stressBlank = !isToday && HEALTH_STRESS_BLANK.includes(p);
    const stress = p === HEALTH_STRESS_HIGH && !isToday
      ? 41 + Math.round(4 * demoNoise(day, 14))
      : Math.round(27 + 4 * wave(day, 19) + 8 * (demoNoise(day, 14) - 0.5));
    // A night on the charger is blank, never zero sleep.
    const sleep = (v: number | string) => (charger ? '' : String(v));

    rows.push({
      date,
      resting_hr: String(Math.round(51 + 2.5 * wave(day, 17) + 3 * (demoNoise(day, 1) - 0.5)) + (p === HEALTH_RHR_HIGH ? 9 : 0)),
      hrv: hrvBlank ? '' : String(Math.round(58 + 8 * wave(day, 23) + 10 * (demoNoise(day, 2) - 0.5)) - (p === HEALTH_HRV_LOW ? 30 : 0)),
      steps: String(steps),
      calories: String(calories),
      sleep_total_s: sleep(sleepMin * 60),
      sleep_deep_s: sleep(deepMin * 60),
      sleep_rem_s: sleep(remMin * 60),
      sleep_light_s: sleep(lightMin * 60),
      sleep_awake_s: sleep(awakeMin * 60),
      sleep_score: sleep(Math.round(62 + 30 * demoNoise(day, 10))),
      // Current-state snapshots: written on some days only, and on today's.
      vo2max: isToday || p % 4 === 0 ? String(47 + Math.floor(3 * demoNoise(day, 11))) : '',
      recovery: isToday || p % 3 === 0 ? String(Math.round(35 + 60 * demoNoise(day, 12))) : '',
      // The day is not over, so its load is not in yet.
      training_load: isToday ? '' : String(Math.round(20 + 100 * demoNoise(day, 13))),
      bed_time: sleep(hhmm(bedMin)),
      wake_time: sleep(hhmm(bedMin + sleepMin)),
      raw_ref: `demo/health/${date}.json`,
      synced_at: notAfter(Date.parse(`${addDays(date, isToday ? 0 : 1)}T12:17:04.000Z`), now),
      stress_avg: stressBlank ? '' : String(stress),
    });
  }
  return asBackfilled<DailyHealthRow>(rows, days[0].date);
}

type DemoMeasures = Pick<BodyMeasurementRow,
  'weight_kg' | 'fat_ratio_pct' | 'fat_mass_kg' | 'fat_free_mass_kg' | 'muscle_mass_kg' |
  'hydration_kg' | 'bone_mass_kg' | 'systolic_mmhg' | 'diastolic_mmhg' | 'pulse_bpm'>;

const NO_MEASURES: DemoMeasures = {
  weight_kg: '', fat_ratio_pct: '', fat_mass_kg: '', fat_free_mass_kg: '', muscle_mass_kg: '',
  hydration_kg: '', bone_mass_kg: '', systolic_mmhg: '', diastolic_mmhg: '', pulse_bpm: '',
};

function scaleMeasures(day: number, shiftKg: number, composition: boolean): DemoMeasures {
  const weight = 81.4 + 0.9 * wave(day, 29) + 0.6 * (demoNoise(day, 20) - 0.5) + shiftKg;
  const pulse = String(Math.round(60 + 8 * demoNoise(day, 21)));
  if (!composition) return { ...NO_MEASURES, weight_kg: weight.toFixed(1), pulse_bpm: pulse };
  const ratio = 19.2 + 0.8 * wave(day, 31) + 0.6 * (demoNoise(day, 22) - 0.5);
  const fatMass = (weight * ratio) / 100;
  const fatFree = weight - fatMass;
  return {
    ...NO_MEASURES,
    weight_kg: weight.toFixed(1),
    fat_ratio_pct: ratio.toFixed(1),
    fat_mass_kg: fatMass.toFixed(2),
    fat_free_mass_kg: fatFree.toFixed(2),
    muscle_mass_kg: (fatFree * 0.94).toFixed(2),
    hydration_kg: (fatFree * 0.72).toFixed(2),
    bone_mass_kg: '3.31',
    pulse_bpm: pulse,
  };
}

function bpMeasures(day: number, salt: number, fixed?: [number, number]): DemoMeasures {
  const [sys, dia] = fixed ?? [
    116 + Math.round(8 * demoNoise(day, 30 + salt)),
    74 + Math.round(6 * demoNoise(day, 40 + salt)),
  ];
  return {
    ...NO_MEASURES,
    systolic_mmhg: String(sys),
    diastolic_mmhg: String(dia),
    pulse_bpm: String(Math.round(62 + 8 * demoNoise(day, 50 + salt))),
  };
}

function buildDemoBodyMeasurements(now: Date, presync = false): BodyMeasurementRow[] {
  const days = demoHealthDays(now).filter((d) => !(presync && d.isToday));
  const rows: Omit<BodyMeasurementRow, 'sheetRow'>[] = [];
  for (const { date, day } of days) {
    const p = cyclePos(day);
    const offset = denverOffset(date);
    const readings: { minutes: number; kind: 'scale' | 'bp'; measures: DemoMeasures }[] = [];
    const morning = 6 * 60 + 25 + Math.round(20 * demoNoise(day, 23));

    if (p === SCALE_NO_WEIGHT_FIRST) {
      // Stepped off early: the scale kept only the standing heart rate.
      readings.push({ minutes: morning, kind: 'scale', measures: { ...NO_MEASURES, pulse_bpm: '64' } });
      readings.push({ minutes: morning + 2, kind: 'scale', measures: scaleMeasures(day, 0, true) });
    } else if (p === SCALE_NO_WEIGHT_ONLY) {
      readings.push({ minutes: morning, kind: 'scale', measures: { ...NO_MEASURES, pulse_bpm: '66' } });
    } else if (p === SCALE_TWO) {
      readings.push({ minutes: morning, kind: 'scale', measures: scaleMeasures(day, 0, true) });
      readings.push({ minutes: 19 * 60 + 20, kind: 'scale', measures: scaleMeasures(day, 0.9, true) });
    } else if (!SCALE_NONE.includes(p)) {
      readings.push({ minutes: morning, kind: 'scale', measures: scaleMeasures(day, 0, p !== SCALE_WEIGHT_ONLY) });
    }

    if (p % 5 === 1) {
      // A pair a few minutes apart. On the cycle's 1st day their means land on
      // .5, so the summary's half-up rounding shows; the 11th adds an evening one.
      readings.push({ minutes: 7 * 60 + 5, kind: 'bp', measures: bpMeasures(day, 0, p === 1 ? [118, 76] : undefined) });
      readings.push({ minutes: 7 * 60 + 8, kind: 'bp', measures: bpMeasures(day, 1, p === 1 ? [121, 79] : undefined) });
      if (p === 11) readings.push({ minutes: 21 * 60 + 40, kind: 'bp', measures: bpMeasures(day, 2) });
    } else if (p % 5 === 3) {
      readings.push({ minutes: 7 * 60 + 5, kind: 'bp', measures: bpMeasures(day, 0) });
    }

    readings.forEach((r, k) => {
      const time = hhmm(r.minutes);
      const measured = `${date}T${time}:00${offset}`;
      const t = Date.parse(measured);
      if (t > now.getTime()) return; // not taken yet today
      const grpid = String(5_000_000 + day * 10 + k);
      rows.push({
        grpid,
        date,
        time,
        measured_at_utc: measured,
        kind: r.kind,
        device_model: r.kind === 'scale' ? 'Body+' : 'BPM Connect',
        ...r.measures,
        attrib: '0',
        source: 'withings',
        raw_ref: `demo/withings/${grpid}.json`,
        synced_at: notAfter(t + 40 * 60_000, now),
      });
    });
  }
  return asBackfilled<BodyMeasurementRow>(rows, days[0].date);
}

// Demo activities, only so DailySummary's activity columns have something to
// roll up. The last seven days are the demo Workouts themselves, so a day's
// summary agrees with its activity list; older days follow the cycle and
// exist only in the summary.

export type DemoActivity = Pick<Workout, 'type' | 'sub_type' | 'moving_seconds' | 'elapsed_seconds' | 'distance_m' | 'ascent_m' | 'effort'>;

function act(
  type: Workout['type'], sub_type: string, moving: string, elapsed: string,
  distance: string, ascent: string, effort: Workout['effort'],
): DemoActivity {
  return { type, sub_type, moving_seconds: moving, elapsed_seconds: elapsed, distance_m: distance, ascent_m: ascent, effort };
}

function syntheticActivities(day: number): DemoActivity[] {
  const p = cyclePos(day);
  if ([0, 8, 15, 22].includes(p)) {
    return [act('weight', '', '', String(3300 + Math.round(600 * demoNoise(day, 60))), '', '', demoNoise(day, 61) > 0.5 ? 'Hard' : 'Medium')];
  }
  if (p === 3 || p === 17) {
    return [act('bike', 'mountain', '4210', '4735', String(22000 + Math.round(6000 * demoNoise(day, 62))), String(380 + Math.round(120 * demoNoise(day, 63))), 'Hard')];
  }
  if (p === ACTIVITY_PARTIAL) {
    return [
      act('hike', 'outdoor', '5400', '6120', '9812', '521', 'Medium'),
      act('walk', 'outdoor', '', '1500', '', '', ''),
    ];
  }
  if (p === ACTIVITY_ZERO_DISTANCE) return [act('walk', 'outdoor', '480', '600', '0', '0', 'Easy')];
  if (p === ACTIVITY_INDOOR_ONLY) return [act('bike', 'indoor', '2700', '2760', '21000', '', 'Medium')];
  if (p === ACTIVITY_MIXED_VENUE) {
    return [
      act('bike', 'indoor', '1800', '1860', '15000', '', 'Easy'),
      act('hike', 'outdoor', '3600', '3900', '6400', '310', 'Medium'),
    ];
  }
  if (p === ACTIVITY_TWO_EFFORTS) {
    return [
      act('bike', 'road', '3300', '3420', '27500', '240', 'Hard'),
      act('walk', 'outdoor', '900', '960', '1800', '12', 'Easy'),
    ];
  }
  if (p === 20) return [act('stretch', '', '', '1200', '', '', '')];
  return [];
}

// The rollup below follows buildDaySummary in apps-script/src/daily-summary.js
// rule for rule, so the demo tab reads the way the real one does.

const DEMO_INDOOR_SUB_TYPES = ['indoor'];
const DEMO_CARDIO_TYPES = ['bike', 'hike', 'run', 'walk'];
const DEMO_EFFORTS = ['Easy', 'Medium', 'Hard'];

/** A covered total as its cells: both blank with nothing to cover, the total blank when nothing contributed. */
function coveredCells(ws: DemoActivity[], field: 'moving_seconds' | 'elapsed_seconds' | 'distance_m' | 'ascent_m') {
  if (!ws.length) return { total: '', withData: '' };
  let total = 0;
  let withData = 0;
  for (const w of ws) {
    const n = parseInt(w[field], 10);
    if (Number.isNaN(n)) continue;
    total += n;
    withData += 1;
  }
  return { total: withData ? String(total) : '', withData: String(withData) };
}

function summarizeDemoDay(
  date: string,
  ws: DemoActivity[],
  health: DailyHealthRow | undefined,
  body: BodyMeasurementRow[],
  computedAt: string,
): Omit<DailySummaryRow, 'sheetRow'> | null {
  // A day with nothing to report has no row, never a row of zeros.
  if (!ws.length && !health && !body.length) return null;
  const outdoor = ws.filter((w) => DEMO_CARDIO_TYPES.includes(w.type) && !DEMO_INDOOR_SUB_TYPES.includes(w.sub_type));
  const distance = coveredCells(outdoor, 'distance_m');
  const ascent = coveredCells(outdoor, 'ascent_m');
  const moving = coveredCells(ws, 'moving_seconds');
  const elapsed = coveredCells(ws, 'elapsed_seconds');

  const labels = [...new Set(ws.map((w) => (w.sub_type ? `${w.type}:${w.sub_type}` : w.type)))].sort();
  const counts: Record<string, number> = {};
  for (const w of ws) if (w.effort && DEMO_EFFORTS.includes(w.effort)) counts[w.effort] = (counts[w.effort] ?? 0) + 1;
  const ranked = DEMO_EFFORTS.slice().reverse().filter((e) => counts[e]);

  const firstWithWeight = body
    .filter((m) => m.kind === 'scale' && m.weight_kg !== '')
    .sort((a, b) => Date.parse(a.measured_at_utc) - Date.parse(b.measured_at_utc))[0];
  const bp = body.filter((m) => m.kind === 'bp');
  const meanHalfUp = (field: 'systolic_mmhg' | 'diastolic_mmhg') => {
    const vals = bp.filter((m) => m[field] !== '').map((m) => Number(m[field]));
    return vals.length ? String(Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length + 0.5)) : '';
  };

  return {
    date,
    activity_count: ws.length ? String(ws.length) : '',
    activity_types: labels.join(','),
    total_moving_s: moving.total,
    total_elapsed_s: elapsed.total,
    total_distance_m: distance.total,
    total_ascent_m: ascent.total,
    cardio_activity_count: outdoor.length ? String(outdoor.length) : '',
    distance_withdata: distance.withData,
    ascent_withdata: ascent.withData,
    max_effort: ranked[0] ?? '',
    effort_counts: ranked.map((e) => `${e}:${counts[e]}`).join(','),
    steps: health?.steps ?? '',
    resting_hr: health?.resting_hr ?? '',
    hrv: health?.hrv ?? '',
    sleep_total_s: health?.sleep_total_s ?? '',
    training_load: health?.training_load ?? '',
    computed_at: computedAt,
    moving_withdata: moving.withData,
    elapsed_withdata: elapsed.withData,
    weight_kg: firstWithWeight?.weight_kg ?? '',
    fat_ratio_pct: firstWithWeight?.fat_ratio_pct ?? '',
    systolic_mmhg: meanHalfUp('systolic_mmhg'),
    diastolic_mmhg: meanHalfUp('diastolic_mmhg'),
    bp_count: bp.length ? String(bp.length) : '',
  };
}

/**
 * The activities each demo day's summary row is rolled up from, one entry per
 * day of the window: the last seven days are the shifted demo Workouts
 * (planned ones excluded, as the rebuild skips them), older days the synthetic
 * cycle. Exported so the parity test (#266) feeds the real rollup exactly what
 * the demo's own rollup saw.
 */
export function demoActivitiesByDate(now: Date): Map<string, DemoActivity[]> {
  const days = demoHealthDays(now);
  const todayNum = days[days.length - 1].day;
  const recent = new Map<string, DemoActivity[]>();
  for (const w of shiftDemoWorkouts(now)) {
    // A planned workout has not happened; it is not part of the rollup.
    if (w.status === 'planned' || !w.date) continue;
    if (!recent.has(w.date)) recent.set(w.date, []);
    recent.get(w.date)!.push(w);
  }
  const byDate = new Map<string, DemoActivity[]>();
  for (const { date, day } of days) {
    byDate.set(date, todayNum - day <= 6 ? recent.get(date) ?? [] : syntheticActivities(day));
  }
  return byDate;
}

function buildDemoDailySummary(now: Date, presync = false): DailySummaryRow[] {
  const days = demoHealthDays(now);
  const health = new Map(buildDemoDailyHealth(now, presync).map((h) => [h.date, h]));
  const body = new Map<string, BodyMeasurementRow[]>();
  for (const m of buildDemoBodyMeasurements(now, presync)) {
    if (!body.has(m.date)) body.set(m.date, []);
    body.get(m.date)!.push(m);
  }
  const activities = demoActivitiesByDate(now);
  // One rebuild stamps one time.
  const computedAt = new Date(now.getTime() - 20 * 60_000).toISOString();

  const rows: Omit<DailySummaryRow, 'sheetRow'>[] = [];
  for (const { date } of days) {
    const row = summarizeDemoDay(date, activities.get(date) ?? [], health.get(date), body.get(date) ?? [], computedAt);
    if (row) rows.push(row);
  }
  return asBackfilled<DailySummaryRow>(rows, days[0].date);
}

/** The demo DailyHealth tab as the sheet would hold it, in sheet order. */
export function demoDailyHealth(now: Date, scenario: DemoHealthScenario = demoHealthScenario()): DailyHealthRow[] {
  if (scenario === 'error') throw new Error('Demo: DailyHealth unreadable (health=error)');
  return scenario === 'empty' ? [] : buildDemoDailyHealth(now, scenario === 'presync');
}

/** The demo BodyMeasurements tab as the sheet would hold it, in sheet order. */
export function demoBodyMeasurements(now: Date, scenario: DemoHealthScenario = demoHealthScenario()): BodyMeasurementRow[] {
  if (scenario === 'error') throw new Error('Demo: BodyMeasurements unreadable (health=error)');
  return scenario === 'empty' ? [] : buildDemoBodyMeasurements(now, scenario === 'presync');
}

/** The demo DailySummary tab, rolled up from the other two by the tab's own rules, in sheet order. */
export function demoDailySummary(now: Date, scenario: DemoHealthScenario = demoHealthScenario()): DailySummaryRow[] {
  if (scenario === 'error') throw new Error('Demo: DailySummary unreadable (health=error)');
  return scenario === 'empty' ? [] : buildDemoDailySummary(now, scenario === 'presync');
}
