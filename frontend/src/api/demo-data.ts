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
  { id: 'ex_demo001', name: 'Barbell Bench Press', tags: 'Push, Chest, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 2 },
  { id: 'ex_demo002', name: 'Incline DB Press', tags: 'Push, Chest, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 3 },
  { id: 'ex_demo003', name: 'Cable Fly', tags: 'Push, Chest, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 4 },
  { id: 'ex_demo004', name: 'Barbell Squat', tags: 'Legs, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 5 },
  { id: 'ex_demo005', name: 'Bulgarian Split Squat', tags: 'Legs, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 6 },
  { id: 'ex_demo006', name: 'Barbell Deadlift', tags: 'Pull, Back, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 7 },
  { id: 'ex_demo007', name: 'Pull-ups', tags: 'Pull, Back, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 8 },
  { id: 'ex_demo008', name: 'Barbell Row', tags: 'Pull, Back, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 9 },
  { id: 'ex_demo009', name: 'DB Lateral Raise', tags: 'Push, Shoulders, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 10 },
  { id: 'ex_demo010', name: 'Rope Tricep Extension', tags: 'Push, Arms, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 11 },
  { id: 'ex_demo011', name: 'DB Hammer Curl', tags: 'Pull, Arms, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 12 },
  { id: 'ex_demo012', name: 'Ab Wheel', tags: 'Core', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 13 },
  { id: 'ex_demo013', name: 'Cable Crunch', tags: 'Core', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 14 },
  { id: 'ex_demo014', name: 'Face Pulls', tags: 'Pull, Shoulders, Isolation', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 15 },
  { id: 'ex_demo015', name: 'BB Overhead Press', tags: 'Push, Shoulders, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 16 },
  { id: 'ex_demo_pushup', name: 'Push Ups', tags: 'Push, Chest, Compound', notes: '', created: '2025-01-01T00:00:00.000Z', sheetRow: 17 },
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
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', sets: '', reps: '', rest_seconds: '', group_rest_seconds: '', created: now, updated: now, sheetRow: 2 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'warmup', sets: '', reps: '', rest_seconds: '', group_rest_seconds: '', created: now, updated: now, sheetRow: 3 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 3, exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'primary', sets: '4-5', reps: '4-6', rest_seconds: '90', group_rest_seconds: '120', created: now, updated: now, sheetRow: 4 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 4, exercise_id: 'ex_demo002', exercise_name: 'Incline DB Press', section: 'SS1', sets: '3', reps: '10-12', rest_seconds: '15', group_rest_seconds: '', created: now, updated: now, sheetRow: 5 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 5, exercise_id: 'ex_demo003', exercise_name: 'Cable Fly', section: 'SS1', sets: '3', reps: '12-15', rest_seconds: '15', group_rest_seconds: '60', created: now, updated: now, sheetRow: 6 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 6, exercise_id: 'ex_demo009', exercise_name: 'DB Lateral Raise', section: 'SS2', sets: '3', reps: '12-15', rest_seconds: '15', group_rest_seconds: '', created: now, updated: now, sheetRow: 7 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 7, exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Extension', section: 'SS2', sets: '3', reps: '12-15', rest_seconds: '15', group_rest_seconds: '60', created: now, updated: now, sheetRow: 8 },
  { template_id: 'tpl_demo001', template_name: 'Upper Push A', order: 8, exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', sets: '2-3', reps: '6-10', rest_seconds: '', group_rest_seconds: '', created: now, updated: now, sheetRow: 9 },

  // Upper Pull A
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 1, exercise_id: 'ex_demo008', exercise_name: 'Barbell Row', section: 'warmup', sets: '', reps: '', rest_seconds: '', group_rest_seconds: '', created: now, updated: now, sheetRow: 10 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 2, exercise_id: 'ex_demo008', exercise_name: 'Barbell Row', section: 'primary', sets: '4-5', reps: '4-6', rest_seconds: '90', group_rest_seconds: '120', created: now, updated: now, sheetRow: 11 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 3, exercise_id: 'ex_demo007', exercise_name: 'Pull-ups', section: 'SS1', sets: '3', reps: '8-10', rest_seconds: '15', group_rest_seconds: '', created: now, updated: now, sheetRow: 12 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 4, exercise_id: 'ex_demo014', exercise_name: 'Face Pulls', section: 'SS1', sets: '3', reps: '12-15', rest_seconds: '15', group_rest_seconds: '60', created: now, updated: now, sheetRow: 13 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 5, exercise_id: 'ex_demo011', exercise_name: 'DB Hammer Curl', section: 'SS2', sets: '3', reps: '10-12', rest_seconds: '15', group_rest_seconds: '', created: now, updated: now, sheetRow: 14 },
  { template_id: 'tpl_demo002', template_name: 'Upper Pull A', order: 6, exercise_id: 'ex_demo013', exercise_name: 'Cable Crunch', section: 'burnout', sets: '2-3', reps: '10-15', rest_seconds: '', group_rest_seconds: '', created: now, updated: now, sheetRow: 15 },
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
  { id: 'w_demo001', date: workoutDate, time: '06:30', type: 'weight', name: 'Upper Push A', template_id: 'tpl_demo001', notes: 'Felt strong today', duration_min: '62', created: '2025-01-14T06:30:00.000Z', copied_from: '', sheetRow: 2 },
  { id: 'w_demo002', date: '2025-01-13', time: '07:00', type: 'stretch', name: 'Morning Stretch', template_id: '', notes: 'Full body stretch, focused on hamstrings and hip flexors', duration_min: '20', created: '2025-01-13T07:00:00.000Z', copied_from: '', sheetRow: 3 },
  { id: 'w_demo003', date: '2025-01-12', time: '17:30', type: 'bike', name: 'Evening Ride', template_id: '', notes: 'Easy 30 min zone 2 ride on the trainer', duration_min: '30', created: '2025-01-12T17:30:00.000Z', copied_from: '', sheetRow: 4 },
];

export const DEMO_SETS: SetWithRow[] = [
  // Warmup — Push Ups (no weight/reps tracked for warmup)
  { workout_id: 'w_demo001', exercise_id: 'ex_demo_pushup', exercise_name: 'Push Ups', section: 'warmup', exercise_order: 1, set_number: 1, planned_reps: '', weight: '', reps: '15', effort: '', notes: '', sheetRow: 2 },
  // Warmup — Bench Press light
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'warmup', exercise_order: 2, set_number: 1, planned_reps: '', weight: '95', reps: '10', effort: 'Easy', notes: '', sheetRow: 3 },
  // Primary — Bench Press working sets
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'primary', exercise_order: 3, set_number: 1, planned_reps: '4-6', weight: '185', reps: '6', effort: 'Medium', notes: '', sheetRow: 4 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'primary', exercise_order: 3, set_number: 2, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Medium', notes: '', sheetRow: 5 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'primary', exercise_order: 3, set_number: 3, planned_reps: '4-6', weight: '185', reps: '5', effort: 'Hard', notes: '', sheetRow: 6 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo001', exercise_name: 'Barbell Bench Press', section: 'primary', exercise_order: 3, set_number: 4, planned_reps: '4-6', weight: '185', reps: '4', effort: 'Hard', notes: 'Last rep was a grinder', sheetRow: 7 },
  // SS1 — Incline DB Press
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline DB Press', section: 'SS1', exercise_order: 4, set_number: 1, planned_reps: '10-12', weight: '55', reps: '12', effort: 'Medium', notes: '', sheetRow: 8 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline DB Press', section: 'SS1', exercise_order: 4, set_number: 2, planned_reps: '10-12', weight: '55', reps: '11', effort: 'Medium', notes: '', sheetRow: 9 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo002', exercise_name: 'Incline DB Press', section: 'SS1', exercise_order: 4, set_number: 3, planned_reps: '10-12', weight: '55', reps: '10', effort: 'Hard', notes: '', sheetRow: 10 },
  // SS1 — Cable Fly
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly', section: 'SS1', exercise_order: 5, set_number: 1, planned_reps: '12-15', weight: '25', reps: '15', effort: 'Easy', notes: '', sheetRow: 11 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly', section: 'SS1', exercise_order: 5, set_number: 2, planned_reps: '12-15', weight: '25', reps: '14', effort: 'Medium', notes: '', sheetRow: 12 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo003', exercise_name: 'Cable Fly', section: 'SS1', exercise_order: 5, set_number: 3, planned_reps: '12-15', weight: '25', reps: '12', effort: 'Medium', notes: '', sheetRow: 13 },
  // SS2 — Lateral Raise
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'DB Lateral Raise', section: 'SS2', exercise_order: 6, set_number: 1, planned_reps: '12-15', weight: '15', reps: '15', effort: 'Medium', notes: '', sheetRow: 14 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'DB Lateral Raise', section: 'SS2', exercise_order: 6, set_number: 2, planned_reps: '12-15', weight: '15', reps: '13', effort: 'Medium', notes: '', sheetRow: 15 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo009', exercise_name: 'DB Lateral Raise', section: 'SS2', exercise_order: 6, set_number: 3, planned_reps: '12-15', weight: '15', reps: '12', effort: 'Hard', notes: '', sheetRow: 16 },
  // SS2 — Tricep Extension
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Extension', section: 'SS2', exercise_order: 7, set_number: 1, planned_reps: '12-15', weight: '40', reps: '15', effort: 'Medium', notes: '', sheetRow: 17 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Extension', section: 'SS2', exercise_order: 7, set_number: 2, planned_reps: '12-15', weight: '40', reps: '13', effort: 'Medium', notes: '', sheetRow: 18 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo010', exercise_name: 'Rope Tricep Extension', section: 'SS2', exercise_order: 7, set_number: 3, planned_reps: '12-15', weight: '40', reps: '12', effort: 'Hard', notes: '', sheetRow: 19 },
  // Burnout — Ab Wheel
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 1, planned_reps: '6-10', weight: '', reps: '10', effort: 'Medium', notes: '', sheetRow: 20 },
  { workout_id: 'w_demo001', exercise_id: 'ex_demo012', exercise_name: 'Ab Wheel', section: 'burnout', exercise_order: 8, set_number: 2, planned_reps: '6-10', weight: '', reps: '8', effort: 'Hard', notes: '', sheetRow: 21 },
];
