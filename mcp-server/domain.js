// Thrive domain layer — row <-> object mapping for the Groundwork tabs.
//
// Column layouts mirror frontend/src/api/*.ts. Keep the two in sync: if a tab
// gains a column there, widen the range and the mappers here too.

import { randomUUID } from 'node:crypto';
import {
  sheetsGet, sheetsAppend, sheetsUpdate, sheetsBatchGetRows, sheetsBatchUpdate, deleteRows,
} from './sheets.js';

const RANGES = {
  exercises: 'Exercises!A2:E',
  templates: 'Templates!A2:H',
  workouts: 'Workouts!A2:Z',
  sets: 'Sets!A2:J',
};

export const WORKOUT_TYPES = ['weight', 'stretch', 'bike', 'hike'];
export const EFFORTS = ['Easy', 'Medium', 'Hard'];
export const SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'];

const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
const newWorkoutId = () => newId('w');
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

/**
 * Everything needed to write one scheduled session — the workout record, its
 * set rows, and the expanded plan for the response — checked and built
 * without writing. Returns `{ errors }` instead when anything is wrong, with
 * every problem found. thrive_schedule_workout and thrive_schedule_week both
 * go through here, so a week is validated exactly like a single session (#121).
 *
 * `resolveExercise(ref)` and `resolveTemplate(ref)` return a match or throw.
 */
export function prepareSchedule(input, { library, resolveExercise, resolveTemplate }) {
  const { date, name, type = 'weight', template, exercises, notes, status = 'planned' } = input;
  const errors = [];

  const when = normalizeDate(date);
  if (!when) errors.push(`could not read "${date}" as a date — use YYYY-MM-DD, 'today', 'tomorrow' or '+3d'`);

  let plan = [];
  let templateId = '';
  if (template) {
    let tpl;
    try {
      tpl = resolveTemplate(template);
    } catch (err) {
      errors.push(err.message);
    }
    if (tpl) {
      // Template rows key on exercise_id but cache the name, which goes stale
      // when the library is edited by hand: write the library's name, and
      // refuse rows whose id no longer exists (#120).
      const { orphans } = findStaleExerciseNames(tpl.exercises, library);
      if (orphans.length) {
        errors.push(
          `template "${tpl.name}" has ${orphans.length} row${orphans.length > 1 ? 's' : ''} whose exercise ` +
          `is not in the library (${orphans.map((r) => `row ${r.order}: "${r.exercise_name}" (${r.exercise_id || 'no id'})`).join('; ')}) ` +
          '— repair it with thrive_update_template, or pass an explicit exercises list',
        );
      } else {
        const currentName = new Map(library.map((e) => [e.id, e.name]));
        templateId = tpl.id;
        plan = tpl.exercises.map((e) => ({
          exercise_id: e.exercise_id,
          exercise_name: currentName.get(e.exercise_id),
          section: e.section,
          sets: Number(e.sets) || 1,
          reps: e.reps,
          weights: [],
        }));
      }
    }
  } else if (exercises?.length) {
    const built = buildSchedulePlan(exercises, resolveExercise);
    errors.push(...built.errors);
    plan = built.plan;
  } else if (type === 'weight') {
    errors.push('a weight workout needs either a template or an exercises list');
  }

  if (errors.length) return { errors };

  const workout = buildWorkout({
    date: when,
    time: '',
    type,
    name,
    template_id: templateId,
    notes,
    status: status === 'planned' ? 'planned' : '',
  });
  const rows = plan.flatMap((ex, i) => Array.from({ length: ex.sets }, (_, k) => ({
    workout_id: workout.id,
    exercise_id: ex.exercise_id,
    exercise_name: ex.exercise_name,
    section: ex.section,
    exercise_order: i + 1,
    set_number: k + 1,
    planned_reps: ex.reps,
    // Prescription only: performed reps and effort stay blank (#118).
    weight: ex.weights[k] ?? '',
    reps: '',
    effort: '',
  })));
  return { workout, rows, plan, errors: [] };
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

// --- Workouts (A:Z) -------------------------------------------------

export function workoutRowValues(w) {
  return [
    w.id, w.date, w.time, w.type, w.name, w.template_id,
    w.notes, w.elapsed_seconds, w.created, w.copied_from, w.status,
    w.moving_seconds, w.effort, w.distance_m, w.ascent_m, w.descent_m, w.avg_hr,
    w.sub_type, w.source, w.source_activity_id, w.raw_ref, w.fit_ref,
    w.fit_fetched_at, w.synced_at, w.started_at_utc, w.calories,
  ];
}

/** The timezone every hand-logged `Date`/`Time` pair is implicitly in. */
const HOME_TZ = 'America/Denver';

const OFFSET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: HOME_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/**
 * The UTC offset `America/Denver` was on at a given naive local instant,
 * as `-07:00` (MST) or `-06:00` (MDT).
 *
 * Resolved per call rather than once per run: a backfill spanning January and
 * July crosses two offsets, and taking one for the whole run would put half
 * the rows an hour out.
 *
 * Works by reading the naive local wall clock as if it were UTC, asking what
 * Denver's wall clock reads at that instant, and taking the difference. There
 * is no timezone dependency in either project and this needs none.
 */
export function denverOffset(date, time) {
  const asIfUtc = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(asIfUtc.getTime())) return '';

  const p = Object.fromEntries(OFFSET_FMT.formatToParts(asIfUtc).map((x) => [x.type, x.value]));
  const denverAsUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  const offsetMinutes = Math.round((denverAsUtc - asIfUtc.getTime()) / 60000);

  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * `Date` + `Time` -> the ISO 8601 instant for `Workouts!Y`, DST-aware.
 *
 * Returns '' when there is no time to convert. A workout with a date but no
 * time has no instant, and assuming midnight would invent one — see #128 AC5.
 */
export function startedAtUtc(date, time) {
  const d = String(date ?? '').trim();
  const t = String(time ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return '';

  const offset = denverOffset(d, t);
  return offset === '' ? '' : `${d}T${t}:00${offset}`;
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
    // #128 R-Z. Blank on every row written before the migration, and blank
    // `source` is what "logged by hand" looks like — never default these.
    sub_type: row[17] || '',
    source: row[18] || '',
    source_activity_id: row[19] || '',
    raw_ref: row[20] || '',
    fit_ref: row[21] || '',
    fit_fetched_at: row[22] || '',
    synced_at: row[23] || '',
    started_at_utc: row[24] || '',
    calories: row[25] || '',
    sheetRow: i + 2,
  }));
}

