// Pure-function tests for the domain layer. No sheet access — run with:
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDate, normalizeRangeToMax, groupTemplateRows, todayStr,
  slotKey, groupSetsByExercise, findSetSlots, secondsToMinutes, workoutRowValues, metersToMiles, metersToFeet,
  parseDurationMinutes, findUnknownFields, findStaleExerciseNames,
  formatWeight, describeLoad, isSetLogged, buildSchedulePlan,
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

test('groupTemplateRows groups by template and sorts exercises by order', () => {
  const rows = [
    { template_id: 't2', template_name: 'Pull', order: 2, exercise_name: 'Row' },
    { template_id: 't1', template_name: 'Push', order: 2, exercise_name: 'Fly' },
    { template_id: 't1', template_name: 'Push', order: 1, exercise_name: 'Bench' },
    { template_id: 't2', template_name: 'Pull', order: 1, exercise_name: 'Pullup' },
  ];
  const grouped = groupTemplateRows(rows);

  // Templates come back alphabetically by name.
  assert.deepEqual(grouped.map((t) => t.name), ['Pull', 'Push']);
  assert.deepEqual(grouped[0].exercises.map((e) => e.exercise_name), ['Pullup', 'Row']);
  assert.deepEqual(grouped[1].exercises.map((e) => e.exercise_name), ['Bench', 'Fly']);
});

// --- set slots ------------------------------------------------------
// The same exercise can appear in two sections of one workout (a warmup and a
// primary of the same lift). Those are separate slots with separate set
// numbering — matching on exercise_id alone made "primary set 1" resolve to
// the warmup row and overwrite it.

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

test('findSetSlots returns every slot when nothing narrows it', () => {
  const slots = findSetSlots(slotSets, { workout_id: 'w1', exercise_id: 'ex_ohp' });
  assert.equal(slots.length, 2);
});

test('findSetSlots narrows by section', () => {
  const slots = findSetSlots(slotSets, { workout_id: 'w1', exercise_id: 'ex_ohp', section: 'primary' });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].sets.length, 3);
  assert.equal(slots[0].sets[0].set_number, 1);
});

test('findSetSlots narrows by exercise_order', () => {
  const slots = findSetSlots(slotSets, { workout_id: 'w1', exercise_id: 'ex_ohp', exercise_order: 1 });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].section, 'warmup');
});

test('findSetSlots stays inside the given workout', () => {
  const slots = findSetSlots(slotSets, { workout_id: 'w2', exercise_id: 'ex_ohp' });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].sets.length, 1);
});

test('findSetSlots returns nothing for a section the exercise is not in', () => {
  assert.equal(
    findSetSlots(slotSets, { workout_id: 'w1', exercise_id: 'ex_ohp', section: 'cooldown' }).length,
    0,
  );
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

// --- #102: session effort is independent of set effort --------------

test('a workout row carries session effort in column M', () => {
  const w = {
    id: 'w1', date: '2026-03-15', time: '07:00', type: 'weight', name: 'Push',
    template_id: '', notes: '', elapsed_seconds: '3720', created: '', copied_from: '',
    status: '', moving_seconds: '', effort: 'Hard', distance_m: '', ascent_m: '',
    descent_m: '', avg_hr: '',
  };
  const row = workoutRowValues(w);
  assert.equal(row.length, 17);
  assert.equal(row[12], 'Hard', 'effort belongs in column M');
});

test('an unset session effort writes an empty cell, never a default', () => {
  const w = {
    id: 'w1', date: '2026-03-15', time: '07:00', type: 'weight', name: 'Push',
    template_id: '', notes: '', elapsed_seconds: '', created: '', copied_from: '',
    status: '', moving_seconds: '', effort: '', distance_m: '', ascent_m: '',
    descent_m: '', avg_hr: '',
  };
  assert.equal(workoutRowValues(w)[12], '');
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

test('a workout row carries cardio attributes in columns N-Q', () => {
  const w = {
    id: 'w1', date: '2026-03-15', time: '07:00', type: 'bike', name: 'Ride',
    template_id: '', notes: '', elapsed_seconds: '6180', created: '', copied_from: '',
    status: '', moving_seconds: '', effort: '', distance_m: '19956', ascent_m: '457',
    descent_m: '', avg_hr: '136',
  };
  const row = workoutRowValues(w);
  assert.equal(row[13], '19956', 'distance belongs in column N');
  assert.equal(row[14], '457', 'ascent belongs in column O');
  assert.equal(row[15], '', 'descent stays empty');
  assert.equal(row[16], '136', 'avg HR belongs in column Q');
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
