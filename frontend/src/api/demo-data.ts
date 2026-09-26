// Demo mode detection and seed data for offline/preview usage.

import type { ExerciseWithRow, LabelWithRow, TemplateRowWithRow, Template, WorkoutWithRow, SetWithRow } from './types';
import { colorKeyFromName } from './label-colors';
import type { SyncLogEntryWithRow } from './sync-log-api';
import { SyncLogNotSetUpError } from './sync-log-errors';

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
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 3, exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', sets: '5', reps: '6', sheetRow: 4 },
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
  { id: 'w_demo001', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Felt strong today', elapsed_seconds: '3720', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Hard', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 2 },
  { id: 'w_demo002', date: '2025-01-13', time: '07:00', type: 'stretch', name: 'Morning Stretch', template_id: '', notes: 'Full body stretch, focused on hamstrings and hip flexors', elapsed_seconds: '1200', created: '2025-01-13T07:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Easy', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 3 },
  { id: 'w_demo003', date: '2025-01-12', time: '17:30', type: 'bike', name: 'Evening Ride', template_id: '', notes: 'Easy 30 min zone 2 ride on the trainer', elapsed_seconds: '1800', created: '2025-01-12T17:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Medium', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 4 },
  { id: 'w_demo004', date: '2025-01-07', time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Good session', elapsed_seconds: '3480', created: '2025-01-07T06:30:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 5 },
  // #129: one indoor and one outdoor sub-typed activity, so the venue-driven
  // field rules are exercised in demo mode.
  { id: 'w_demo006', date: '2025-01-11', time: '06:00', type: 'run', name: 'Treadmill Run', template_id: '', notes: 'Easy shakeout indoors', elapsed_seconds: '1860', created: '2025-01-11T06:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: 'Easy', distance_m: '4828', ascent_m: '', descent_m: '', avg_hr: '142', sub_type: 'indoor', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 7 },
  { id: 'w_demo007', date: '2025-01-10', time: '15:00', type: 'walk', name: 'Neighborhood Walk', template_id: '', notes: '', elapsed_seconds: '2700', created: '2025-01-10T15:00:00.000Z', copied_from: '', status: '', moving_seconds: '', effort: '', distance_m: '3219', ascent_m: '46', descent_m: '', avg_hr: '', sub_type: 'outdoor', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sheetRow: 8 },
  // #172: one COROS-synced hike with a duration and distance that the edit
  // form's whole minutes and tenths of a mile cannot represent, so demo mode
  // can show that an untouched measure survives a save exactly. It is also
  // #157's Synced example.
  { id: 'w_demo008', date: '2025-01-09', time: '08:10', type: 'hike', name: 'Ridge Trail', template_id: '', notes: '', elapsed_seconds: '5143', created: '2025-01-09T16:00:00.000Z', copied_from: '', status: '', moving_seconds: '4620', effort: '', distance_m: '6512', ascent_m: '293', descent_m: '288', avg_hr: '131', sub_type: 'outdoor', source: 'coros', source_activity_id: 'demo_act_001', raw_ref: 'demo/raw/demo_act_001.json', fit_ref: '', fit_fetched_at: '', synced_at: '2025-01-09T18:00:00.000Z', started_at_utc: '2025-01-09T16:10:00.000Z', calories: '540', estimated_seconds: '', sheetRow: 9 },
  // #157: the Enriched example (sync plan §7). Logged by hand, so `source`
  // stays blank, then matched to a COROS strength activity, which filled only
  // the blanks: moving time, heart rate and calories. The hand-timed elapsed
  // and the effort are the user's and were left alone. `synced_at` is when it
  // was enriched.
  { id: 'w_demo009', date: '2025-01-08', time: '06:45', type: 'weight', name: 'Leg Day', template_id: '', notes: '', elapsed_seconds: '3947', created: '2025-01-08T13:45:00.000Z', copied_from: '', status: '', moving_seconds: '3611', effort: 'Medium', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '112', sub_type: '', source: '', source_activity_id: 'demo_act_002', raw_ref: 'demo/raw/demo_act_002.json', fit_ref: '', fit_fetched_at: '', synced_at: '2025-01-08T15:02:37.000Z', started_at_utc: '', calories: '387', estimated_seconds: '', sheetRow: 10 },
  { id: 'w_demo005', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Pull A', template_id: 'tpl_demo002', notes: '', elapsed_seconds: '', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: 'planned', moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '2820', sheetRow: 6 },
];

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
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '6', weight: '', reps: '', effort: '', sheetRow: 28 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 2, planned_reps: '6', weight: '', reps: '', effort: '', sheetRow: 29 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 3, planned_reps: '6', weight: '', reps: '', effort: '', sheetRow: 30 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 4, planned_reps: '6', weight: '', reps: '', effort: '', sheetRow: 31 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 5, planned_reps: '6', weight: '', reps: '', effort: '', sheetRow: 32 },
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
