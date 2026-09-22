// Pure-function tests for the domain layer. No sheet access — run with:
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDate, normalizeRangeToMax, todayStr,
  slotKey, groupSetsByExercise, secondsToMinutes, metersToMiles, metersToFeet,
  parseDurationMinutes, findUnknownFields, findStaleExerciseNames,
  formatWeight, describeLoad, isSetLogged, buildSchedulePlan,
  describeSetState,
  prepareSchedule, startedAtUtc, denverOffset,
} from './domain.js';

test('normalizeDate passes ISO dates through', () => {
  assert.equal(normalizeDate('2026-03-14'), '2026-03-14');
});

test('normalizeDate understands relative keywords', () => {
  const d = new Date();
  assert.equal(normalizeDate('today'), todayStr(d));
  d.setDate(d.getDate() + 1);
  assert.equal(normalizeDate('tomorrow'), todayStr(d));
  d.setDate(d.getDate() + 2);
  assert.equal(normalizeDate('+3d'), todayStr(d));
});

test('normalizeDate returns empty for junk and empty input', () => {
  assert.equal(normalizeDate('next tuesday-ish'), '');
  assert.equal(normalizeDate(''), '');
  assert.equal(normalizeDate(undefined), '');
});

test('normalizeDate uses the local calendar day, not UTC', () => {
  // A late-evening local time must not roll forward the way toISOString would.
  const evening = new Date(2026, 2, 14, 23, 30);
  assert.equal(todayStr(evening), '2026-03-14');
});

test('normalizeRangeToMax collapses a range to its top end', () => {
  assert.equal(normalizeRangeToMax('8-10'), '10');
  assert.equal(normalizeRangeToMax('12'), '12');
  assert.equal(normalizeRangeToMax(' 6 - 8 '), '8');
});

test('normalizeRangeToMax leaves non-numeric values alone', () => {
  assert.equal(normalizeRangeToMax('AMRAP'), 'AMRAP');
  assert.equal(normalizeRangeToMax(''), '');
  assert.equal(normalizeRangeToMax(undefined), '');
});

// --- set slots ------------------------------------------------------
// The same exercise can appear in two sections of one workout (a warmup and a
// primary of the same lift). Those are separate slots with separate set
// numbering — matching on exercise_id alone made "primary set 1" resolve to
// the warmup row and overwrite it.
//
// Resolution moved to the Apps Script API (#134); grouping stays here because
// thrive_get_workout and thrive_list_workouts narrate by slot.

const slotSets = [
  { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'warmup', exercise_order: 1, set_number: 1 },
  { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'warmup', exercise_order: 1, set_number: 2 },
  { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'primary', exercise_order: 2, set_number: 1 },
  { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'primary', exercise_order: 2, set_number: 2 },
  { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'primary', exercise_order: 2, set_number: 3 },
  { workout_id: 'w2', exercise_id: 'ex_ohp', exercise_name: 'OH Press', section: 'primary', exercise_order: 1, set_number: 1 },
];

test('groupSetsByExercise keeps a warmup and a primary of the same lift apart', () => {
  const slots = groupSetsByExercise(slotSets.filter((s) => s.workout_id === 'w1'));
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((g) => g.section), ['warmup', 'primary']);
  assert.deepEqual(slots.map((g) => g.sets.length), [2, 3]);
});

test('groupSetsByExercise orders slots by exercise_order and sets by set number', () => {
  const shuffled = [...slotSets.filter((s) => s.workout_id === 'w1')].reverse();
  const slots = groupSetsByExercise(shuffled);
  assert.deepEqual(slots.map((g) => g.exercise_order), [1, 2]);
  assert.deepEqual(slots[1].sets.map((s) => s.set_number), [1, 2, 3]);
});

test('slotKey separates the same exercise in two positions', () => {
  assert.notEqual(slotKey(slotSets[0]), slotKey(slotSets[2]));
  assert.equal(slotKey(slotSets[2]), slotKey(slotSets[3]));
});

// --- #101: durations are stored in seconds, displayed in minutes ----

test('secondsToMinutes reads a migrated 62-minute workout back as 62', () => {
  assert.equal(secondsToMinutes('3720'), 62);
});

test('secondsToMinutes returns null for an unset duration, not 0', () => {
  assert.equal(secondsToMinutes(''), null);
  assert.equal(secondsToMinutes('abc'), null);
});

test('secondsToMinutes tells a genuine zero apart from an absent value', () => {
  assert.equal(secondsToMinutes('0'), 0);
  assert.equal(secondsToMinutes(''), null);
});

// --- #103: cardio unit conversions mirror frontend/src/api/units.ts --

test('metersToMiles reads 19956 m back as 12.4 mi', () => {
  assert.equal(metersToMiles('19956'), 12.4);
});

