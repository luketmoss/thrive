#!/usr/bin/env node

// Thrive MCP server — lets an agent read, analyze, schedule and repair the
// workout data in the Groundwork sheet.
//
// A thin client of the Thrive Apps Script API (#132). It holds no row
// mapping: api.js is the only file that talks to the outside world, and it
// speaks in domain objects. What remains here is tool definitions, narration
// for the agent, and planning that needs no sheet.
//
// Writes that destroy data (delete workout / exercise, replace a template)
// are dry-run by default: they report what they would change, built from API
// reads, and only call the API's write when called again with confirm: true.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  API_URL, API_KEY, ApiError,
  fetchWorkouts, fetchWorkout, fetchSets, fetchExercises, fetchTemplates,
  createWorkout, updateWorkout, deleteWorkout,
  createExercise, updateExercise, deleteExercise,
  createTemplate, replaceTemplate,
  previewSetUpdates, updateSets, appendSets,
} from './api.js';
import {
  planAndApplySetUpdates, EntryErrors, isEntryErrors, stripEntryPrefix,
} from './set-updates.js';
import {
  WORKOUT_TYPES, EFFORTS, SECTIONS,
  normalizeDate, normalizeRangeToMax, secondsToMinutes, metersToMiles, metersToFeet,
  parseDurationMinutes, findUnknownFields,
  formatWeight, describeLoad, isSetLogged, prepareSchedule,
  slotKey, groupSetsByExercise, describeSetState,
} from './domain.js';

// #132 AC4: the API URL and key replace the service account entirely. The old
// THRIVE_SPREADSHEET_ID / THRIVE_SERVICE_ACCOUNT_KEY* variables are not read.
if (!API_URL) {
  console.error('THRIVE_API_URL environment variable is required (the Apps Script web app /exec URL)');
  process.exit(1);
}
if (!API_KEY) {
  console.error('THRIVE_API_KEY environment variable is required (the API_KEY script property)');
  process.exit(1);
}

// --- helpers --------------------------------------------------------

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

const server = new McpServer({ name: 'thrive', version: '1.0.0' });

/**
 * Register a tool whose thrown errors surface as tool errors, not crashes.
 *
 * The schema is passthrough so undeclared fields reach us and can be refused
 * by name — the SDK's default object strips them, which turned a misnamed
 * field into "No changes provided" (#117).
 */
function tool(name, description, shape, handler) {
  const accepted = Object.keys(shape);
  server.registerTool(
    name,
    { description, inputSchema: z.object(shape).passthrough() },
    async (args) => {
      const unknown = findUnknownFields(args, accepted);
      if (unknown.length) {
        return fail(
          `Unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')} — ` +
          `nothing was written. Accepted: ${accepted.join(', ') || '(none)'}.`,
        );
      }
      try {
        return await handler(args);
      } catch (err) {
        return fail(`Error: ${err.message}`);
      }
    },
  );
}

/** Resolve an exercise reference (id, exact name, then unique partial name). */
function resolveExercise(ref, exercises) {
  const q = String(ref).trim().toLowerCase();
  const byId = exercises.find((e) => e.id.toLowerCase() === q);
  if (byId) return byId;
  const exact = exercises.filter((e) => e.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `"${ref}" matches ${exact.length} exercises with the same name. ` +
      `Use an id: ${exact.map((e) => e.id).join(', ')}`,
    );
  }
  const partial = exercises.filter((e) => e.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${ref}" is ambiguous — matches: ${partial.map((e) => `${e.name} (${e.id})`).join(', ')}`,
    );
  }
  throw new Error(`No exercise matching "${ref}". Use thrive_list_exercises to see what exists.`);
}

function resolveTemplate(ref, templates) {
  const q = String(ref).trim().toLowerCase();
  const match =
    templates.find((t) => t.id.toLowerCase() === q) ||
    templates.find((t) => t.name.toLowerCase() === q) ||
    templates.find((t) => t.name.toLowerCase().includes(q));
  if (!match) {
    throw new Error(
      `No template matching "${ref}". Available: ${templates.map((t) => t.name).join(', ') || '(none)'}`,
    );
  }
  return match;
}

/**
 * One workout by id, with the message agents have always seen when it is
 * missing — the API's own wording differs, and parity is the bar (#132 AC1).
 */
async function resolveWorkout(workoutId) {
  try {
    return await fetchWorkout(workoutId);
  } catch (err) {
    if (err instanceof ApiError && /not found/.test(err.message)) {
      throw new Error(`No workout with id "${workoutId}".`);
    }
    throw err;
  }
}

const isPlanned = (w) => w.status === 'planned';

/** One-line summary of a set, used in listings. */
function setLine(s) {
  const bits = [];
  if (s.weight) bits.push(formatWeight(s.weight));
  bits.push(`${s.reps || s.planned_reps || '?'} reps`);
  if (s.effort) bits.push(s.effort);
  return `set ${s.set_number}: ${bits.join(' x ')}`;
}

