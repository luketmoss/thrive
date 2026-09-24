// #165: the health bundle parses to nullable SI values, one row per local date.
// Every case starts from the archived bundle in ./fixtures (anonymised, format
// verbatim); a failure case changes one line of it and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAILY_FIELDS, durationSeconds, parseHealthBundle, SNAPSHOT_FIELDS } from '../src/normalize-health.mjs';

const bundle = () =>
  JSON.parse(readFileSync(new URL('./fixtures/health-2026-09-24.json', import.meta.url), 'utf8'));
const RAW = 'drive-file-health-1';
const parse = (b = bundle()) => parseHealthBundle(b, { rawRef: RAW });
const byDate = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]));

/** The bundle with one tool's text edited. Every call to that tool is edited. */
function edit(tool, fn, b = bundle()) {
  let hit = false;
  for (const call of b.calls) {
    if (call.tool !== tool) continue;
    const before = JSON.parse(call.payload);
    const after = fn(before);
    if (after !== before) hit = true;
    call.payload = JSON.stringify(after);
  }
  assert.ok(hit, `the edit to ${tool} changed nothing`);
  return b;
}
const replace = (tool, from, to, b) => edit(tool, (t) => t.replace(from, to), b);

// --- AC2 ---------------------------------------------------------------------

test('the fixture yields one row per date that has data, and none for silent dates', () => {
  const { rows, failures } = parse();
  assert.deepEqual(failures, []);
  assert.deepEqual(rows.map((r) => r.date), ['2026-09-22', '2026-09-23', '2026-09-24']);
});

test('a full night parses to SI values from the tools the spec names', () => {
  const day = byDate(parse().rows)['2026-09-23'];
  assert.deepEqual(day, {
    date: '2026-09-23',
    resting_hr: '57',        // queryRestingHeartRate, not the daily data header's 58
    hrv: '41',               // querySleepHrv's official average, not the raw series
    steps: '2617',           // "2,617"
    calories: '412',
    sleep_total_s: '26100',  // 7h 15min, awake time included
    sleep_deep_s: '3120',    // 52 min
    sleep_rem_s: '6180',     // 1h 43min
    sleep_light_s: '15720',  // 4h 22min
    sleep_awake_s: '1080',   // 18 min
    sleep_score: '84',
    training_load: '7',      // short-term load
    bed_time: '22:51',       // main sleep window, filed under the wake-up day
    wake_time: '06:06',
    raw_ref: RAW,
  });
});

test('sleep_total_s includes awake time: it is the sum of all four stages', () => {
  const d = byDate(parse().rows)['2026-09-23'];
  const stages = ['sleep_deep_s', 'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s'].reduce((s, f) => s + Number(d[f]), 0);
  assert.equal(Number(d.sleep_total_s), stages);
});

test('a value the payload does not carry is blank, never 0', () => {
  const d = byDate(parse().rows)['2026-09-22'];
  // Steps and calories were reported; no sleep, no resting HR ("No data"),
  // no HRV, no training load.
  assert.equal(d.steps, '412');
  assert.equal(d.calories, '38');
  for (const f of ['resting_hr', 'hrv', 'sleep_total_s', 'sleep_deep_s', 'sleep_rem_s', 'sleep_light_s',
    'sleep_awake_s', 'training_load', 'bed_time', 'wake_time']) {
    assert.equal(d[f], '', f);
  }
});

test('"Sleep Score: 0" for an unscored night is blank, not a score of 0', () => {
  const d = byDate(parse().rows)['2026-09-22'];
  assert.equal(d.sleep_score, '');
});

test('vo2max and recovery go on the run date alone; every other row omits them', () => {
  const rows = byDate(parse().rows);
  const D = rows['2026-09-24'];
  assert.equal(D.recovery, '87');
  assert.equal(D.vo2max, ''); // the fitness overview carries no VO2max yet
  assert.equal(D.training_load, '9');
  for (const date of ['2026-09-22', '2026-09-23']) {
    for (const f of SNAPSHOT_FIELDS) assert.equal(f in rows[date], false, `${date} ${f}`);
  }
});

test('a VO2max, when COROS has one, lands on the run date', () => {
  const b = replace('queryFitnessAssessmentOverview', 'Threshold Pace: 5:10 /km',
    'VO2max: 51\nThreshold Pace: 5:10 /km');
  assert.equal(byDate(parse(b).rows)['2026-09-24'].vo2max, '51');
});

test('every non-snapshot field is present on every row, so a stale value is cleared', () => {
  for (const row of parse().rows) {
    for (const f of DAILY_FIELDS) assert.ok(f in row, `${row.date} ${f}`);
  }
});

test('every value is a number, an HH:mm time or blank, as the API requires', () => {
  for (const row of parse().rows) {
    for (const [f, v] of Object.entries(row)) {
      if (f === 'date' || f === 'raw_ref') continue;
      if (f === 'bed_time' || f === 'wake_time') assert.match(v, /^(\d{2}:\d{2})?$/, f);
      else assert.match(v, /^(\d+(\.\d+)?)?$/, f);
    }
  }
});

test('dates outside D − 10 to D are ignored, including D + 1', () => {
  const b = replace('queryRestingHeartRate', '2026-09-23: 57 bpm',
    '2026-09-25: 61 bpm\n2026-09-23: 57 bpm\n2026-09-13: 60 bpm');
  const dates = parse(b).rows.map((r) => r.date);
  assert.deepEqual(dates, ['2026-09-22', '2026-09-23', '2026-09-24']);
});