test('metersToFeet reads 457 m back as 1500 ft', () => {
  assert.equal(metersToFeet('457'), 1500);
});

test('cardio conversions return null for an unset value, not 0', () => {
  assert.equal(metersToMiles(''), null);
  assert.equal(metersToFeet(''), null);
});

test('cardio conversions keep a deliberate zero distinct from unset', () => {
  assert.equal(metersToMiles('0'), 0);
  assert.equal(metersToFeet('0'), 0);
});

// --- #117: agent-supplied durations and undeclared fields ------------

test('parseDurationMinutes stores 63 minutes as 3780 seconds', () => {
  assert.equal(parseDurationMinutes(63), '3780');
  assert.equal(parseDurationMinutes('63'), '3780');
  assert.equal(parseDurationMinutes(' 63 '), '3780');
});

test('parseDurationMinutes clears on empty, never defaults to 0', () => {
  assert.equal(parseDurationMinutes(''), '');
  assert.equal(parseDurationMinutes('0'), '0', 'a deliberate zero stays zero');
});

test('parseDurationMinutes refuses anything that is not whole minutes', () => {
  for (const bad of ['63 min', '-5', '63.5', 'abc', 63.5, -5]) {
    assert.throws(() => parseDurationMinutes(bad), /whole minutes/, `should reject ${bad}`);
  }
});

test('findUnknownFields names keys the schema does not declare', () => {
  const allowed = ['workout_id', 'duration_min', 'elapsed_seconds'];
  assert.deepEqual(findUnknownFields({ workout_id: 'w1', duration_sec: 60 }, allowed), ['duration_sec']);
  assert.deepEqual(findUnknownFields({ workout_id: 'w1', duration_min: 63 }, allowed), []);
  assert.deepEqual(findUnknownFields(undefined, allowed), []);
});

// --- #120: cached exercise names drift from the library --------------

const library = [
  { id: 'ex_032', name: 'Cable Tricep Pushdown Rope' },
  { id: 'ex_012', name: 'Bench Press BB' },
];

test('findStaleExerciseNames reports a cached name that differs from the library', () => {
  const rows = [{ exercise_id: 'ex_032', exercise_name: 'Rope Tricep Pushdown FT' }];
  const { stale, orphans } = findStaleExerciseNames(rows, library);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, 'Cable Tricep Pushdown Rope');
  assert.equal(stale[0].row, rows[0], 'the original row comes back so callers keep its location');
  assert.equal(orphans.length, 0);
});

test('findStaleExerciseNames leaves matching names alone', () => {
  const { stale, orphans } = findStaleExerciseNames(
    [{ exercise_id: 'ex_012', exercise_name: 'Bench Press BB' }], library,
  );
  assert.deepEqual([stale.length, orphans.length], [0, 0]);
});

test('findStaleExerciseNames separates rows whose id is not in the library', () => {
  const rows = [
    { exercise_id: 'ex_gone', exercise_name: 'Kettlebell Swings KB' },
    { exercise_id: '', exercise_name: 'No id at all' },
  ];
  const { stale, orphans } = findStaleExerciseNames(rows, library);
  assert.equal(stale.length, 0, 'an orphan has no correct name to refresh to');
  assert.deepEqual(orphans, rows);
});

// --- #118: prescribed load at schedule time --------------------------

const resolveFrom = (lib) => (ref) => {
  const ex = lib.find((e) => e.id === ref || e.name === ref);
  if (!ex) throw new Error(`No exercise matching "${ref}".`);
  return ex;
};
const schedLib = [
  { id: 'ex_bench', name: 'Bench Press BB' },
  { id: 'ex_squat', name: 'Squat BB' },
  { id: 'ex_cars', name: 'Shoulder CARs' },
  { id: 'ex_cgpu', name: 'Push Ups - Close Grip' },
  { id: 'ex_plank', name: 'Side Plank' },
];

