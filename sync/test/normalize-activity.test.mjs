// #166 AC1/AC2: sport code -> type and sub_type, and the detail prose parsed
// strictly into local times and nullable SI measures.
//
// The fixtures in ./fixtures/activities are the four test activities archived
// on 24 Sept 2026 (a gravel ride, an outdoor walk, a hike and an indoor ride),
// **anonymised** the way #165's are: COROS's text format kept exactly, every
// measured value, clock time, vendor ID, coordinate and place name a fake,
// hashes and list entries re-derived so each file is internally consistent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sha256 } from '../src/archive.mjs';
import { localDateTime } from '../src/dates.mjs';
import {
  ActivityFormatError, ACTIVITY_FIELDS, durationSeconds, normalizeActivity, parseActivityDetail, walkVenue,
} from '../src/normalize-activity.mjs';
import { classifySport } from '../src/sport-codes.mjs';

const DIR = new URL('./fixtures/activities/', import.meta.url);
const load = (prefix) => {
  const name = readdirSync(DIR).find((n) => n.startsWith(prefix));
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
};
const legacy = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const gravel = load('activity-gravel-bike-');
const walk = load('activity-walk-');
const hike = load('activity-hike-');
const indoor = load('activity-indoor-cycling-');
const gym = legacy('activity-gym-cardio-471093826615208843.json');

const normalize = (file) => normalizeActivity(file, classifySport(file.args.sportType));

/** The same file with its detail text edited. */
const withDetail = (file, from, to) => {
  const text = JSON.parse(file.payload);
  assert.ok(text.includes(from), `fixture has ${from}`);
  return { ...file, payload: JSON.stringify(text.replace(from, to)) };
};

// --- AC1 -------------------------------------------------------------------

test('AC1: the mapping table, terrain from the code, plain 200 blank', () => {
  const cases = [
    [100, 'run', 'outdoor'], [101, 'run', 'indoor'], [102, 'run', 'outdoor'], [103, 'run', 'outdoor'],
    [104, 'hike', ''],
    [200, 'bike', ''], [201, 'bike', 'indoor'], [202, 'bike', ''], [203, 'bike', 'gravel'],
    [204, 'bike', 'mountain'], [205, 'bike', 'mountain'], [299, 'bike', ''],
  ];
  for (const [code, type, sub] of cases) {
    assert.deepEqual(classifySport(code), { kind: 'mapped', type, sub_type: sub }, String(code));
  }
});

test('AC1: strength is its own case, not unmapped; everything else unlisted is unmapped', () => {
  assert.deepEqual(classifySport(402), { kind: 'strength' });
  for (const code of [400, 401, 700, 701, 9800, 9900, 9999, 10000, 0, undefined, 'x']) {
    assert.deepEqual(classifySport(code), { kind: 'unmapped' }, String(code));
  }
});

test('#194 AC1/AC2: Hybrid Fitness is strength, flagged so its Workout Time is not moving time', () => {
  assert.deepEqual(classifySport(1200), { kind: 'strength', workoutTimeIncludesRests: true });
  assert.deepEqual(classifySport('1200'), { kind: 'strength', workoutTimeIncludesRests: true });
});

test('AC1: a walk is outdoor with a GPS track, indoor without, blank when nothing says', () => {
  assert.equal(normalize(walk).sub_type, 'outdoor');
  const noTrack = {
    ...walk,
    list_entry: { ...walk.list_entry, text: walk.list_entry.text.replace(/\n\s*Start Coordinates:[^\n]*/, '') },
  };
  assert.equal(normalize(noTrack).sub_type, 'indoor');
  assert.equal(walkVenue({ ...walk.list_entry, text: undefined }), '');
  // The indoor ride's entry shows what "no track" looks like: a Location that
  // echoes the sport name, and no coordinates.
  assert.match(indoor.list_entry.text, /Location: Indoor Bike/);
  assert.equal(walkVenue(indoor.list_entry), 'indoor');
});

// --- AC2 -------------------------------------------------------------------

test('AC2: the fixtures are internally consistent', () => {
  for (const f of [gravel, walk, hike, indoor]) {
    assert.equal(sha256(f.payload), f.payload_hash, f.activity_id);
    assert.equal(f.list_entry.activityId, f.activity_id);
    assert.equal(f.args.labelId, f.activity_id);
    assert.equal(f.args.sportType, f.list_entry.sportType);
  }
});

test('AC2: the gravel ride', () => {
  assert.deepEqual(normalize(gravel), {
    date: '2026-09-24', time: '11:02', type: 'bike', sub_type: 'gravel', name: 'Gravel Bike',
    elapsed_seconds: '378', moving_seconds: '378', distance_m: '520', ascent_m: '3', descent_m: '',
    avg_hr: '84', calories: '17', started_at_utc: '2026-09-24T11:02:17-06:00',
  });
});

