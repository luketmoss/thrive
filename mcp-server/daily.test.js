// #158 — narration for thrive_daily_health and thrive_daily_summary, and the
// provenance lines on the workout tools. Pure; run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLANK, fmtHours, fmtCount, addDays, datesBetween, resolveRange, describeDateRuns,
  describeHealthDay, describeHealthRange, describeSummaryDay, describeSummaryRange,
} from './daily.js';
import {
  normalizeDate, provenanceOf, provenanceTag, typeLabel, describeSyncedFields,
} from './domain.js';

// --- fixtures, as the API returns them --------------------------------

const HEALTH_FIELDS = [
  'date', 'resting_hr', 'hrv', 'steps', 'calories', 'sleep_total_s', 'sleep_deep_s',
  'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s', 'sleep_score', 'vo2max', 'recovery',
  'training_load', 'bed_time', 'wake_time', 'raw_ref', 'synced_at',
];
const health = (o) => Object.fromEntries(HEALTH_FIELDS.map((f) => [f, o[f] ?? '']));

const fullDay = health({
  date: '2026-09-23', resting_hr: '57', hrv: '41', steps: '2617', calories: '412',
  sleep_total_s: '26100', sleep_deep_s: '3120', sleep_rem_s: '6180', sleep_light_s: '15720',
  sleep_awake_s: '1080', sleep_score: '84', vo2max: '48', recovery: '92', training_load: '7',
  bed_time: '22:51', wake_time: '06:06', raw_ref: 'drive-1', synced_at: '2026-09-24T13:25:32.000Z',
});

const SUMMARY_FIELDS = [
  'date', 'activity_count', 'activity_types', 'total_moving_s', 'total_elapsed_s',
  'total_distance_m', 'total_ascent_m', 'cardio_activity_count', 'distance_withdata',
  'ascent_withdata', 'max_effort', 'effort_counts', 'steps', 'resting_hr', 'hrv',
  'sleep_total_s', 'training_load', 'computed_at',
];
const summary = (o) => ({ ...Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, o[f] ?? ''])), sheetRow: 2 });

const WORKOUT_FIELDS = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes', 'elapsed_seconds', 'created',
  'copied_from', 'status', 'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref', 'fit_fetched_at',
  'synced_at', 'started_at_utc', 'calories',
];
const workout = (o) => Object.fromEntries(WORKOUT_FIELDS.map((f) => [f, o[f] ?? '']));

// --- units --------------------------------------------------------------

test('fmtHours renders seconds as h:mm and a blank as —, never 0:00', () => {
  assert.equal(fmtHours('26100'), '7:15');
  assert.equal(fmtHours('1080'), '0:18');
  assert.equal(fmtHours(''), BLANK);
  assert.equal(fmtHours('0'), '0:00'); // a real zero stays a zero
});

test('fmtCount groups thousands and keeps a blank blank', () => {
  assert.equal(fmtCount('8400'), '8,400');
  assert.equal(fmtCount(''), BLANK);
});

// --- date ranges ------------------------------------------------------

test('resolveRange defaults to the 7 days ending today', () => {
  assert.deepEqual(resolveRange({}, normalizeDate, '2026-09-24'), { from: '2026-09-18', to: '2026-09-24' });
});

test('resolveRange takes each end alone, and a date_to moves the default start', () => {
  assert.deepEqual(resolveRange({ date_to: '2026-03-01' }, normalizeDate, '2026-09-24'),
    { from: '2026-02-23', to: '2026-03-01' });
  assert.deepEqual(resolveRange({ date_from: '2026-09-01' }, normalizeDate, '2026-09-24'),
    { from: '2026-09-01', to: '2026-09-24' });
});

test('resolveRange refuses a reversed range and an unreadable date', () => {
  assert.throws(() => resolveRange({ date_from: '2026-09-10', date_to: '2026-09-01' }, normalizeDate),
    /date_from 2026-09-10 is after date_to 2026-09-01/);
  assert.throws(() => resolveRange({ date_from: 'someday' }, normalizeDate), /could not read date_from "someday"/);
});