test('buildSchedulePlan applies weight to every set (AC1)', () => {
  const { plan, errors } = buildSchedulePlan(
    [{ exercise: 'Bench Press BB', section: 'primary', sets: 4, reps: '8', weight: '115' }],
    resolveFrom(schedLib),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(plan[0].weights, ['115', '115', '115', '115']);
  assert.equal(plan[0].reps, '8');
});

test('buildSchedulePlan lets set_weights ramp and win over weight (AC2)', () => {
  const { plan } = buildSchedulePlan(
    [{ exercise: 'Squat BB', section: 'primary', sets: 3, reps: '5', weight: '999', set_weights: ['95', '115', '135'] }],
    resolveFrom(schedLib),
  );
  assert.deepEqual(plan[0].weights, ['95', '115', '135']);
});

test('buildSchedulePlan keeps blank, bodyweight and timed values intact (AC3)', () => {
  const { plan } = buildSchedulePlan([
    { exercise: 'Shoulder CARs', section: 'warmup', sets: 1, reps: '' },
    { exercise: 'Push Ups - Close Grip', section: 'SS2', sets: 3, reps: '12', weight: '0' },
    { exercise: 'Side Plank', section: 'burnout', sets: 3, reps: '45 sec' },
  ], resolveFrom(schedLib));
  assert.deepEqual(plan[0].weights, [''], 'omitted weight stays blank');
  assert.equal(plan[0].reps, '', 'blank warmup reps stay blank');
  assert.deepEqual(plan[1].weights, ['0', '0', '0'], 'bodyweight is "0", not blank');
  assert.equal(plan[2].reps, '45 sec');
});

test('buildSchedulePlan reports every problem at once, with its index (AC4)', () => {
  const { plan, errors } = buildSchedulePlan([
    { exercise: 'Bench Press BB', section: 'primary', sets: 4, reps: '8', weight: '115' },
    { exercise: 'Benchpress', section: 'primary', sets: 3, reps: '8' },
    { exercise: 'Squat BB', section: 'primary', sets: 3, reps: '5', set_weights: ['95', '115'] },
  ], resolveFrom(schedLib));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^exercises\[1\] "Benchpress": No exercise matching/);
  assert.match(errors[1], /^exercises\[2\] "Squat BB": set_weights has 2 values but sets is 3/);
  assert.equal(plan.length, 1, 'callers must check errors before writing anything');
});

test('buildSchedulePlan rejects a set count that is not a positive whole number', () => {
  const { errors } = buildSchedulePlan(
    [{ exercise: 'Bench Press BB', section: 'primary', sets: 0, reps: '8' }],
    resolveFrom(schedLib),
  );
  assert.match(errors[0], /sets must be a whole number of at least 1/);
});

test('formatWeight renders bodyweight distinctly from blank (AC3)', () => {
  assert.equal(formatWeight('115'), '115 lbs');
  assert.equal(formatWeight('0'), 'bodyweight');
  assert.equal(formatWeight(''), '');
});

test('describeLoad summarises single, ramped and missing loads', () => {
  assert.equal(describeLoad(['115', '115']), ' @ 115 lbs');
  assert.equal(describeLoad(['0', '0']), ' @ bodyweight');
  assert.equal(describeLoad(['95', '115', '135']), ' @ 95 / 115 / 135');
  assert.equal(describeLoad(['', '']), '');
  assert.equal(describeLoad(undefined), '');
});

test('isSetLogged ignores a prescribed weight on a planned workout (AC1)', () => {
  const prescribed = { weight: '115', reps: '', effort: '' };
  assert.equal(isSetLogged(prescribed, true), false);
  assert.equal(isSetLogged({ ...prescribed, reps: '8' }, true), true);
  assert.equal(isSetLogged({ ...prescribed, effort: 'Hard' }, true), true);
  assert.equal(isSetLogged(prescribed, false), true, 'completed workouts keep counting weight-only sets');
});

// --- #119: bulk set updates ------------------------------------------
// Resolution, the same-set guard and all-or-nothing writes are the API's now
// (apps-script/tests/sets-*.test.ts). The narration of the result stays here.

test('describeSetState echoes the resulting row', () => {
  assert.equal(
    describeSetState({ weight: '115', reps: '6', planned_reps: '8', effort: 'Hard' }),
    'weight 115 lbs · reps 6 · planned 8 · effort Hard',
  );
  assert.equal(
    describeSetState({ weight: '0', reps: '', planned_reps: '', effort: '' }),
    'weight bodyweight · reps — · planned — · effort —',
  );
});

// --- #121: one validation path for a session and a week --------------

const pushTemplate = {
  id: 'tpl_push', name: '1 - Upper Push A',
  exercises: [
    { order: 1, exercise_id: 'ex_bench', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '5' },
    { order: 2, exercise_id: 'ex_cgpu', exercise_name: 'Close Grip Push Ups', section: 'SS1', sets: '2', reps: '12' },
  ],
};
const scheduleCtx = (templates = [pushTemplate]) => ({
  library: schedLib,
  resolveExercise: resolveFrom(schedLib),
  resolveTemplate: (ref) => {
    const t = templates.find((x) => x.id === ref || x.name === ref);
    if (!t) throw new Error(`No template matching "${ref}".`);
    return t;
  },
});

