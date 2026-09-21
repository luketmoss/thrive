// Thrive domain logic that needs no sheet (#132).
//
// Row mapping and row resolution live in the Apps Script API now
// (apps-script/src), which owns the sheet's shape. What remains here is pure:
// planning a schedule, narrating results for an agent, and unit conversions.
// Nothing in this file knows a column letter or a row number.
//
// Relative dates (`today`, `tomorrow`, `+3d`) resolve against the MACHINE's
// local date. That is correct for an MCP server run on the athlete's own
// computer; run it somewhere set to UTC — CI, a container — and an evening
// "today" lands on tomorrow.

import { randomUUID } from 'node:crypto';

export const WORKOUT_TYPES = ['weight', 'stretch', 'bike', 'hike', 'run', 'walk'];
export const EFFORTS = ['Easy', 'Medium', 'Hard'];
export const SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'];

const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
const newWorkoutId = () => newId('w');

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
 * `Date` + `Time` -> the ISO 8601 instant for `started_at_utc`, DST-aware.
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

/** A new workout record, not yet written. Send it with api.js createWorkout. */
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

// --- Sets: narration only ------------------------------------------

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

/** The fields a set correction may change, and the keys an entry may carry. */
export const SET_UPDATE_FIELDS = ['weight', 'reps', 'planned_reps', 'effort'];
export const SET_UPDATE_KEYS = ['exercise', 'set_number', 'section', 'exercise_order', ...SET_UPDATE_FIELDS];

/** "weight 115 lbs · reps 6 · planned 8 · effort Hard", with — for blanks. */
export function describeSetState(s) {
  return [
    `weight ${formatWeight(s.weight) || '—'}`,
    `reps ${s.reps || '—'}`,
    `planned ${s.planned_reps || '—'}`,
    `effort ${s.effort || '—'}`,
  ].join(' · ');
}