/** The API's `exercises` shape for a template, from resolved rows. */
const toTemplateExercises = (rows) =>
  rows.map((r) => ({ exercise: r.exercise_id, section: r.section, sets: r.sets, reps: r.reps }));

// --- read tools -----------------------------------------------------

tool(
  'thrive_list_workouts',
  'List workouts, newest first. Use this to review training history or see what is already scheduled. ' +
    'Returns a compact summary per workout; use thrive_get_workout for set-by-set detail.',
  {
    date_from: z.string().optional().describe("Only workouts on or after this date (YYYY-MM-DD, 'today', '+7d')"),
    date_to: z.string().optional().describe('Only workouts on or before this date'),
    type: z.enum(WORKOUT_TYPES).optional().describe('Filter by workout type'),
    status: z
      .enum(['completed', 'planned', 'any'])
      .optional()
      .describe("'completed' (logged), 'planned' (scheduled for later), or 'any'. Default: any"),
    name_contains: z.string().optional().describe('Case-insensitive substring match on workout name'),
    limit: z.coerce.number().optional().describe('Max workouts to return (default 25)'),
  },
  async ({ date_from, date_to, type, status = 'any', name_contains, limit = 25 }) => {
    const [workouts, sets] = await Promise.all([fetchWorkouts(), fetchSets()]);
    const from = normalizeDate(date_from);
    const to = normalizeDate(date_to);

    let list = workouts.filter((w) => {
      if (from && w.date < from) return false;
      if (to && w.date > to) return false;
      if (type && w.type !== type) return false;
      if (status === 'planned' && !isPlanned(w)) return false;
      if (status === 'completed' && isPlanned(w)) return false;
      if (name_contains && !w.name.toLowerCase().includes(name_contains.toLowerCase())) return false;
      return true;
    });

    list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const total = list.length;
    list = list.slice(0, limit);

    if (!total) return text('No workouts match those filters.');

    const lines = list.map((w) => {
      const mine = sets.filter((s) => s.workout_id === w.id);
      const exercises = new Set(mine.map(slotKey)).size;
      const logged = mine.filter((s) => isSetLogged(s, isPlanned(w))).length;
      const parts = [`- ${w.date} **${w.name || '(unnamed)'}** [${w.type}]`];
      if (isPlanned(w)) parts.push('(planned)');
      if (w.type === 'weight') parts.push(`— ${exercises} exercises, ${logged}/${mine.length} sets logged`);
      const mins = secondsToMinutes(w.elapsed_seconds);
      if (mins !== null) parts.push(`— ${mins} min`);
      if (w.effort) parts.push(`— ${w.effort}`);
      if (w.distance_m) parts.push(`— ${metersToMiles(w.distance_m)} mi`);
      if (w.notes) parts.push(`— "${w.notes}"`);
      parts.push(`(id: ${w.id})`);
      return parts.join(' ');
    });

    const header = total > list.length ? `Showing ${list.length} of ${total} workouts:` : `${total} workouts:`;
    return text(`${header}\n${lines.join('\n')}`);
  },
);

tool(
  'thrive_get_workout',
  'Get one workout in full: every exercise, every set, with weight, reps and effort.',
  { workout_id: z.string().describe('Workout id (from thrive_list_workouts)') },
  async ({ workout_id }) => {
    const w = await resolveWorkout(workout_id);
    const mine = await fetchSets(w.id);

    const out = [
      `**${w.name || '(unnamed)'}** — ${w.date}${w.time ? ` ${w.time}` : ''} [${w.type}]${isPlanned(w) ? ' (planned)' : ''}`,
      `- id: ${w.id}`,
    ];
    const mins = secondsToMinutes(w.elapsed_seconds);
    if (mins !== null) out.push(`- Duration: ${mins} min`);
    if (w.effort) out.push(`- Session effort: ${w.effort}`);
    if (w.distance_m) out.push(`- Distance: ${metersToMiles(w.distance_m)} mi`);
    if (w.ascent_m) out.push(`- Ascent: ${metersToFeet(w.ascent_m)} ft`);
    if (w.descent_m) out.push(`- Descent: ${metersToFeet(w.descent_m)} ft`);
    if (w.avg_hr) out.push(`- Avg HR: ${w.avg_hr} bpm`);
    if (w.template_id) out.push(`- From template: ${w.template_id}`);
    if (w.copied_from) out.push(`- Copied from: ${w.copied_from}`);
    if (w.notes) out.push(`- Notes: ${w.notes}`);

    if (!mine.length) {
      out.push('', 'No sets recorded.');
      return text(out.join('\n'));
    }

    out.push('');
    for (const g of groupSetsByExercise(mine)) {
      out.push(
        `**${g.exercise_name}** [${g.section || 'no section'}] ` +
          `(${g.exercise_id}, exercise_order ${g.exercise_order})`,
      );
      for (const s of g.sets) out.push(`  - ${setLine(s)}`);
    }
    return text(out.join('\n'));
  },
);

