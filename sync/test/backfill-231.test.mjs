// #231 AC4 — scripts/backfill-231-daily-health-stress.mjs: fills stress_avg on
// existing DailyHealth rows from their archived bundles, one field only,
// capped per run, and reports by date every row it cannot fill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backfill, planBackfill } from '../../scripts/backfill-231-daily-health-stress.mjs';

const bundle = () =>
  JSON.parse(readFileSync(new URL('./fixtures/health-2026-09-24.json', import.meta.url), 'utf8'));

const T_OLD = '2026-09-24T13:25:32.000Z';
const T_NEW = '2026-09-30T13:00:00.000Z';

/** A DailyHealth row as getDailyHealth returns it after the deploy: every field, stress_avg included. */
const row = (date, over = {}) => ({
  date, resting_hr: '', hrv: '', steps: '1', calories: '', sleep_total_s: '', sleep_deep_s: '',
  sleep_rem_s: '', sleep_light_s: '', sleep_awake_s: '', sleep_score: '', vo2max: '', recovery: '',
  training_load: '', bed_time: '', wake_time: '', raw_ref: 'drive-a', synced_at: T_OLD, stress_avg: '', ...over,
});

function fakes(rows, files = { 'drive-a': bundle() }) {
  const writes = [];
  const reads = [];
  const api = {
    async get(action) {
      assert.equal(action, 'getDailyHealth');
      return rows;
    },
    async upsertDailyHealth(chunk, syncedAt) {
      writes.push({ chunk, syncedAt });
      return { appended: 0, updated: chunk.length, batches: 1 };
    },
  };
  const drive = {
    async readJson(id) {
      reads.push(id);
      if (!(id in files)) throw new Error(`Drive answered 404: File not found: ${id}`);
      return files[id];
    },
  };
  return { api, drive, writes, reads };
}

async function run(rows, opts = {}, files) {
  const f = fakes(rows, files);
  const out = [];
  const err = [];
  const code = await backfill({
    api: f.api, drive: f.drive, wait: async () => {}, now: () => T_NEW,
    log: (l) => out.push(l), error: (l) => err.push(l), ...opts,
  });
  return { ...f, code, out: out.join('\n'), err: err.join('\n') };
}

test('fills stress_avg from the row\'s own bundle, sending that field alone', async () => {
  const r = await run([row('2026-09-22'), row('2026-09-23'), row('2026-09-24')]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, [{
    chunk: [{ date: '2026-09-22', stress_avg: '31' }, { date: '2026-09-23', stress_avg: '26' }],
    syncedAt: T_OLD,
  }]);
  // 2026-09-24's block has no Stress line: left blank, never 0, and said so.
  assert.match(r.out, /no Stress line in the bundle \(left blank\): 1 — 2026-09-24/);
});

test('keeps each row\'s synced_at by sending it back unchanged, one call per value', async () => {
  const r = await run([
    row('2026-09-22', { synced_at: T_OLD }),
    row('2026-09-23', { synced_at: '2026-09-25T01:00:00.000Z' }),
  ]);
  assert.deepEqual(r.writes.map((w) => [w.syncedAt, w.chunk.map((c) => c.date)]), [
    [T_OLD, ['2026-09-22']],
    ['2026-09-25T01:00:00.000Z', ['2026-09-23']],
  ]);
});

test('a row with a blank synced_at is stamped with this run\'s time', async () => {
  const r = await run([row('2026-09-22', { synced_at: '' })]);
  assert.equal(r.writes[0].syncedAt, T_NEW);
});

test('leaves a row that already has a value alone, so a second run writes nothing', async () => {
  const r = await run([row('2026-09-22', { stress_avg: '31' }), row('2026-09-23', { stress_avg: '26' })]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.reads, []);
  assert.match(r.out, /already set: 2/);
  assert.match(r.out, /Nothing to write/);
});