test('AC2: the indoor ride has no ascent and no distance, never 0', () => {
  const n = normalize(indoor);
  assert.equal(n.type, 'bike');
  assert.equal(n.sub_type, 'indoor');
  assert.equal(n.ascent_m, '', 'a trainer\'s "0 m" is not written');
  assert.equal(n.distance_m, '', 'the payload has no Distance line');
  assert.equal(n.descent_m, '');
  assert.equal(n.elapsed_seconds, '97');
  assert.equal(n.avg_hr, '79');
});

test('AC2: the walk, whose payload has no Total Time, takes elapsed from the list timestamps', () => {
  const n = normalize(walk);
  assert.equal(n.type, 'walk');
  assert.equal(n.moving_seconds, '281');
  assert.equal(n.elapsed_seconds, String(walk.list_entry.endTimestamp - walk.list_entry.startTimestamp));
  assert.equal(n.distance_m, '360');
  assert.equal(n.ascent_m, '', 'no elevation line: blank');
  assert.equal(n.descent_m, '');
});

test('AC2: the hike is type hike and is the only one that gets descent', () => {
  const n = normalize(hike);
  assert.deepEqual([n.type, n.sub_type, n.ascent_m, n.descent_m], ['hike', '', '4', '1']);
  assert.equal(normalize(gravel).descent_m, '', 'a ride\'s loss is not written');
});

test('AC2: every field is present, and each is a whole number, a known string, or blank', () => {
  for (const f of [gravel, walk, hike, indoor]) {
    const n = normalize(f);
    assert.deepEqual(Object.keys(n), ACTIVITY_FIELDS);
    for (const k of ['elapsed_seconds', 'moving_seconds', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr', 'calories']) {
      assert.match(n[k], /^(\d+)?$/, `${f.activity_id} ${k}`);
    }
  }
});

test('AC2: Total Time is elapsed and Workout Time is moving, where they differ', () => {
  // The gym cardio session paused: Workout Time 41:12, Total Time 42:05, and
  // Total Time is exactly its list entry's end − start.
  const d = parseActivityDetail(gym.payload);
  assert.equal(d.workout, 41 * 60 + 12);
  assert.equal(d.total, 42 * 60 + 5);
  assert.equal(d.total, gym.list_entry.endTimestamp - gym.list_entry.startTimestamp);
});

test('AC2: local date, time and started_at_utc carry the offset in effect', () => {
  assert.deepEqual(localDateTime(Date.parse('2026-09-19T20:03:00Z')),
    { date: '2026-09-19', time: '14:03', iso: '2026-09-19T14:03:00-06:00' });
  // MST in January, and a late-evening start that is already tomorrow in UTC.
  assert.deepEqual(localDateTime(Date.parse('2027-01-16T04:30:05Z')),
    { date: '2027-01-15', time: '21:30', iso: '2027-01-15T21:30:05-07:00' });
});

test('AC2: durations read m:ss and mm:ss, and h:mm:ss defensively (unconfirmed)', () => {
  assert.equal(durationSeconds('', '5:43'), 343);
  assert.equal(durationSeconds('', '41:12'), 2472);
  assert.equal(durationSeconds('', '1:15:30'), 4530);
  assert.equal(durationSeconds('', '75:30'), 4530);
  for (const bad of ['5:3', '1h 15min', '1:75:00', '', '--']) {
    assert.throws(() => durationSeconds('', bad), ActivityFormatError, bad);
  }
});

test('AC2: a recognized label with an unrecognized value or unit is a failure naming the line', () => {
  const cases = [
    ['Distance: 0.52 km', 'Distance: 0.32 mi'],
    ['Average Heart Rate: 84 bpm', 'Average Heart Rate: -- bpm'],
    ['Calories: 17 kcal', 'Calories: 71 kJ'],
    ['Elevation Gain / Loss: 3 m / 3 m', 'Elevation Gain / Loss: 10 ft / 10 ft'],
    ['Workout Time: 6:18', 'Workout Time: 6m 18s'],
  ];
  for (const [from, to] of cases) {
    assert.throws(() => normalize(withDetail(gravel, from, to)), (err) => {
      assert.ok(err instanceof ActivityFormatError);
      assert.equal(err.line, to);
      return true;
    }, to);
  }
});

test('AC2: a label that appears twice is a failure, not a guess between them', () => {
  assert.throws(
    () => normalize(withDetail(gravel, 'Calories: 17 kcal', 'Calories: 17 kcal\nCalories: 18 kcal')),
    /appears twice/,
  );
});

test('AC2: no start time, or no duration, is a failure', () => {
  assert.throws(() => normalize({ ...gravel, list_entry: { ...gravel.list_entry, startTimestamp: null } }), /no start time/);
  const noDuration = withDetail(withDetail(gravel, 'Workout Time: 6:18\n', ''), 'Total Time: 6:18\n', '');
  assert.throws(() => normalize(noDuration), /no duration/);
});

test('AC2: an unknown label is ignored, so COROS adding a line is harmless', () => {
  const extra = withDetail(gravel, 'Max Speed: 8.1 km/h', 'Max Speed: 8.1 km/h\nNormalized Power: 180 W');
  assert.deepEqual(normalize(extra), normalize(gravel));
});