/** A new workout record, not yet written. Append it with appendWorkouts. */
export function buildWorkout(data) {
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
    // #128: sync provenance, written by the sync job and nothing else.
    sub_type: '',
    source: '',
    source_activity_id: '',
    raw_ref: '',
    fit_ref: '',
    fit_fetched_at: '',
    synced_at: '',
    started_at_utc: '',
    calories: '',
  };
  return workout;
}

/** Append workout rows in a single request. */
export async function appendWorkouts(list) {
  await sheetsAppend('Workouts!A:Z', list.map((w) => workoutRowValues(w)));
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
  await sheetsUpdate(`Workouts!A${workout.sheetRow}:Z${workout.sheetRow}`, [workoutRowValues(workout)]);
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

/** Describe repeated slots of one exercise so an agent can pick one. */
export function describeSlots(slots) {
  return slots
    .map((g) => `[${g.section || 'no section'}] exercise_order ${g.exercise_order}, ${g.sets.length} sets`)
    .join('; ');
}

/**
 * The one set row an update means, or a thrown error that says how to narrow
 * it. Shared by thrive_update_set and thrive_update_sets so both refuse to
 * guess in exactly the same words.
 */
export function resolveSetTarget(sets, ex, { workout_id, set_number, section, exercise_order }) {
  const slots = findSetSlots(sets, { workout_id, exercise_id: ex.id, section, exercise_order });

  if (!slots.length) {
    const all = findSetSlots(sets, { workout_id, exercise_id: ex.id });
    throw new Error(
      `No ${ex.name}${section ? ` in section ${section}` : ''}` +
      `${exercise_order ? ` at exercise_order ${exercise_order}` : ''} in workout ${workout_id}` +
      (all.length ? ` — it appears as ${describeSlots(all)}.` : '.'),
    );
  }
  if (slots.length > 1) {
    throw new Error(
      `${ex.name} appears ${slots.length} times in workout ${workout_id} — ${describeSlots(slots)}. ` +
      `Pass section or exercise_order to say which set ${set_number} you mean.`,
    );
  }

  const slot = slots[0];
  const target = slot.sets.find((s) => s.set_number === Number(set_number));
  if (!target) {
    throw new Error(
      `No set ${set_number} of ${ex.name} [${slot.section || 'no section'}] in workout ` +
      `${workout_id} — that slot has sets 1..${slot.sets.length}.`,
    );
  }
  return { slot, target };
}

export const SET_UPDATE_FIELDS = ['weight', 'reps', 'planned_reps', 'effort'];
const SET_UPDATE_KEYS = ['exercise', 'set_number', 'section', 'exercise_order', ...SET_UPDATE_FIELDS];

/**
 * Resolve a batch of set corrections against one workout without writing.
 * Every entry is checked and every problem collected (#119): a half-applied
 * batch is worse than a rejected one, because the caller can't tell which
 * sets are live without re-reading.
 *
 * `resolve(ref)` returns a library exercise or throws.
 */
export function planSetUpdates(sets, workoutId, updates, resolve) {
  const changes = [];
  const errors = [];
  const claimed = new Map(); // sheetRow -> index of the entry that took it

  updates.forEach((u, i) => {
    const fail = (msg) => errors.push(`updates[${i}] "${u.exercise}" set ${u.set_number}: ${msg}`);

    const unknown = findUnknownFields(u, SET_UPDATE_KEYS);
    if (unknown.length) {
      return fail(`unknown field ${unknown.map((k) => `"${k}"`).join(', ')} — accepted: ${SET_UPDATE_KEYS.join(', ')}`);
    }
    if (!SET_UPDATE_FIELDS.some((f) => u[f] !== undefined)) {
      return fail(`nothing to change — pass at least one of ${SET_UPDATE_FIELDS.join(', ')}`);
    }

    let ex;
    let resolved;
    try {
      ex = resolve(u.exercise);
      resolved = resolveSetTarget(sets, ex, {
        workout_id: workoutId, set_number: u.set_number, section: u.section, exercise_order: u.exercise_order,
      });
    } catch (err) {
      return fail(err.message);
    }

    const row = resolved.target.sheetRow;
    if (claimed.has(row)) {
      return fail(`targets the same set as updates[${claimed.get(row)}] — combine them into one entry`);
    }
    claimed.set(row, i);

    const after = { ...resolved.target };
    for (const f of SET_UPDATE_FIELDS) if (u[f] !== undefined) after[f] = u[f];
    changes.push({ index: i, exercise: ex, slot: resolved.slot, before: resolved.target, after });
  });

  return { changes, errors };
}

/** "weight 115 lbs · reps 6 · planned 8 · effort Hard", with — for blanks. */
export function describeSetState(s) {
  return [
    `weight ${formatWeight(s.weight) || '—'}`,
    `reps ${s.reps || '—'}`,
    `planned ${s.planned_reps || '—'}`,
    `effort ${s.effort || '—'}`,
  ].join(' · ');
}

/**
 * Rows whose freshly read A..F cells no longer hold the workout, exercise and
 * set number they were read with — a row above was deleted and the cached
 * sheetRow now points at a different set (cf. #95).
 */
export function findStaleSetRows(rows, freshRows) {
  return rows.filter((s, i) => {
    const r = freshRows[i] || [];
    return r[0] !== s.workout_id || r[1] !== s.exercise_id || Number(r[5]) !== s.set_number;
  });
}

export async function appendSets(sets) {
  await sheetsAppend('Sets!A:J', sets.map(setRowValues));
}

export async function writeSetRow(set) {
  await sheetsUpdate(`Sets!A${set.sheetRow}:J${set.sheetRow}`, [setRowValues(set)]);
}

/**
 * Overwrite many set rows in one request, after re-reading each target to
 * confirm it still holds the same set. Any mismatch writes nothing.
 */
export async function writeSetRowsChecked(sets) {
  const fresh = await sheetsBatchGetRows(sets.map((s) => `Sets!A${s.sheetRow}:F${s.sheetRow}`));
  const stale = findStaleSetRows(sets, fresh);
  if (stale.length) {
    throw new Error(
      `${stale.length} set row${stale.length > 1 ? 's' : ''} moved since ${stale.length > 1 ? 'they were' : 'it was'} ` +
      `read (sheet rows ${stale.map((s) => s.sheetRow).join(', ')}) — the sheet changed underneath this call. ` +
      'Nothing was written; re-read the workout and retry.',
    );
  }
  await sheetsBatchUpdate(
    sets.map((s) => ({ range: `Sets!A${s.sheetRow}:J${s.sheetRow}`, values: [setRowValues(s)] })),
  );
}

export { deleteRows };
