// #165: the run's sheet step. Reads the health bundle from the archive,
// upserts DailyHealth, then rebuilds the rollup once, last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createArchive } from '../src/archive.mjs';
import { writeSheet } from '../src/sheet.mjs';
import { memoryDrive } from './helpers.mjs';

const fixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/health-2026-09-24.json', import.meta.url), 'utf8'));
const WINDOW = { start: '2026-09-14', end: '2026-09-25', runDate: '2026-09-24' };
const SYNCED = '2026-09-24T13:25:32.000Z';

/** An archive holding the fixture bundle, landed the way ingest lands it. */
async function archiveWith(bundle = fixture()) {
  const drive = memoryDrive();
  const archive = createArchive(drive, { now: () => Date.parse(SYNCED) });
  const { fileId } = await archive.upsertHealth({ runDate: bundle.run_date, window: bundle.window, calls: bundle.calls });
  drive.writes.length = 0;
  return { drive, archive, fileId };
}

/** A fake Thrive API recording calls in order. */
function fakeApi({ upsertError, rollupError } = {}) {
  const calls = [];
  return {
    calls,
    async upsertDailyHealth(rows, syncedAt) {
      calls.push({ action: 'upsertDailyHealth', rows, syncedAt });
      if (upsertError) throw upsertError;
      return { appended: rows.length, updated: 0, batches: 2 };
    },
    async rebuildDailySummary(from, to, computedAt) {
      calls.push({ action: 'rebuildDailySummary', from, to, computedAt });
      if (rollupError) throw rollupError;
      return { written: 3, updated: 0, removed: 0 };
    },
  };
}

test('AC4: the rows carry the bundle\'s Drive file ID as raw_ref and the run\'s synced_at', async () => {
  const { archive, fileId } = await archiveWith();
  const api = fakeApi();
  const out = await writeSheet({ archive, api, window: WINDOW, syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(out.failures, []);
  const [upsert] = api.calls;
  assert.equal(upsert.action, 'upsertDailyHealth');
  assert.equal(upsert.syncedAt, SYNCED);
  assert.deepEqual(upsert.rows.map((r) => r.date), ['2026-09-22', '2026-09-23', '2026-09-24']);
  assert.ok(upsert.rows.every((r) => r.raw_ref === fileId));
});

test('AC5: the rollup runs once, after every sheet write, over D − 10 to D', async () => {
  const { archive } = await archiveWith();
  const api = fakeApi();
  await writeSheet({ archive, api, window: WINDOW, syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(api.calls.map((c) => c.action), ['upsertDailyHealth', 'rebuildDailySummary']);
  const rollup = api.calls[1];
  assert.deepEqual([rollup.from, rollup.to, rollup.computedAt], ['2026-09-14', '2026-09-24', SYNCED]);
});

test('AC5: a failed upsert is reported, and the rollup still runs once', async () => {
  const { archive } = await archiveWith();
  const api = fakeApi({ upsertError: new Error('upsertDailyHealth: boom') });
  const out = await writeSheet({ archive, api, window: WINDOW, syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(api.calls.map((c) => c.action), ['upsertDailyHealth', 'rebuildDailySummary']);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /boom/);
});

test('a failed rollup is reported, not thrown', async () => {
  const { archive } = await archiveWith();
  const out = await writeSheet({
    archive, api: fakeApi({ rollupError: new Error('rebuildDailySummary: timeout') }),
    window: WINDOW, syncedAt: SYNCED, log: () => {},
  });
  assert.match(out.failures[0], /DailySummary rebuild: rebuildDailySummary: timeout/);
});

test('AC3: an unrecognized line skips that date, logs date, tool and line, and leaves the archive untouched', async () => {
  const bundle = fixture();
  const call = bundle.calls.find((c) => c.tool === 'queryDailyHealthData');
  call.payload = JSON.stringify(JSON.parse(call.payload).replace('Calories: 412 kcal', 'Calories: 1724 kJ'));
  const { drive, archive } = await archiveWith(bundle);
  const before = JSON.stringify([...drive.files.values()]);

  const api = fakeApi();
  const lines = [];
  const out = await writeSheet({ archive, api, window: WINDOW, syncedAt: SYNCED, log: (l) => lines.push(l) });

  assert.deepEqual(api.calls[0].rows.map((r) => r.date), ['2026-09-22', '2026-09-24'], 'the other dates are written');
  assert.equal(out.failures.length, 1, 'the run reports a failure, so it exits non-zero');
  const logged = lines.find((l) => l.startsWith('  FAILED'));
  assert.match(logged, /2026-09-23/);
  assert.match(logged, /queryDailyHealthData/);
  assert.match(logged, /Calories: 1724 kJ/);
  assert.deepEqual(drive.writes, [], 'nothing written to Drive');
  assert.equal(JSON.stringify([...drive.files.values()]), before);
});

test('no bundle in the archive is a failure, and the rollup still runs', async () => {
  const archive = createArchive(memoryDrive());
  const api = fakeApi();
  const out = await writeSheet({ archive, api, window: WINDOW, syncedAt: SYNCED, log: () => {} });
  assert.deepEqual(api.calls.map((c) => c.action), ['rebuildDailySummary']);
  assert.match(out.failures[0], /no bundle in the archive/);
});
