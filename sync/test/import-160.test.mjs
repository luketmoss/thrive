// #160 — scripts/import-160-garmin-wellness.mjs: Garmin export -> DailyHealth,
// blank where the export is silent, fill-only, nothing after 2026-09-19.
// Synthetic rows shaped like the export; never real data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDays, importWellness, mapSleep, mapUds, planImport } from '../../scripts/import-160-garmin-wellness.mjs';

const uds = (date, over = {}) => ({
  calendarDate: date, totalSteps: 5000, totalKilocalories: 2400.0, restingHeartRate: 48,
  wellnessStartTimeGmt: `${date}T07:00:00.0`, wellnessStartTimeLocal: `${date}T00:00:00.0`,
  allDayStress: { aggregatorList: [{ type: 'AWAKE', averageStressLevel: 99 }, { type: 'TOTAL', averageStressLevel: 31 }] },
  ...over,
});
const sleep = (date, over = {}) => ({
  calendarDate: date, sleepWindowConfirmationType: 'OFF_WRIST',
  sleepStartTimestampGMT: '2019-01-20T05:30:00.0', sleepEndTimestampGMT: '2019-01-20T13:00:00.0', ...over,
});
const OFF = -7 * 3600000;

test('AC1: steps, calories, resting HR and TOTAL stress map; nothing else is set', () => {
  assert.deepEqual(mapUds(uds('2019-01-20')), { resting_hr: '48', steps: '5000', calories: '2400', stress_avg: '31' });
});

test('AC2: a no-wear day (no steps, no resting HR) keeps steps, calories and HR blank', () => {
  const out = mapUds(uds('2019-01-20', { totalSteps: 0, restingHeartRate: undefined }));
  assert.deepEqual(out, { stress_avg: '31' });
  assert.equal('steps' in mapUds(uds('x', { totalSteps: undefined, restingHeartRate: undefined })), false);
});

test('AC2: zero steps with a resting HR is kept as 0; negative stress stays blank', () => {
  const out = mapUds(uds('2019-01-20', { totalSteps: 0 }));
  assert.equal(out.steps, '0');
  const s = mapUds(uds('2019-01-20', { allDayStress: { aggregatorList: [{ type: 'TOTAL', averageStressLevel: -2 }] } }));
  assert.equal('stress_avg' in s, false);
});

test('AC3: an unstaged night gets bed/wake in local time and the window as its total', () => {
  assert.deepEqual(mapSleep(sleep('2019-01-20'), OFF), {
    bed_time: '22:30', wake_time: '06:00', sleep_total_s: '27000',
  });
});

test('AC3: a staged night writes stages, REM only if present, total = stage sum', () => {
  const out = mapSleep(sleep('2019-01-20', { deepSleepSeconds: 3600, lightSleepSeconds: 20000, awakeSleepSeconds: 0 }), OFF);
  assert.equal(out.sleep_deep_s, '3600');
  assert.equal(out.sleep_awake_s, '0');
  assert.equal('sleep_rem_s' in out, false);
  assert.equal(out.sleep_total_s, '23600');
});

test('AC3: all-zero stages are not stage evidence; UNCONFIRMED sleeps nothing', () => {
  const z = mapSleep(sleep('d', { deepSleepSeconds: 0, lightSleepSeconds: 0, awakeSleepSeconds: 0 }), OFF);
  assert.deepEqual(Object.keys(z).sort(), ['bed_time', 'sleep_total_s', 'wake_time']);
  assert.deepEqual(mapSleep(sleep('d', { sleepWindowConfirmationType: 'UNCONFIRMED' }), OFF), {});
});

test('AC3: no UDS offset leaves bed/wake blank but keeps the total', () => {
  const out = mapSleep(sleep('d'), null);
  assert.deepEqual(Object.keys(out), ['sleep_total_s']);
});

test('AC1/AC4: out-of-range rows (the 2006 stray, after 2026-09-19) are skipped and reported', () => {
  const { days, skipped } = buildDays(
    [uds('2006-01-01'), uds('2017-06-30'), uds('2026-09-19'), uds('2026-09-20')], [],
  );
  assert.deepEqual([...days.keys()], ['2017-06-30', '2026-09-19']);
  assert.deepEqual(skipped, ['2006-01-01', '2026-09-20']);
});

test('AC4: fill-only — existing cells are kept, a full row is not rewritten', () => {
  const { days } = buildDays([uds('2019-01-20'), uds('2019-01-21')], []);
  const writes = planImport(days, [
    { date: '2019-01-20', steps: '1', resting_hr: '', calories: '', stress_avg: '' },
    { date: '2019-01-21', steps: '1', resting_hr: '2', calories: '3', stress_avg: '4' },
  ]);
  assert.deepEqual(writes, [{ date: '2019-01-20', resting_hr: '48', calories: '2400', stress_avg: '31' }]);
});

function fakes(rows = []) {
  const calls = [];
  return {
    calls,
    api: {
      async get() { return rows; },
      async upsertDailyHealth(chunk, at) { calls.push({ chunk, at }); return { appended: chunk.length }; },
    },
  };
}
const quiet = { log() {}, error() {}, wait: async () => {} };
const data = { uds: ['2019-01-20', '2019-01-21', '2019-01-22'].map((d) => uds(d)), sleep: [] };

test('AC4: dry-run writes nothing; capped and batched writes use one synced_at; a re-run finds nothing', async () => {
  const dry = fakes();
  assert.equal(await importWellness({ api: dry.api, exportData: data, dryRun: true, ...quiet }), 0);
  assert.equal(dry.calls.length, 0);

  const live = fakes();
  await importWellness({ api: live.api, exportData: data, maxRows: 2, batch: 1, now: () => 'T', ...quiet });
  assert.deepEqual(live.calls.map((c) => c.chunk.length), [1, 1]);
  assert.ok(live.calls.every((c) => c.at === 'T'));

  const again = fakes(data.uds.map((u) => ({ date: u.calendarDate, resting_hr: '48', steps: '5000', calories: '2400', stress_avg: '31' })));
  await importWellness({ api: again.api, exportData: data, ...quiet });
  assert.equal(again.calls.length, 0);
});

test('AC4: a failed batch reports how many landed and exits 1', async () => {
  const errors = [];
  const api = { async get() { return []; }, async upsertDailyHealth() { throw new Error('boom'); } };
  const code = await importWellness({ api, exportData: data, ...quiet, error: (m) => errors.push(m) });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /0 row\(s\) were written/);
});

test('AC5: the importer only ever uses getDailyHealth and upsertDailyHealth', async () => {
  const touched = [];
  const api = new Proxy({}, { get: (_, k) => (...a) => { touched.push(k); return k === 'get' ? Promise.resolve([]) : Promise.resolve({}); } });
  await importWellness({ api, exportData: data, ...quiet });
  assert.deepEqual([...new Set(touched)].sort(), ['get', 'upsertDailyHealth']);
});
