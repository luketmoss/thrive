// Thrive domain layer — row <-> object mapping for the Groundwork tabs.
//
// Column layouts mirror frontend/src/api/*.ts. Keep the two in sync: if a tab
// gains a column there, widen the range and the mappers here too.

import { randomUUID } from 'node:crypto';
import { sheetsGet, sheetsAppend, sheetsUpdate, deleteRows } from './sheets.js';

const RANGES = {
  exercises: 'Exercises!A2:E',
  templates: 'Templates!A2:H',
  workouts: 'Workouts!A2:Q',
  sets: 'Sets!A2:J',
};

export const WORKOUT_TYPES = ['weight', 'stretch', 'bike', 'hike'];
export const EFFORTS = ['Easy', 'Medium', 'Hard'];
export const SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'];

const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
/** Minted before any write so a workout's sets can be appended ahead of its row (#118). */
export const newWorkoutId = () => newId('w');
const nowIso = () => new Date().toISOString();

/** Local calendar date, not UTC — a 7pm workout must not land on tomorrow. */
export function todayStr(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Accepts YYYY-MM-DD, 'today', 'tomorrow', '+3d', or anything Date can parse. */
export function normalizeDate(value) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (v === 'today') return todayStr();
  if (v === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return todayStr(d);
  }
  const rel = v.match(/^\+(\d+)d$/);
  if (rel) {
    const d = new Date();
    d.setDate(d.getDate() + Number(rel[1]));
    return todayStr(d);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? '' : todayStr(parsed);
}

/** "4-5" -> "5". Mirrors normalizeRangeToMax in templates-api.ts. */
export function normalizeRangeToMax(val) {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split('-').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
  return parts.length ? String(Math.max(...parts)) : trimmed;
}

// --- Prescribed load (#118) -----------------------------------------

/** "115" -> "115 lbs", "0" -> "bodyweight", "" -> "". Bodyweight is not blank. */
export function formatWeight(weight) {
  const w = String(weight ?? '').trim();
  if (w === '') return '';
  return Number(w) === 0 ? 'bodyweight' : `${w} lbs`;
}

/** " @ 115 lbs" for one load, " @ 95 / 115 / 135" for a ramp, "" when none. */
export function describeLoad(weights = []) {
  if (!weights.some((w) => w !== '')) return '';
  if (weights.every((w) => w === weights[0])) return ` @ ${formatWeight(weights[0])}`;
  return ` @ ${weights.map((w) => (w === '' ? '—' : Number(w) === 0 ? 'bw' : w)).join(' / ')}`;
}

/**
 * Whether a set has been performed. A planned workout's weight may be a load
 * prescribed at schedule time, so there only reps or effort count; completed
 * workouts keep their existing reps-or-weight rule.
 */
export function isSetLogged(set, planned) {
  return Boolean(planned ? set.reps || set.effort : set.reps || set.weight);
}

/**
 * Validate and expand a thrive_schedule_workout exercise list in one pass,
 * before anything is written. Every problem is collected — an agent fixing a
 * week of programming should see them all at once, not one per round trip.
 *
 * `resolve(ref)` returns a library exercise or throws with a useful message.
 */
export function buildSchedulePlan(specs, resolve) {
  const plan = [];
  const errors = [];
  specs.forEach((spec, i) => {
    const where = `exercises[${i}] "${spec.exercise}"`;
    const problems = [];

    let ex;
    try {
      ex = resolve(spec.exercise);
    } catch (err) {
      problems.push(err.message);
    }

    const sets = Number(spec.sets);
    if (!Number.isInteger(sets) || sets < 1) {
      problems.push(`sets must be a whole number of at least 1, got ${JSON.stringify(spec.sets)}`);
    } else if (spec.set_weights && spec.set_weights.length !== sets) {
      problems.push(`set_weights has ${spec.set_weights.length} values but sets is ${sets}`);
    }

    if (problems.length) {
      errors.push(...problems.map((p) => `${where}: ${p}`));
      return;
    }

    const load = (n) => String((spec.set_weights ? spec.set_weights[n] : spec.weight) ?? '').trim();
    plan.push({
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: spec.section,
      sets,
      reps: normalizeRangeToMax(spec.reps),
      weights: Array.from({ length: sets }, (_, n) => load(n)),
    });
  });
  return { plan, errors };
}

// --- Exercises (A:E) ------------------------------------------------

export async function fetchExercises() {
  const rows = await sheetsGet(RANGES.exercises);
  return rows.map((row, i) => ({
    id: row[0] || '',
    name: row[1] || '',
    tags: row[2] || '',
    notes: row[3] || '',
    created: row[4] || '',
    sheetRow: i + 2,
  }));
}

export async function createExercise({ name, tags = '', notes = '' }) {
  const ex = { id: newId('ex'), name, tags, notes, created: nowIso() };
  await sheetsAppend('Exercises!A:E', [[ex.id, ex.name, ex.tags, ex.notes, ex.created]]);
  return ex;
}

export async function writeExerciseRow(ex) {
  await sheetsUpdate(`Exercises!A${ex.sheetRow}:E${ex.sheetRow}`, [
    [ex.id, ex.name, ex.tags, ex.notes, ex.created],
  ]);
}

// --- Templates (A:J) ------------------------------------------------

export async function fetchTemplateRows() {
  const rows = await sheetsGet(RANGES.templates);
  return rows.map((row, i) => ({
    template_id: row[0] || '',
    template_name: row[1] || '',
    order: Number(row[2]) || 0,
    exercise_id: row[3] || '',
    exercise_name: row[4] || '',
    section: row[5] || '',
    sets: normalizeRangeToMax(row[6] || ''),
    reps: normalizeRangeToMax(row[7] || ''),
    sheetRow: i + 2,
  }));
}

export function groupTemplateRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.template_id)) {
      map.set(row.template_id, { id: row.template_id, name: row.template_name, exercises: [] });
    }
    map.get(row.template_id).exercises.push(row);
  }
  for (const tpl of map.values()) tpl.exercises.sort((a, b) => a.order - b.order);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Templates and Sets rows cache the exercise name beside its id. Returns the
 * rows whose cached name no longer matches the library entry for that id
 * (`stale`, with the current `name`), and rows whose id isn't in the library
 * at all (`orphans`) — a name refresh can fix the first, never the second
 * (#120).
 */
export function findStaleExerciseNames(rows, exercises) {
  const byId = new Map(exercises.map((e) => [e.id, e.name]));
  const stale = [];
  const orphans = [];
  for (const row of rows) {
    const name = byId.get(row.exercise_id);
    if (name === undefined) orphans.push(row);
    else if (name !== row.exercise_name) stale.push({ row, name });
  }
  return { stale, orphans };
}

function templateRowValues(templateId, name, ex, order) {
  return [
    templateId, name, order,
    ex.exercise_id, ex.exercise_name, ex.section,
    String(ex.sets), String(ex.reps),
  ];
}

export async function createTemplate(name, exercises) {
  const templateId = newId('tpl');
  await sheetsAppend(
    'Templates!A:H',
    exercises.map((ex, i) => templateRowValues(templateId, name, ex, i + 1)),
  );
  return { id: templateId, name, exercises };
}

/** Replace a template's rows wholesale (delete + append), as the app does. */
export async function replaceTemplateRows(templateId, name, exercises, existingRows) {
  const mine = existingRows.filter((r) => r.template_id === templateId);
  await deleteRows('Templates', mine.map((r) => r.sheetRow));
  await sheetsAppend(
    'Templates!A:H',
    exercises.map((ex, i) => templateRowValues(templateId, name, ex, i + 1)),
  );
}

// --- Workouts (A:Q) -------------------------------------------------

export function workoutRowValues(w) {
  return [
    w.id, w.date, w.time, w.type, w.name, w.template_id,
    w.notes, w.elapsed_seconds, w.created, w.copied_from, w.status,
    w.moving_seconds, w.effort, w.distance_m, w.ascent_m, w.descent_m, w.avg_hr,
  ];
}

/**
 * Unit conversions mirroring frontend/src/api/units.ts — the sheet stores
 * canonical integer meters, everything user-facing is imperial. Change both
 * together.
 */
export function metersToMiles(meters) {
  const n = Number(meters);
  return meters === '' || !Number.isFinite(n) ? null : Math.round((n / 1609.344) * 10) / 10;
}

export function metersToFeet(meters) {
  const n = Number(meters);
  if (meters === '' || !Number.isFinite(n)) return null;
  return Math.round(n / 0.3048 / 10) * 10;
}

/** Seconds (as stored) -> whole minutes, or null when unset. Never 0. */
export function secondsToMinutes(elapsedSeconds) {
  const seconds = parseInt(elapsedSeconds, 10);
  return isNaN(seconds) ? null : Math.round(seconds / 60);
}

/**
 * Whole minutes (as an agent passes them) -> seconds for storage, or '' to
 * clear. Mirrors minutesToSeconds in frontend/src/api/duration.ts but refuses
 * to guess: the app's input only holds digits, whereas an agent can send
 * "63 min" or a seconds count, and silently coercing either is how the unit
 * drifted before #101.
 */
export function parseDurationMinutes(value) {
  const v = String(value ?? '').trim();
  if (v === '') return '';
  if (!/^\d+$/.test(v)) {
    throw new Error(
      `duration_min must be whole minutes as a plain number, e.g. 63 — got "${value}". ` +
      'It is stored as seconds; pass elapsed_seconds instead if you already have seconds.',
    );
  }
  return String(Number(v) * 60);
}

/**
 * Argument keys a tool's schema doesn't declare. The MCP SDK strips these
 * before the handler runs, so without this check a misnamed field is a silent
 * no-op (#117).
 */
export function findUnknownFields(args, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(args ?? {}).filter((k) => !allowed.has(k));
}

export async function fetchWorkouts() {
  const rows = await sheetsGet(RANGES.workouts);
  return rows.map((row, i) => ({
    id: row[0] || '',
    date: row[1] || '',
    time: row[2] || '',
    type: row[3] || 'weight',
    name: row[4] || '',
    template_id: row[5] || '',
    notes: row[6] || '',
    elapsed_seconds: row[7] || '',
    created: row[8] || '',
    copied_from: row[9] || '',
    status: row[10] || '',
    moving_seconds: row[11] || '',
    effort: row[12] || '',
    distance_m: row[13] || '',
    ascent_m: row[14] || '',
    descent_m: row[15] || '',
    avg_hr: row[16] || '',
    sheetRow: i + 2,
  }));
}

export async function createWorkout(data) {
  const now = new Date();
  const workout = {
    id: data.id || newWorkoutId(),
    date: data.date || todayStr(now),
    time: data.time ?? now.toTimeString().slice(0, 5),
    type: data.type,
    name: data.name,
    template_id: data.template_id || '',
    notes: data.notes || '',
    elapsed_seconds: data.elapsed_seconds || '',
    created: now.toISOString(),
    copied_from: data.copied_from || '',
    status: data.status || '',
    // #101: nullable activity attributes, populated by #102/#103. Never
    // defaulted — empty means nobody said, which is a legitimate state.
    moving_seconds: '',
    effort: '',
    distance_m: '',
    ascent_m: '',
    descent_m: '',
    avg_hr: '',
  };
  await sheetsAppend('Workouts!A:Q', [workoutRowValues(workout)]);
  return workout;
}

/**
 * Overwrite a workout row, re-checking that the row still holds this
 * workout's id first. A cached sheetRow goes stale as soon as an earlier row
 * is deleted, and writing blind would clobber a different workout — the bug
 * behind issue #95.
 */
export async function writeWorkoutRow(workout) {
  const cell = await sheetsGet(`Workouts!A${workout.sheetRow}:A${workout.sheetRow}`);
  if (cell[0]?.[0] !== workout.id) {
    throw new Error(
      `Row ${workout.sheetRow} no longer holds workout ${workout.id} — the sheet ` +
      `changed underneath this call. Re-read the workout and retry.`,
    );
  }
  await sheetsUpdate(`Workouts!A${workout.sheetRow}:Q${workout.sheetRow}`, [workoutRowValues(workout)]);
}

// --- Sets (A:J) -----------------------------------------------------

function setRowValues(s) {
  return [
    s.workout_id, s.exercise_id, s.exercise_name, s.section,
    s.exercise_order, s.set_number, s.planned_reps,
    s.weight, s.reps, s.effort,
  ];
}

export async function fetchSets() {
  const rows = await sheetsGet(RANGES.sets);
  return rows.map((row, i) => ({
    workout_id: row[0] || '',
    exercise_id: row[1] || '',
    exercise_name: row[2] || '',
    section: row[3] || '',
    exercise_order: Number(row[4]) || 0,
    set_number: Number(row[5]) || 0,
    planned_reps: row[6] || '',
    weight: row[7] || '',
    reps: row[8] || '',
    effort: row[9] || '',
    sheetRow: i + 2,
  }));
}

/**
 * The same exercise can legitimately appear more than once in a workout — a
 * warmup and a primary of the same lift are separate slots, each with its own
 * set numbering. exercise_id alone is therefore not an identity: the frontend
 * keys on exercise_id + exercise_order, and this mirrors it.
 */
export const slotKey = (s) => `${s.exercise_id}__${s.exercise_order}`;

/** Group a workout's sets into slots, ordered by exercise_order. */
export function groupSetsByExercise(sets) {
  const map = new Map();
  for (const s of sets) {
    const key = slotKey(s);
    if (!map.has(key)) {
      map.set(key, {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
      });
    }
    map.get(key).sets.push(s);
  }
  const slots = [...map.values()];
  for (const g of slots) g.sets.sort((a, b) => a.set_number - b.set_number);
  return slots.sort((a, b) => a.exercise_order - b.exercise_order);
}

/**
 * Slots for one exercise within one workout, optionally narrowed by section
 * or exercise_order. Returns every match so the caller can refuse to guess
 * when an exercise appears in two sections.
 */
export function findSetSlots(sets, { workout_id, exercise_id, section, exercise_order }) {
  const mine = sets.filter((s) => s.workout_id === workout_id && s.exercise_id === exercise_id);
  let slots = groupSetsByExercise(mine);
  if (section) {
    const q = String(section).toLowerCase();
    slots = slots.filter((g) => String(g.section).toLowerCase() === q);
  }
  if (exercise_order !== undefined && exercise_order !== null && exercise_order !== '') {
    slots = slots.filter((g) => g.exercise_order === Number(exercise_order));
  }
  return slots;
}

export async function appendSets(sets) {
  await sheetsAppend('Sets!A:J', sets.map(setRowValues));
}

export async function writeSetRow(set) {
  await sheetsUpdate(`Sets!A${set.sheetRow}:J${set.sheetRow}`, [setRowValues(set)]);
}

export { deleteRows };