tool(
  'thrive_list_exercises',
  'List the exercise library, optionally filtered. Use before creating an exercise to avoid duplicates.',
  {
    search: z.string().optional().describe('Case-insensitive substring match on name or notes'),
    tag: z.string().optional().describe('Only exercises carrying this tag (e.g. Push, Legs, Compound)'),
  },
  async ({ search, tag }) => {
    const exercises = await fetchExercises();
    let list = exercises;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q));
    }
    if (tag) {
      const q = tag.toLowerCase();
      list = list.filter((e) => e.tags.split(',').some((t) => t.trim().toLowerCase() === q));
    }
    if (!list.length) return text('No exercises match those filters.');

    const lines = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const parts = [`- **${e.name}** (id: ${e.id})`];
        if (e.tags) parts.push(`tags: ${e.tags}`);
        if (e.notes) parts.push(`| ${e.notes}`);
        return parts.join(' ');
      });
    return text(`${list.length} of ${exercises.length} exercises:\n${lines.join('\n')}`);
  },
);

tool(
  'thrive_list_templates',
  'List workout templates with their exercises, sets, reps and sections.',
  { name_contains: z.string().optional().describe('Case-insensitive substring match on template name') },
  async ({ name_contains }) => {
    const templates = await fetchTemplates();
    const list = name_contains
      ? templates.filter((t) => t.name.toLowerCase().includes(name_contains.toLowerCase()))
      : templates;
    if (!list.length) return text('No templates found.');

    const blocks = list.map((t) => {
      const rows = t.exercises.map(
        (e) => `  ${e.order}. ${e.exercise_name} [${e.section || 'no section'}] — ${e.sets} x ${e.reps}`,
      );
      return `**${t.name}** (id: ${t.id}, ${t.exercises.length} exercises)\n${rows.join('\n')}`;
    });
    return text(blocks.join('\n\n'));
  },
);

tool(
  'thrive_exercise_history',
  'Progression for one exercise over time: every logged set, newest workout first. ' +
    'Use this to judge whether to add weight, reps or volume.',
  {
    exercise: z.string().describe('Exercise name or id'),
    limit: z.coerce.number().optional().describe('Max workouts to include (default 12)'),
    since: z.string().optional().describe('Only workouts on or after this date'),
  },
  async ({ exercise, limit = 12, since }) => {
    const [exercises, workouts, sets] = await Promise.all([
      fetchExercises(), fetchWorkouts(), fetchSets(),
    ]);
    const ex = resolveExercise(exercise, exercises);
    const from = normalizeDate(since);
    const byWorkout = new Map(workouts.map((w) => [w.id, w]));

    const relevant = sets.filter((s) => {
      if (s.exercise_id !== ex.id) return false;
      const w = byWorkout.get(s.workout_id);
      if (!w || isPlanned(w)) return false;
      if (from && w.date < from) return false;
      return s.reps || s.weight;
    });

    if (!relevant.length) {
      return text(`**${ex.name}** (${ex.id}) — no logged sets${from ? ` since ${from}` : ''}.`);
    }

    const grouped = new Map();
    for (const s of relevant) {
      if (!grouped.has(s.workout_id)) grouped.set(s.workout_id, []);
      grouped.get(s.workout_id).push(s);
    }

    const entries = [...grouped.entries()]
      .map(([wid, ss]) => ({ w: byWorkout.get(wid), sets: ss.sort((a, b) => a.set_number - b.set_number) }))
      .sort((a, b) => b.w.date.localeCompare(a.w.date))
      .slice(0, limit);

    const weights = relevant.map((s) => Number(s.weight)).filter((n) => n > 0);
    const out = [`**${ex.name}** (${ex.id})${ex.tags ? ` — ${ex.tags}` : ''}`];
    if (weights.length) out.push(`Top weight logged: ${Math.max(...weights)} lbs across ${relevant.length} sets.`);
    out.push('');

    for (const { w, sets: ss } of entries) {
      const detail = ss
        .map((s) => `${s.weight || '—'}x${s.reps || '—'}${s.effort ? ` (${s.effort})` : ''}`)
        .join(', ');
      out.push(`- ${w.date} — ${detail}  [${w.name || 'unnamed'}]`);
    }
    return text(out.join('\n'));
  },
);

// --- write tools ----------------------------------------------------

const exerciseSpec = z.object({
  exercise: z.string().describe('Exercise name or id (must already exist in the library)'),
  section: z.enum(SECTIONS).describe('Section tag; superset exercises share the same SS* tag'),
  sets: z.coerce.number().describe('Number of sets'),
  reps: z.string().describe("Planned reps, e.g. '8' or '8-10' (a range is stored as its max)"),
});

// Scheduling can prescribe a load; templates can't, so this stays separate
// from the shape the template tools share (#118).
const scheduleExerciseSpec = exerciseSpec.extend({
  weight: z.string().optional().describe(
    'Prescribed load in lbs for every set. "0" means bodyweight; omit to leave blank (e.g. warmups). ' +
    'Writes the weight only — no performed reps, so the workout still reads as not done.',
  ),
  set_weights: z.array(z.string()).optional().describe(
    'Per-set loads for ramping, e.g. ["95","115","135"]. Length must equal sets. Takes precedence over weight.',
  ),
});