test('--dry-run reads and plans but writes nothing', async () => {
  const r = await run([row('2026-09-22'), row('2026-09-23')], { dryRun: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /to fill: 2/);
  assert.match(r.out, /2026-09-22  stress_avg 31/);
  assert.match(r.out, /--dry-run: nothing written/);
});

test('caps the rows per run and batches the calls', async () => {
  const files = { 'drive-a': bundle() };
  // Six dates, each with its own bundle: the fixture's 2026-09-22 block re-dated.
  const rows = [];
  for (let d = 15; d <= 20; d++) {
    const date = `2026-09-${d}`;
    const b = bundle();
    for (const c of b.calls) c.payload = c.payload.replaceAll('20260922', date.replaceAll('-', ''));
    files[`drive-${d}`] = b;
    rows.push(row(date, { raw_ref: `drive-${d}` }));
  }
  const r = await run(rows, { maxRows: 5, batch: 2 }, files);
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes.map((w) => w.chunk.length), [2, 2, 1]);
  assert.match(r.out, /to fill: 6 \(5 this run, capped by --max-rows 5; 1 for a later run\)/);
  assert.match(r.out, /1 left: re-run to continue/);
});

test('reports, by date, every row it cannot fill, and guesses nothing', async () => {
  const broken = bundle();
  for (const c of broken.calls) {
    if (c.tool === 'queryDailyHealthData') c.payload = c.payload.replace('Stress: Avg 26', 'Stress: High');
  }
  const r = await run([
    row('2026-09-01', { raw_ref: '' }),
    row('2026-09-02', { raw_ref: 'gone' }),
    row('2026-09-03', { raw_ref: 'not-health' }),
    row('2026-09-23', { raw_ref: 'broken' }),
    row('2026-08-01', { raw_ref: 'drive-a' }), // outside the bundle's window
    row('2026-09-22', { raw_ref: 'drive-a' }),
  ], {}, { 'drive-a': bundle(), broken, 'not-health': { source: 'coros', activity_id: '1' } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.writes.map((w) => w.chunk), [[{ date: '2026-09-22', stress_avg: '31' }]]);
  assert.match(r.out, /NOT FILLED, needs a look: 5/);
  assert.match(r.out, /2026-08-01 {2}bundle drive-a \(run 2026-09-24, window 2026-09-14 on\) carries nothing for this date/);
  assert.match(r.out, /2026-09-01 {2}no raw_ref/);
  assert.match(r.out, /2026-09-02 {2}raw_ref gone is unreadable: Drive answered 404/);
  assert.match(r.out, /2026-09-03 {2}raw_ref not-health is not a health bundle/);
  assert.match(r.out, /2026-09-23 {2}bundle broken did not parse for this date: .*Stress: High/);
});

test('reads each bundle once, however many rows point at it', async () => {
  const r = await run([row('2026-09-22'), row('2026-09-23'), row('2026-09-24')]);
  assert.deepEqual(r.reads, ['drive-a']);
});

test('refuses to write before the API returns stress_avg', async () => {
  const old = row('2026-09-22');
  delete old.stress_avg;
  const r = await run([old]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.writes, []);
  assert.match(r.err, /REFUSING: getDailyHealth does not return stress_avg/);
});

test('stops at a failed write and says how many landed', async () => {
  const f = fakes([row('2026-09-22'), row('2026-09-23')]);
  f.api.upsertDailyHealth = async () => { throw new Error('upsertDailyHealth: boom'); };
  const err = [];
  const code = await backfill({ api: f.api, drive: f.drive, wait: async () => {}, log: () => {}, error: (l) => err.push(l) });
  assert.equal(code, 1);
  assert.match(err.join('\n'), /FAILED writing 2026-09-22, 2026-09-23: upsertDailyHealth: boom/);
  assert.match(err.join('\n'), /0 row\(s\) were written before it/);
});

test('planBackfill is read-only: it never writes', async () => {
  const plan = await planBackfill({ rows: [row('2026-09-23')], readBundle: async () => bundle() });
  assert.deepEqual(plan.fills, [{ date: '2026-09-23', stress_avg: '26', synced_at: T_OLD }]);
});