test('date helpers cross month ends and DST', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(datesBetween('2026-11-01', '2026-11-03'), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(describeDateRuns(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05']),
    '2026-09-01 to 2026-09-03, 2026-09-05');
});

// --- AC2: daily health ------------------------------------------------

test('a full health day names every field in readable units', () => {
  assert.equal(
    describeHealthDay(fullDay),
    '- 2026-09-23: resting HR 57 bpm · HRV 41 ms · steps 2,617 · calories 412 kcal · ' +
      'sleep 7:15 [deep 0:52, REM 1:43, light 4:22, awake 0:18] · sleep score 84 · ' +
      'bed 22:51 → wake 06:06 · VO2max 48 · recovery 92% · training load 7',
  );
});

test('a sparse health day shows each blank as —, and no field as 0', () => {
  const line = describeHealthDay(health({ date: '2026-09-20', steps: '8400' }));
  assert.match(line, /steps 8,400/);
  assert.match(line, /resting HR — · HRV — /);
  assert.match(line, /sleep — \[deep —, REM —, light —, awake —\]/);
  assert.match(line, /VO2max — · recovery — · training load —$/);
  assert.doesNotMatch(line.replace('8,400', ''), /\b0\b/);
});

test('the health range names the days with no row, as runs', () => {
  const text = describeHealthRange([health({ date: '2026-09-20', steps: '1' }), fullDay],
    { from: '2026-09-18', to: '2026-09-24' });
  assert.match(text, /^Daily health, 2026-09-18 to 2026-09-24: 2 days with a row\./);
  assert.match(text, /unknown, never zero/);
  assert.match(text, /No DailyHealth row for 5 days: 2026-09-18 to 2026-09-19, 2026-09-21 to 2026-09-22, 2026-09-24\./);
  assert.match(text, /not a day of zeros/);
});

test('an empty health range says so rather than printing nothing', () => {
  const text = describeHealthRange([], { from: '2026-01-01', to: '2026-01-02' });
  assert.match(text, /0 days with a row/);
  assert.match(text, /No DailyHealth row for 2 days: 2026-01-01 to 2026-01-02/);
});

// --- AC3: daily summary ------------------------------------------------

test('a summary day carries outdoor totals with their coverage', () => {
  const line = describeSummaryDay(summary({
    date: '2026-09-16', activity_count: '3', activity_types: 'bike:gravel,bike:indoor,weight',
    total_moving_s: '5100', total_elapsed_s: '9000', total_distance_m: '19956', total_ascent_m: '457',
    cardio_activity_count: '1', distance_withdata: '1', ascent_withdata: '1',
    max_effort: 'Hard', effort_counts: 'Hard:1,Medium:2', steps: '8400', resting_hr: '57',
    hrv: '41', sleep_total_s: '26100', training_load: '7',
  }));
  assert.equal(
    line,
    '- 2026-09-16: 3 activities (bike:gravel, bike:indoor, weight) · moving 85 min · elapsed 150 min · ' +
      'outdoor distance 12.4 mi (measured on 1 of 1 outdoor cardio session) · ' +
      'outdoor ascent 1,500 ft (measured on 1 of 1 outdoor cardio session) · ' +
      'max effort Hard (Hard 1, Medium 2) · steps 8,400 · resting HR 57 bpm · HRV 41 ms · ' +
      'sleep 7:15 · training load 7',
  );
});

test('unmeasured outdoor sessions read as unknown, not as zero miles', () => {
  const line = describeSummaryDay(summary({
    date: '2026-09-17', activity_count: '2', activity_types: 'hike',
    total_distance_m: '0', total_ascent_m: '0', cardio_activity_count: '2',
    distance_withdata: '0', ascent_withdata: '0',
  }));
  assert.match(line, /outdoor distance — \(measured on 0 of 2 outdoor cardio sessions\)/);
  assert.match(line, /outdoor ascent — \(measured on 0 of 2/);
  assert.match(line, /max effort —/);
});

test('an indoor-only day and a health-only day say what they are', () => {
  assert.match(
    describeSummaryDay(summary({ date: '2026-09-18', activity_count: '1', activity_types: 'bike:indoor' })),
    /outdoor distance\/ascent: no outdoor cardio/,
  );
  const healthOnly = describeSummaryDay(summary({ date: '2026-09-19', steps: '3000' }));
  assert.match(healthOnly, /^- 2026-09-19: no activities logged · steps 3,000 · resting HR —/);
});

test('the summary range states the outdoor-only and derived caveats, oldest first', () => {
  const text = describeSummaryRange(
    [summary({ date: '2026-09-17', computed_at: '2026-09-18T09:00:00Z' }),
      summary({ date: '2026-09-16', computed_at: '2026-09-17T09:00:00Z' })],
    { from: '2026-09-16', to: '2026-09-18' },
  );
  assert.match(text, /OUTDOOR ONLY/);
  assert.match(text, /will not equal the sum of that day's activity distances/);
  assert.match(text, /the workouts are right/);
  assert.match(text, /"moving 0 min" on a day with activities means unrecorded/);
  assert.match(text, /Oldest row computed at 2026-09-17T09:00:00Z\./);
  assert.match(text, /No DailySummary row for 1 day: 2026-09-18\./);
  assert.ok(text.indexOf('- 2026-09-16') < text.indexOf('- 2026-09-17'));
});

// --- AC4: provenance on the workout tools ------------------------------

const synced = workout({
  id: 'w_s', date: '2026-09-24', time: '07:30', type: 'bike', sub_type: 'gravel', name: 'Gravel Bike',
  elapsed_seconds: '5400', moving_seconds: '5100', distance_m: '19956', calories: '640',
  source: 'coros', source_activity_id: '471166302945817201', raw_ref: 'raw-1',
  fit_ref: 'fit-1', fit_fetched_at: '2026-09-24T17:41:10.000Z', synced_at: '2026-09-24T17:41:10.000Z',
  started_at_utc: '2026-09-24T07:30:00-06:00',
});
const enriched = workout({
  id: 'w_e', type: 'weight', name: 'Upper Push', avg_hr: '88', calories: '310',
  source_activity_id: '471093115402967310', raw_ref: 'raw-2', synced_at: '2026-09-23T13:00:00.000Z',
});
const manual = workout({ id: 'w_m', type: 'hike', name: 'Hike', distance_m: '8000' });

test('provenance has three states, and a blank source is hand-logged', () => {
  assert.deepEqual([synced, enriched, manual].map(provenanceOf), ['synced', 'enriched', 'manual']);
  assert.deepEqual([synced, enriched, manual].map(provenanceTag), [' (COROS)', ' (enriched from COROS)', '']);
  assert.equal(typeLabel(synced), 'bike:gravel');
  assert.equal(typeLabel(manual), 'hike');
});

test('a synced workout reports moving time, calories, start, provenance and archive state', () => {
  assert.deepEqual(describeSyncedFields(synced), [
    '- Moving time: 85 min',
    '- Calories: 640 kcal',
    '- Started at: 2026-09-24T07:30:00-06:00',
    '- Provenance: synced from COROS (activity 471166302945817201, last synced 2026-09-24T17:41:10.000Z)',
    '- Raw vendor payload: archived in Drive (raw-1); its contents are not readable through this server',
    '- FIT file: archived in Drive (fit-1), fetched 2026-09-24T17:41:10.000Z',
  ]);
});

test('FIT status tells settled-without-a-file apart from not fetched yet', () => {
  const settled = describeSyncedFields({ ...synced, fit_ref: '', fit_fetched_at: '2026-09-24T18:00:00.000Z' });
  assert.ok(settled.includes('- FIT file: none, and none will be fetched (settled 2026-09-24T18:00:00.000Z)'));
  const pending = describeSyncedFields({ ...synced, fit_ref: '', fit_fetched_at: '' });
  assert.ok(pending.includes('- FIT file: not fetched yet'));
});

test('an enriched workout names its link and makes no FIT claim', () => {
  assert.deepEqual(describeSyncedFields(enriched), [
    '- Calories: 310 kcal',
    '- Provenance: hand-logged, enriched from COROS (activity 471093115402967310, last synced 2026-09-23T13:00:00.000Z)',
    '- Raw vendor payload: archived in Drive (raw-2); its contents are not readable through this server',
  ]);
});

test('a hand-logged workout omits every blank field rather than printing 0', () => {
  assert.deepEqual(describeSyncedFields(manual), ['- Provenance: hand-logged']);
});