// One scheduled session. thrive_schedule_week takes an array of exactly this.
const scheduleShape = {
  date: z.string().describe("Date to schedule (YYYY-MM-DD, 'today', 'tomorrow', '+3d')"),
  name: z.string().describe('Workout name, e.g. "Push A"'),
  type: z.enum(WORKOUT_TYPES).optional().describe('Workout type (default: weight)'),
  template: z.string().optional().describe('Template name or id to expand into planned sets'),
  exercises: z.array(scheduleExerciseSpec).optional().describe(
    'Explicit exercise list, with optional prescribed loads (ignored if template is given). ' +
    'Validated as a whole before anything is written: any problem rejects the call and lists every problem.',
  ),
  notes: z.string().optional().describe('Workout notes'),
  status: z
    .enum(['planned', 'completed'])
    .optional()
    .describe("Default 'planned'. Use 'completed' only to backfill a workout that already happened."),
};

/** Library and templates, read once, plus resolvers for prepareSchedule. */
async function scheduleContext() {
  const [library, templates] = await Promise.all([fetchExercises(), fetchTemplates()]);
  return {
    library,
    resolveExercise: (ref) => resolveExercise(ref, library),
    resolveTemplate: (ref) => resolveTemplate(ref, templates),
  };
}

tool(
  'thrive_schedule_workout',
  'Schedule a workout for a future date. Creates it with status "planned" so it shows as upcoming in the app. ' +
    'Supply either a template to expand, or an explicit exercise list. Weight-type workouts get one planned ' +
    'set row per set, ready for the user to fill in.',
  {
    ...scheduleShape,
    distance_m: z.string().optional().describe(
      'Distance in METERS (canonical storage unit). 12.4 miles is "19956". Pass "" to clear.',
    ),
    ascent_m: z.string().optional().describe(
      'Elevation gain in METERS. 1500 feet is "457". Pass "" to clear.',
    ),
    descent_m: z.string().optional().describe(
      'Elevation loss in METERS. Recorded for hikes only. Pass "" to clear.',
    ),
    avg_hr: z.string().optional().describe('Average heart rate in bpm. Pass "" to clear.'),
  },
  async (input) => {
    const p = prepareSchedule(input, await scheduleContext());
    if (p.errors.length) {
      throw new Error(
        `Nothing was scheduled — ${p.errors.length} problem${p.errors.length > 1 ? 's' : ''} ` +
        `to fix:\n${p.errors.map((e) => `  - ${e}`).join('\n')}`,
      );
    }

    // Sets before the workout row: if the second write fails, the set rows
    // are invisible orphans, whereas a workout row without its sets would show
    // up as an empty session.
    await appendSets(p.rows);
    await createWorkout(p.workout);

    const { workout, rows, plan } = p;
    const detail = plan.map(
      (e, i) => `  ${i + 1}. ${e.exercise_name} [${e.section}] — ${e.sets} x ${e.reps}${describeLoad(e.weights)}`,
    );
    return text(
      [
        `Scheduled **${workout.name}** for ${workout.date} [${workout.type}]${workout.status === 'planned' ? ' (planned)' : ''}`,
        `- id: ${workout.id}`,
        workout.template_id ? `- From template: ${input.template} (${workout.template_id})` : null,
        rows.length ? `- ${plan.length} exercises, ${rows.length} planned sets:` : '- No exercises attached.',
        ...detail,
      ].filter(Boolean).join('\n'),
    );
  },
);