test('prepareSchedule builds a planned workout and its set rows without writing', () => {
  const p = prepareSchedule({
    date: '2026-09-14', name: 'Push',
    exercises: [
      { exercise: 'Bench Press BB', section: 'primary', sets: 2, reps: '8', set_weights: ['95', '115'] },
      { exercise: 'Side Plank', section: 'burnout', sets: 1, reps: '45 sec' },
    ],
  }, scheduleCtx());
  assert.deepEqual(p.errors, []);
  assert.equal(p.workout.status, 'planned');
  assert.equal(p.workout.date, '2026-09-14');
  assert.match(p.workout.id, /^w_[0-9a-f]{8}$/);
  assert.equal(p.rows.length, 3);
  assert.ok(p.rows.every((r) => r.workout_id === p.workout.id), 'rows point at the minted id');
  assert.deepEqual(p.rows.map((r) => [r.exercise_order, r.set_number, r.weight, r.planned_reps]), [
    [1, 1, '95', '8'], [1, 2, '115', '8'], [2, 1, '', '45 sec'],
  ]);
});

test('prepareSchedule expands a template with library names', () => {
  const p = prepareSchedule({ date: '2026-09-14', name: 'Push', template: '1 - Upper Push A' }, scheduleCtx());
  assert.deepEqual(p.errors, []);
  assert.equal(p.workout.template_id, 'tpl_push');
  assert.equal(p.rows.length, 5);
  assert.ok(p.rows.some((r) => r.exercise_name === 'Push Ups - Close Grip'), 'cached name replaced');
  assert.ok(p.rows.every((r) => r.weight === ''));
});

test('prepareSchedule collects a bad date and a bad exercise together (#121 AC2)', () => {
  const p = prepareSchedule({
    date: 'next tuesday-ish', name: 'Legs',
    exercises: [{ exercise: 'Nope', section: 'primary', sets: 3, reps: '5' }],
  }, scheduleCtx());
  assert.equal(p.errors.length, 2);
  assert.match(p.errors[0], /could not read "next tuesday-ish" as a date/);
  assert.match(p.errors[1], /exercises\[0\] "Nope": No exercise matching/);
  assert.equal(p.workout, undefined, 'nothing built to write');
});

test('prepareSchedule refuses orphaned template rows and unknown templates', () => {
  const broken = { ...pushTemplate, exercises: [{ ...pushTemplate.exercises[0], exercise_id: 'ex_gone', order: 1 }] };
  assert.match(
    prepareSchedule({ date: 'today', name: 'x', template: broken.name }, scheduleCtx([broken])).errors[0],
    /row 1: "Bench Press BB" \(ex_gone\)/,
  );
  assert.match(
    prepareSchedule({ date: 'today', name: 'x', template: 'Nope' }, scheduleCtx()).errors[0],
    /No template matching "Nope"/,
  );
});

test('prepareSchedule needs exercises for weight workouts only', () => {
  assert.match(prepareSchedule({ date: 'today', name: 'x' }, scheduleCtx()).errors[0], /needs either a template or an exercises list/);
  const hike = prepareSchedule({ date: 'today', name: 'Hike', type: 'hike' }, scheduleCtx());
  assert.deepEqual([hike.errors.length, hike.rows.length, hike.workout.type], [0, 0, 'hike']);
});

// --- #128: started_at_utc, DST-aware ---------------------------------
// Kept client-side for scripts/migrate-128-workouts-a-to-z.mjs.

// AC4: the offset is resolved per row, for that row's own date.
test('startedAtUtc applies MST in January and MDT in July', () => {
  assert.equal(startedAtUtc('2026-01-15', '09:00'), '2026-01-15T09:00:00-07:00');
  assert.equal(startedAtUtc('2026-07-15', '09:00'), '2026-07-15T09:00:00-06:00');
});

test('denverOffset flips across the same run, not once for it', () => {
  assert.equal(denverOffset('2026-03-07', '12:00'), '-07:00');
  assert.equal(denverOffset('2026-03-10', '12:00'), '-06:00');
  assert.equal(denverOffset('2026-10-15', '12:00'), '-06:00');
  assert.equal(denverOffset('2026-11-10', '12:00'), '-07:00');
});

// AC5: a date with no time has no instant. Midnight is not assumed.
test('startedAtUtc returns empty for a workout with no time', () => {
  assert.equal(startedAtUtc('2026-03-15', ''), '');
  assert.equal(startedAtUtc('2026-03-15', undefined), '');
});

test('startedAtUtc returns empty rather than guessing at junk', () => {
  assert.equal(startedAtUtc('', '09:00'), '');
  assert.equal(startedAtUtc('15 March', '09:00'), '');
  assert.equal(startedAtUtc('2026-03-15', '9am'), '');
});

test('startedAtUtc keeps the local wall clock the user logged', () => {
  // The point of Y is the instant; B and C stay local and must not move.
  assert.ok(startedAtUtc('2026-07-15', '21:00').startsWith('2026-07-15T21:00'));
});