test('a date for which every tool reported nothing produces no row', () => {
  const rows = byDate(parse().rows);
  for (const d of ['2026-09-14', '2026-09-18', '2026-09-21']) assert.equal(rows[d], undefined);
});

test('an added label COROS starts sending is ignored', () => {
  const b = replace('queryDailyHealthData', 'Stress: Avg 26', 'Stress: Avg 26\nBody Battery: 71 | Hydration: 1.2 L');
  const { rows, failures } = parse(b);
  assert.deepEqual(failures, []);
  assert.equal(byDate(rows)['2026-09-23'].steps, '2617');
});

test('durations: hours and minutes, minutes alone, hours alone', () => {
  const s = (v) => durationSeconds('t', v, v);
  assert.equal(s('7h 15min'), '26100');
  assert.equal(s('52 min'), '3120');
  assert.equal(s('0 min'), '0');
  assert.equal(s('7h'), '25200');
  assert.throws(() => s('7.25h'));
  assert.throws(() => s(''));
});

// --- AC3 ---------------------------------------------------------------------

/** The date fails with the tool and the line named; the other dates survive. */
function assertOnlyDateFails(b, date, tool, lineIncludes) {
  const { rows, failures } = parse(b);
  const dates = rows.map((r) => r.date);
  assert.equal(dates.includes(date), false, `${date} must not be written at all`);
  assert.ok(failures.length >= 1);
  for (const f of failures) {
    assert.equal(f.date, date);
    assert.equal(f.tool, tool);
    assert.ok(f.line.includes(lineIncludes), `line "${f.line}" should include "${lineIncludes}"`);
    assert.ok(f.message.includes(lineIncludes));
  }
  return dates;
}

test('an unknown unit fails that date alone', () => {
  const b = replace('queryDailyHealthData', 'Calories: 412 kcal', 'Calories: 1724 kJ');
  const dates = assertOnlyDateFails(b, '2026-09-23', 'queryDailyHealthData', 'Calories: 1724 kJ');
  assert.deepEqual(dates, ['2026-09-22', '2026-09-24']);
});

test('an unparseable duration fails that date', () => {
  const b = replace('queryDailyHealthData', 'Deep: 52 min', 'Deep: 52m 10s');
  assertOnlyDateFails(b, '2026-09-23', 'queryDailyHealthData', 'Deep: 52m 10s');
});

test('a changed label in the sleep summary fails that date rather than blanking it', () => {
  const b = replace('queryDailyHealthData', 'Total: 7h 15min', 'Time in Bed: 7h 15min');
  assertOnlyDateFails(b, '2026-09-23', 'queryDailyHealthData', 'Time in Bed');
});

test('a resting HR in an unknown unit fails that date', () => {
  const b = replace('queryRestingHeartRate', '2026-09-23: 57 bpm', '2026-09-23: 57 beats/min');
  assertOnlyDateFails(b, '2026-09-23', 'queryRestingHeartRate', '57 beats/min');
});

test('an HRV average in an unknown unit fails that date', () => {
  const b = replace('querySleepHrv', 'HRV Avg: 41 ms', 'HRV Avg: 0.041 s');
  assertOnlyDateFails(b, '2026-09-23', 'querySleepHrv', 'HRV Avg: 0.041 s');
});

test('a sleep window in a new shape fails its wake-up day', () => {
  const b = replace('querySleepOverview', 'Main Sleep Window: 2026-09-22 22:51 - 2026-09-23 06:06',
    'Main Sleep Window: 10:51 PM to 6:06 AM');
  assertOnlyDateFails(b, '2026-09-23', 'querySleepOverview', '10:51 PM');
});

test('a non-numeric training load fails that date', () => {
  const b = replace('queryTrainingLoadAssessment', 'Short-Term Load: 9', 'Short-Term Load: high');
  assertOnlyDateFails(b, '2026-09-24', 'queryTrainingLoadAssessment', 'Short-Term Load: high');
});

test('an unreadable recovery fails the run date, where it would have gone', () => {
  const b = replace('queryRecoveryStatus', 'Recovery: 87%', 'Recovery: good');
  const dates = assertOnlyDateFails(b, '2026-09-24', 'queryRecoveryStatus', 'Recovery: good');
  assert.deepEqual(dates, ['2026-09-22', '2026-09-23']);
});

test('a whole result in an unrecognized shape fails every date it covered', () => {
  const b = edit('querySleepOverview', () => 'Sleep Report (v2)\n\n[{"day":"2026-09-23","score":84}]');
  const { rows, failures } = parse(b);
  assert.deepEqual(rows, []);
  const dates = new Set(failures.map((f) => f.date));
  assert.equal(dates.size, 11); // D − 10 to D; D + 1 is outside the window
  assert.ok(failures.every((f) => f.tool === 'querySleepOverview' && f.line.includes('Sleep Report (v2)')));
});

test('a result with no dated entries must say it has no data', () => {
  const ok = edit('queryRestingHeartRate', () => 'Resting Heart Rate — Last 11 days\n========================\n\nNo data found.');
  assert.deepEqual(parse(ok).failures, []);
  const bad = edit('queryRestingHeartRate', () => 'Resting Heart Rate — Last 11 days\n========================\n\n23 Sept 57');
  assert.equal(parse(bad).rows.length, 0);
});

test('parsing never mutates the bundle', () => {
  const b = bundle();
  const before = JSON.stringify(b);
  parse(b);
  assert.equal(JSON.stringify(b), before);
});