tool(
  'thrive_schedule_week',
  'Schedule several workouts in one call — typically a training week. Each entry takes exactly the fields of ' +
    'thrive_schedule_workout (template or exercises, with prescribed loads). Every workout is validated before ' +
    'anything is written: if any has a problem, none are scheduled and every problem is listed by index.',
  {
    workouts: z
      .array(
        z
          .object(scheduleShape)
          // Passthrough so a misnamed field is reported per workout rather than silently stripped.
          .passthrough(),
      )
      .min(1)
      .describe('The sessions to schedule, in any order.'),
  },
  async ({ workouts }) => {
    const ctx = await scheduleContext();
    const accepted = Object.keys(scheduleShape);
    const errors = [];
    const prepared = [];

    workouts.forEach((input, i) => {
      const where = `workouts[${i}] "${input.name}"`;
      const unknown = findUnknownFields(input, accepted);
      if (unknown.length) {
        errors.push(`${where}: unknown field ${unknown.map((k) => `"${k}"`).join(', ')} — accepted: ${accepted.join(', ')}`);
        return;
      }
      const p = prepareSchedule(input, ctx);
      if (p.errors.length) errors.push(...p.errors.map((e) => `${where}: ${e}`));
      else prepared.push(p);
    });

    if (errors.length) {
      throw new Error(
        `Nothing was scheduled — ${errors.length} problem${errors.length > 1 ? 's' : ''} across ` +
        `${workouts.length} workouts:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      );
    }

    // Every set first, for the reason given in thrive_schedule_workout, then
    // the workouts. appendSets chunks a large week to fit the API's payload
    // limit (#132 AC5); if a workout write fails partway, say which landed.
    await appendSets(prepared.flatMap((p) => p.rows));
    const created = [];
    for (const p of prepared) {
      try {
        await createWorkout(p.workout);
      } catch (err) {
        throw new Error(
          `${err.message} — all set rows were written, and ${created.length} of ${prepared.length} ` +
          'workouts were created before this one failed' +
          (created.length ? ` (${created.map((w) => `${w.date} ${w.name}`).join('; ')})` : '') +
          '. Re-running would duplicate those; remove them first or schedule only the rest.',
        );
      }
      created.push(p.workout);
    }

    return text(
      [
        `Scheduled ${prepared.length} workout${prepared.length > 1 ? 's' : ''}:`,
        ...prepared.map(({ workout: w, rows }) =>
          `- ${w.date} **${w.name}** [${w.type}]${w.status === 'planned' ? ' (planned)' : ''} — ` +
          `${rows.length} planned sets (id: ${w.id})`),
      ].join('\n'),
    );
  },
);

tool(
  'thrive_create_exercise',
  'Add a new exercise to the library. Checks for an existing exercise with the same name first.',
  {
    name: z.string().describe('Exercise name'),
    tags: z.string().optional().describe('Comma-separated tags, e.g. "Push, Chest, Compound"'),
    notes: z.string().optional().describe('Notes — equipment, setup cues, form reminders'),
    allow_duplicate_name: z
      .boolean()
      .optional()
      .describe('Create even if an exercise with this name already exists (default false)'),
  },
  async ({ name, tags = '', notes = '', allow_duplicate_name = false }) => {
    const existing = await fetchExercises();
    const clash = existing.filter((e) => e.name.toLowerCase() === name.trim().toLowerCase());
    if (clash.length && !allow_duplicate_name) {
      return text(
        `**${name}** already exists (id: ${clash[0].id}${clash[0].tags ? `, tags: ${clash[0].tags}` : ''}). ` +
        `Nothing created. Use thrive_update_exercise to change it, or pass allow_duplicate_name: true.`,
      );
    }
    const ex = await createExercise({ name: name.trim(), tags, notes });
    return text(
      `Created **${ex.name}** (id: ${ex.id})${ex.tags ? `\n- Tags: ${ex.tags}` : ''}${ex.notes ? `\n- Notes: ${ex.notes}` : ''}`,
    );
  },
);

tool(
  'thrive_update_exercise',
  'Update an exercise. Renaming also rewrites the cached exercise name in every Sets and Templates row, ' +
    'so history stays consistent. Only pass the fields you want to change.',
  {
    exercise: z.string().describe('Exercise name or id to update'),
    name: z.string().optional().describe('New name'),
    tags: z.string().optional().describe('New comma-separated tags (replaces existing)'),
    notes: z.string().optional().describe('New notes (replaces existing)'),
  },
  async ({ exercise, name, tags, notes }) => {
    const exercises = await fetchExercises();
    const ex = resolveExercise(exercise, exercises);
    if (name === undefined && tags === undefined && notes === undefined) {
      return text('No changes provided.');
    }

    // Only the fields passed — the API merges, so an omitted field is left
    // alone. A rename cascades into Sets and Templates server-side, in the
    // same call, and reports how many rows it rewrote (#134 AC5).
    const changes = {};
    if (name !== undefined) changes.name = name.trim();
    if (tags !== undefined) changes.tags = tags;
    if (notes !== undefined) changes.notes = notes;
    const updated = await updateExercise(ex.id, changes);

    const out = [`Updated **${updated.name}** (${updated.id})`];
    if (name !== undefined && name.trim() !== ex.name) {
      const { sets, templates } = updated.cascaded;
      out.push(`- Renamed from "${ex.name}"; propagated to ${sets} set rows and ${templates} template rows.`);
    }
    if (tags !== undefined) out.push(`- Tags: ${updated.tags || '(none)'}`);
    if (notes !== undefined) out.push(`- Notes: ${updated.notes || '(none)'}`);
    return text(out.join('\n'));
  },
);

tool(
  'thrive_update_workout',
  'Fix a workout record: change its date, name, type, notes, duration, session effort, cardio attributes, or flip it between planned and completed. ' +
    'Only pass the fields you want to change.',
  {
    workout_id: z.string().describe('Workout id'),
    date: z.string().optional().describe("New date (YYYY-MM-DD, 'today', '+3d')"),
    name: z.string().optional().describe('New name'),
    type: z.enum(WORKOUT_TYPES).optional().describe('New type'),
    notes: z.string().optional().describe('New notes (replaces existing)'),
    duration_min: z.union([z.number(), z.string()]).optional().describe(
      'New duration in whole MINUTES, e.g. 63. Stored as seconds. Pass "" to clear. ' +
      'Use this or elapsed_seconds, not both.',
    ),
    elapsed_seconds: z.string().optional().describe(
      'New elapsed time, in SECONDS (the unit the sheet stores). 45 minutes is "2700".',
    ),
    distance_m: z.string().optional().describe(
      'Distance in METERS (canonical storage unit). 12.4 miles is "19956". Pass "" to clear.',
    ),
    ascent_m: z.string().optional().describe(
      'Elevation gain in METERS. 1500 feet is "457". Pass "" to clear.',
    ),
    descent_m: z.string().optional().describe(
      'Elevation loss in METERS. Recorded for hikes only. Pass "" to clear.',
    ),
    avg_hr: z.string().optional().describe('Average heart rate in bpm. Pass "" to clear.'),
    effort: z
      .enum([...EFFORTS, ''])
      .optional()
      .describe(
        'Session-level effort. Pass "" to clear it back to unset. Omit to leave it alone. ' +
        'Independent of per-set effort, and never inferred from it.',
      ),
    status: z
      .enum(['planned', 'completed'])
      .optional()
      .describe("'planned' marks it upcoming; 'completed' marks it done"),
  },
  async ({ workout_id, date, name, type, notes, duration_min, elapsed_seconds, effort,
           distance_m, ascent_m, descent_m, avg_hr, status }) => {
    if (duration_min !== undefined && elapsed_seconds !== undefined) {
      throw new Error('Pass duration_min (whole minutes) or elapsed_seconds (seconds), not both.');
    }
    const seconds = duration_min !== undefined ? parseDurationMinutes(duration_min) : elapsed_seconds;

    const w = await resolveWorkout(workout_id);

    // `changes` narrates for the agent; `fields` is what the API merges. Only
    // the fields mentioned are sent, so nothing else can be blanked (#122).
    const changes = [];
    const fields = {};
    const updated = { ...w };
    if (date !== undefined) {
      const d = normalizeDate(date);
      if (!d) throw new Error(`Could not read "${date}" as a date.`);
      changes.push(`date ${w.date} -> ${d}`);
      updated.date = d;
      fields.date = d;
    }
    if (name !== undefined) { changes.push(`name "${w.name}" -> "${name}"`); updated.name = name; fields.name = name; }
    if (type !== undefined) { changes.push(`type ${w.type} -> ${type}`); updated.type = type; fields.type = type; }
    if (notes !== undefined) { changes.push('notes updated'); updated.notes = notes; fields.notes = notes; }
    if (seconds !== undefined) {
      const mins = secondsToMinutes(seconds);
      changes.push(mins === null ? 'duration cleared' : `duration -> ${mins} min`);
      updated.elapsed_seconds = seconds;
      fields.elapsed_seconds = seconds;
    }
    if (effort !== undefined) {
      changes.push(`effort ${w.effort || '(unset)'} -> ${effort || '(unset)'}`);
      updated.effort = effort;
      fields.effort = effort;
    }
    for (const [key, value] of Object.entries({ distance_m, ascent_m, descent_m, avg_hr })) {
      if (value === undefined) continue;
      changes.push(`${key} ${w[key] || '(unset)'} -> ${value || '(unset)'}`);
      updated[key] = value;
      fields[key] = value;
    }
    if (status !== undefined) {
      const s = status === 'planned' ? 'planned' : '';
      changes.push(`status ${w.status || 'completed'} -> ${status}`);
      updated.status = s;
      fields.status = s;
    }
    if (!changes.length) return text('No changes provided.');

    await updateWorkout(w.id, fields);
    return text(`Updated **${updated.name || '(unnamed)'}** (${updated.id}):\n${changes.map((c) => `- ${c}`).join('\n')}`);
  },
);

tool(
  'thrive_update_set',
  'Correct a single logged set — weight, reps, effort or planned reps. ' +
    'Identify it by workout, exercise and set number. If the exercise appears in more than one ' +
    'section of that workout (say a warmup and a primary of the same lift), add section or ' +
    'exercise_order to say which one — each has its own set numbering.',
  {
    workout_id: z.string().describe('Workout id'),
    exercise: z.string().describe('Exercise name or id within that workout'),
    set_number: z.coerce.number().describe('Which set (1-based, within the section)'),
    section: z
      .enum(SECTIONS)
      .optional()
      .describe('Which section of the workout, when the exercise appears in several'),
    exercise_order: z.coerce
      .number()
      .optional()
      .describe('Position of the exercise in the workout, as an alternative to section'),
    weight: z.string().optional().describe('Weight in lbs'),
    reps: z.string().optional().describe('Reps actually performed'),
    planned_reps: z.string().optional().describe('Planned reps'),
    effort: z.enum(EFFORTS).optional().describe('Effort level'),
  },
  async ({
    workout_id, exercise, set_number, section, exercise_order,
    weight, reps, planned_reps, effort,
  }) => {
    // Resolve the exercise here so a bad reference keeps its familiar message;
    // the API resolves which set that is, and writes it.
    const ex = resolveExercise(exercise, await fetchExercises());

    const u = { exercise: ex.id, set_number };
    if (section !== undefined) u.section = section;
    if (exercise_order !== undefined) u.exercise_order = exercise_order;
    if (weight !== undefined) u.weight = weight;
    if (reps !== undefined) u.reps = reps;
    if (planned_reps !== undefined) u.planned_reps = planned_reps;
    if (effort !== undefined) u.effort = effort;

    let change;
    try {
      [change] = (await updateSets(workout_id, [u])).changes;
    } catch (err) {
      // One entry, so drop the batch prefix and surface the bare reason.
      if (err instanceof ApiError && isEntryErrors(err.message)) {
        throw new Error(stripEntryPrefix(err.message));
      }
      throw err;
    }
    return text(
      `Updated ${ex.name} [${change.slot.section || 'no section'}] in ${workout_id} — ${setLine(change.after)}`,
    );
  },
);

tool(
  'thrive_update_sets',
  'Correct many sets of one workout in a single call — the bulk form of thrive_update_set, for post-session ' +
    'logging. Every entry is validated first: if any entry fails to resolve, nothing is written and every ' +
    'problem is listed. Returns the resulting state of each updated set, so no follow-up read is needed.',
  {
    workout_id: z.string().describe('Workout id'),
    updates: z
      .array(
        z
          .object({
            exercise: z.string().describe('Exercise name or id within that workout'),
            set_number: z.coerce.number().describe('Which set (1-based, within the section)'),
            section: z.enum(SECTIONS).optional().describe('Which section, when the exercise appears in several'),
            exercise_order: z.coerce.number().optional().describe('Position of the exercise, as an alternative to section'),
            weight: z.string().optional().describe('Weight in lbs ("0" = bodyweight)'),
            reps: z.string().optional().describe('Reps actually performed'),
            planned_reps: z.string().optional().describe('Planned reps'),
            effort: z.enum(EFFORTS).optional().describe('Effort level'),
          })
          // Passthrough so a misnamed field is reported per entry rather than silently stripped.
          .passthrough(),
      )
      .min(1)
      .describe('One entry per set. Only the fields you pass change.'),
  },
  async ({ workout_id, updates }) => {
    const [library] = await Promise.all([fetchExercises(), resolveWorkout(workout_id)]);

    let changes;
    try {
      changes = await planAndApplySetUpdates(workout_id, updates, {
        resolveExercise: (ref) => resolveExercise(ref, library),
        previewSetUpdates,
        updateSets,
      });
    } catch (err) {
      if (!(err instanceof EntryErrors)) throw err;
      throw new Error(
        `Nothing was written — ${err.errors.length} of ${updates.length} entries can't be applied:\n` +
        err.errors.map((e) => `  - ${e}`).join('\n'),
      );
    }

    return text(
      [
        `Updated ${changes.length} set${changes.length > 1 ? 's' : ''} in ${workout_id}:`,
        ...changes.map(
          (c) => `- ${c.exercise.name} [${c.slot.section || 'no section'}] set ${c.after.set_number}: ${describeSetState(c.after)}`,
        ),
      ].join('\n'),
    );
  },
);

