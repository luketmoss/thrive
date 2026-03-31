// Demo mode detection and seed data for offline/preview usage.

import type { ExerciseWithRow, LabelWithRow, TemplateRowWithRow, Template, WorkoutWithRow, SetWithRow } from './types';
import { colorKeyFromName } from './label-colors';

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
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', sets: '', reps: '', created: now, updated: now, sheetRow: 2 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'warmup', sets: '', reps: '', created: now, updated: now, sheetRow: 3 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 3, exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', sets: '5', reps: '6', created: now, updated: now, sheetRow: 4 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 4, exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', sets: '3', reps: '12', created: now, updated: now, sheetRow: 5 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 5, exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', sets: '3', reps: '15', created: now, updated: now, sheetRow: 6 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 6, exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', sets: '3', reps: '15', created: now, updated: now, sheetRow: 7 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 7, exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', sets: '3', reps: '15', created: now, updated: now, sheetRow: 8 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 8, exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', sets: '3', reps: '10', created: now, updated: now, sheetRow: 9 },

  // Upper Pull A
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 1, exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'warmup', sets: '', reps: '', created: now, updated: now, sheetRow: 10 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 2, exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', sets: '5', reps: '6', created: now, updated: now, sheetRow: 11 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 3, exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', sets: '3', reps: '10', created: now, updated: now, sheetRow: 12 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 4, exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', sets: '3', reps: '15', created: now, updated: now, sheetRow: 13 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 5, exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', sets: '3', reps: '12', created: now, updated: now, sheetRow: 14 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 6, exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', sets: '3', reps: '15', created: now, updated: now, sheetRow: 15 },
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
  { id: 'w_demo001', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Felt strong today', duration_min: '62', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: '', sheetRow: 2 },
  { id: 'w_demo002', date: '2025-01-13', time: '07:00', type: 'stretch', name: 'Morning Stretch', template_id: '', notes: 'Full body stretch, focused on hamstrings and hip flexors', duration_min: '20', created: '2025-01-13T07:00:00.000Z', copied_from: '', status: '', sheetRow: 3 },
  { id: 'w_demo003', date: '2025-01-12', time: '17:30', type: 'bike', name: 'Evening Ride', template_id: '', notes: 'Easy 30 min zone 2 ride on the trainer', duration_min: '30', created: '2025-01-12T17:30:00.000Z', copied_from: '', status: '', sheetRow: 4 },
  { id: 'w_demo004', date: '2025-01-07', time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Good session', duration_min: '58', created: '2025-01-07T06:30:00.000Z', copied_from: '', status: '', sheetRow: 5 },
  { id: 'w_demo005', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Pull A', template_id: 'tpl_demo002', notes: '', duration_min: '', created: '2025-01-14T06:30:00.000Z', copied_from: '', status: 'planned', sheetRow: 6 },
];

export const DEMO_SETS: SetWithRow[] = [
  // Warmup — Push Ups (no weight/reps tracked for warmup)
  { workout_id: 'w_demo001', exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '15', effort: '', notes: '', sheetRow: 2 },
  // Warmup — Bench Press light
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'warmup', exercise_order: 2, set_number: 1, planned_reps: '', weight: '95', reps: '10', effort: 'Easy', notes: '', sheetRow: 3 },
  // Primary — Bench Press working sets
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 4 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Medium', notes: '', sheetRow: 5 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Hard', notes: '', sheetRow: 6 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 4, planned_reps: '4-6', weight: '185', reps: '4', effort: 'Hard', notes: 'Last rep was a grinder', sheetRow: 7 },
  // SS1 — Incline Press DB
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '10-12', weight: '55', reps: '12', effort: 'Medium', notes: '', sheetRow: 8 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '10-12', weight: '55', reps: '11', effort: 'Medium', notes: '', sheetRow: 9 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '10-12', weight: '55', reps: '10', effort: 'Hard', notes: '', sheetRow: 10 },
  // SS1 — Cable Fly FT
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 1, planned_reps: '12-15', weight: '25', reps: '15', effort: 'Easy', notes: '', sheetRow: 11 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 2, planned_reps: '12-15', weight: '25', reps: '14', effort: 'Medium', notes: '', sheetRow: 12 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly FT', section: 'SS1', exercise_order: 5, set_number: 3, planned_reps: '12-15', weight: '25', reps: '12', effort: 'Medium', notes: '', sheetRow: 13 },
  // SS2 — Lateral Raise DB
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 1, planned_reps: '12-15', weight: '15', reps: '15', effort: 'Medium', notes: '', sheetRow: 14 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 2, planned_reps: '12-15', weight: '15', reps: '13', effort: 'Medium', notes: '', sheetRow: 15 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'Lateral Raise DB', section: 'SS2', exercise_order: 6, set_number: 3, planned_reps: '12-15', weight: '15', reps: '12', effort: 'Hard', notes: '', sheetRow: 16 },
  // SS2 — Rope Tricep Pushdown FT
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 1, planned_reps: '12-15', weight: '40', reps: '15', effort: 'Medium', notes: '', sheetRow: 17 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 2, planned_reps: '12-15', weight: '40', reps: '13', effort: 'Medium', notes: '', sheetRow: 18 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Pushdown FT', section: 'SS2', exercise_order: 7, set_number: 3, planned_reps: '12-15', weight: '40', reps: '12', effort: 'Hard', notes: '', sheetRow: 19 },
  // Burnout — Ab Wheel
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 1, planned_reps: '6-10', weight: '', reps: '10', effort: 'Medium', notes: '', sheetRow: 20 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 2, planned_reps: '6-10', weight: '', reps: '8', effort: 'Hard', notes: '', sheetRow: 21 },

  // ── Previous workout (w_demo004 — Jan 7) for last-time panel testing ──
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '175', reps: '6', effort: 'Medium', notes: '', sheetRow: 22 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '175', reps: '6', effort: 'Medium', notes: '', sheetRow: 23 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo001', exercise_name: 'Bench Press BB', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '175', reps: '5', effort: 'Hard', notes: '', sheetRow: 24 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '10-12', weight: '50', reps: '12', effort: 'Easy', notes: '', sheetRow: 25 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '10-12', weight: '50', reps: '11', effort: 'Medium', notes: '', sheetRow: 26 },
  { workout_id: 'w_demo004', exercise_id: 'ex_demo002', exercise_name: 'Incline Press DB', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '10-12', weight: '50', reps: '10', effort: 'Medium', notes: '', sheetRow: 27 },

  // ── Planned workout (w_demo005 — Upper Pull A) — prepopulated set structure ──
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 1, planned_reps: '6', weight: '', reps: '', effort: '', notes: '', sheetRow: 28 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 2, planned_reps: '6', weight: '', reps: '', effort: '', notes: '', sheetRow: 29 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 3, planned_reps: '6', weight: '', reps: '', effort: '', notes: '', sheetRow: 30 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 4, planned_reps: '6', weight: '', reps: '', effort: '', notes: '', sheetRow: 31 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo008', exercise_name: 'Row BB', section: 'primary', exercise_order: 2, set_number: 5, planned_reps: '6', weight: '', reps: '', effort: '', notes: '', sheetRow: 32 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 1, planned_reps: '10', weight: '', reps: '', effort: '', notes: '', sheetRow: 33 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 2, planned_reps: '10', weight: '', reps: '', effort: '', notes: '', sheetRow: 34 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo007', exercise_name: 'Pullups', section: 'SS1', exercise_order: 3, set_number: 3, planned_reps: '10', weight: '', reps: '', effort: '', notes: '', sheetRow: 35 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 36 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 37 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo014', exercise_name: 'Face Pulls FT', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 38 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 1, planned_reps: '12', weight: '', reps: '', effort: '', notes: '', sheetRow: 39 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 2, planned_reps: '12', weight: '', reps: '', effort: '', notes: '', sheetRow: 40 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo011', exercise_name: 'Hammer Curls DB', section: 'SS2', exercise_order: 5, set_number: 3, planned_reps: '12', weight: '', reps: '', effort: '', notes: '', sheetRow: 41 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 1, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 42 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 2, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 43 },
  { workout_id: 'w_demo005', exercise_id: 'ex_demo013', exercise_name: 'Crunch FT', section: 'burnout', exercise_order: 6, set_number: 3, planned_reps: '15', weight: '', reps: '', effort: '', notes: '', sheetRow: 44 },
];