tool(
  'thrive_create_template',
  'Create a reusable workout template from an ordered exercise list.',
  {
    name: z.string().describe('Template name'),
    exercises: z.array(exerciseSpec).describe('Exercises in the order they should be performed'),
  },
  async ({ name, exercises }) => {
    if (!exercises.length) throw new Error('A template needs at least one exercise.');
    const library = await fetchExercises();
    const rows = exercises.map((spec) => {
      const ex = resolveExercise(spec.exercise, library);
      return {
        exercise_id: ex.id,
        exercise_name: ex.name,
        section: spec.section,
        sets: String(spec.sets),
        reps: normalizeRangeToMax(spec.reps),
      };
    });
    const tpl = await createTemplate({ name, exercises: toTemplateExercises(rows) });
    const detail = rows.map((e, i) => `  ${i + 1}. ${e.exercise_name} [${e.section}] — ${e.sets} x ${e.reps}`);
    return text(`Created template **${name}** (id: ${tpl.id})\n${detail.join('\n')}`);
  },
);

tool(
  'thrive_update_template',
  'Replace a template\'s exercise list wholesale. Destructive — the old rows are deleted. ' +
    'Dry-run by default: shows the before/after and only writes when confirm is true.',
  {
    template: z.string().describe('Template name or id'),
    name: z.string().optional().describe('New template name (keeps the existing name if omitted)'),
    exercises: z.array(exerciseSpec).describe('The complete new exercise list — replaces all existing rows'),
    confirm: z.boolean().optional().describe('Set true to actually write. Default false = preview only.'),
  },
  async ({ template, name, exercises, confirm = false }) => {
    if (!exercises.length) throw new Error('A template needs at least one exercise.');
    const tpl = resolveTemplate(template, await fetchTemplates());
    const library = await fetchExercises();

    const rows = exercises.map((spec) => {
      const ex = resolveExercise(spec.exercise, library);
      return {
        exercise_id: ex.id,
        exercise_name: ex.name,
        section: spec.section,
        sets: String(spec.sets),
        reps: normalizeRangeToMax(spec.reps),
      };
    });

    const newName = name ?? tpl.name;
    const before = tpl.exercises.map((e, i) => `  ${i + 1}. ${e.exercise_name} [${e.section}] — ${e.sets} x ${e.reps}`);
    const after = rows.map((e, i) => `  ${i + 1}. ${e.exercise_name} [${e.section}] — ${e.sets} x ${e.reps}`);

    if (!confirm) {
      return text(
        [
          `DRY RUN — nothing written. Replacing template **${tpl.name}** (${tpl.id}):`,
          '',
          `Current (${tpl.exercises.length} rows, would be deleted):`,
          ...before,
          '',
          `Proposed (${rows.length} rows)${newName !== tpl.name ? `, renamed to "${newName}"` : ''}:`,
          ...after,
          '',
          'Call again with confirm: true to apply.',
        ].join('\n'),
      );
    }

    await replaceTemplate(tpl.id, { name: newName, exercises: toTemplateExercises(rows) });
    return text(`Replaced template **${newName}** (${tpl.id}) — ${tpl.exercises.length} rows removed, ${rows.length} written.\n${after.join('\n')}`);
  },
);

tool(
  'thrive_delete_workout',
  'Delete a workout and all of its sets. Destructive and dry-run by default: shows exactly what would go, ' +
    'and only deletes when confirm is true.',
  {
    workout_id: z.string().describe('Workout id'),
    confirm: z.boolean().optional().describe('Set true to actually delete. Default false = preview only.'),
  },
  async ({ workout_id, confirm = false }) => {
    const w = await resolveWorkout(workout_id);
    const mine = await fetchSets(w.id);

    const summary = [
      `**${w.name || '(unnamed)'}** — ${w.date} [${w.type}]${isPlanned(w) ? ' (planned)' : ''} (${w.id})`,
      `- ${mine.length} set rows`,
      ...groupSetsByExercise(mine).map((g) => `  - ${g.exercise_name}: ${g.sets.length} sets`),
    ];

    if (!confirm) {
      return text(
        `DRY RUN — nothing deleted. This would remove:\n${summary.join('\n')}\n\nCall again with confirm: true to delete.`,
      );
    }

    const { sets_deleted: setsDeleted } = await deleteWorkout(w.id);
    return text(`Deleted workout **${w.name || '(unnamed)'}** (${w.id}) and ${setsDeleted} set rows.`);
  },
);

tool(
  'thrive_delete_exercise',
  'Delete an exercise from the library. Destructive and dry-run by default. Reports how many workouts and ' +
    'templates reference it — deleting one that is in use leaves orphaned history, so prefer this for ' +
    'exercises created by mistake.',
  {
    exercise: z.string().describe('Exercise name or id'),
    confirm: z.boolean().optional().describe('Set true to actually delete. Default false = preview only.'),
    force_when_in_use: z
      .boolean()
      .optional()
      .describe('Allow deletion even when sets or templates reference it (default false)'),
  },
  async ({ exercise, confirm = false, force_when_in_use = false }) => {
    const [exercises, sets, templates, workouts] = await Promise.all([
      fetchExercises(), fetchSets(), fetchTemplates(), fetchWorkouts(),
    ]);
    const templateRows = templates.flatMap((t) => t.exercises);
    const ex = resolveExercise(exercise, exercises);
    const usedSets = sets.filter((s) => s.exercise_id === ex.id);
    const usedTemplates = [...new Set(templateRows.filter((r) => r.exercise_id === ex.id).map((r) => r.template_name))];
    const usedWorkouts = [...new Set(usedSets.map((s) => s.workout_id))]
      .map((id) => workouts.find((w) => w.id === id))
      .filter(Boolean);
    const inUse = usedSets.length > 0 || usedTemplates.length > 0;

    const summary = [
      `**${ex.name}** (${ex.id})${ex.tags ? ` — ${ex.tags}` : ''}`,
      `- Referenced by ${usedSets.length} set rows across ${usedWorkouts.length} workouts`,
      `- Referenced by ${usedTemplates.length} templates${usedTemplates.length ? `: ${usedTemplates.join(', ')}` : ''}`,
    ];
    if (usedWorkouts.length) {
      const recent = usedWorkouts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
      summary.push(`- Most recent: ${recent.map((w) => `${w.date} ${w.name || w.id}`).join('; ')}`);
    }

    if (!confirm) {
      return text(
        `DRY RUN — nothing deleted.\n${summary.join('\n')}\n\n` +
        (inUse
          ? 'This exercise is in use. Deleting it removes only the library row; the set and template rows above would keep its id and name as orphans. Call again with confirm: true and force_when_in_use: true to proceed anyway.'
          : 'Not referenced anywhere — safe to delete. Call again with confirm: true.'),
      );
    }

    if (inUse && !force_when_in_use) {
      return fail(
        `Refusing to delete **${ex.name}** — it is still referenced.\n${summary.join('\n')}\n\n` +
        'Pass force_when_in_use: true if you really mean to orphan those rows.',
      );
    }

    await deleteExercise(ex.id);
    return text(`Deleted exercise **${ex.name}** (${ex.id}).${inUse ? ' Referencing set/template rows were left in place.' : ''}`);
  },
);

// --- start ----------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
