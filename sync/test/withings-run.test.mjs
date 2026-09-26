// #197 end to end: withings-run.mjs against a fake Withings, a fake token file
// and the in-memory Drive. AC1 lands the window, AC2 re-runs idempotently, AC3
// archives what it can and exits non-zero naming what failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withingsRun } from '../withings-run.mjs';
import { NOW, memoryDrive, memoryStore, scriptedFetch } from './helpers.mjs';
import {
  CLIENT_ID, CLIENT_SECRET, HOUR, getmeasPage, measureGroup, storedWithings, withingsStatus,
} from './withings-helpers.mjs';

const env = { WITHINGS_CLIENT_ID: CLIENT_ID, WITHINGS_CLIENT_SECRET: CLIENT_SECRET };

/** A fake Thrive API holding BodyMeasurements in memory, keyed by grpid (#198). */
function fakeBodyApi() {
  const tab = new Map();
  const calls = [];
  return {
    tab,
    calls,
    async upsertBodyMeasurements(rows, syncedAt) {
      calls.push({ rows, syncedAt });
      let appended = 0;
      let updated = 0;
      for (const row of rows) {
        if (tab.has(row.grpid)) updated += 1; else appended += 1;
        tab.set(row.grpid, { ...row, synced_at: syncedAt });
      }
      return { appended, updated, batches: rows.length ? 1 : 0 };
    },
  };
}
const retry = { delays: [1, 1], wait: async () => {} };
const D1 = Date.parse('2026-09-20T13:00:00Z') / 1000;
const D2 = Date.parse('2026-08-31T12:00:00Z') / 1000;

function harness(responses, { drive = memoryDrive(), api = fakeBodyApi() } = {}) {
  const store = memoryStore(storedWithings({ expiresInMs: 2 * HOUR }));
  const { fetchImpl, calls } = scriptedFetch(responses);
  const out = [];
  const err = [];
  const run = () => withingsRun({
    env,
    now: () => NOW,
    fetchImpl,
    retry,
    print: (l) => out.push(l),
    printError: (l) => err.push(l),
    deps: { createDrive: () => drive, createTokenStore: () => store, createApi: () => api },
  });
  return { drive, store, calls, out, err, run, api };
}

const jsonFiles = (drive) => [...drive.files.values()].filter((f) => f.mimeType !== 'folder');

test('a run fetches the window and lands one file per group, exiting 0', async () => {
  const h = harness([
    getmeasPage([measureGroup(1, D1)], { more: 1, offset: 1 }),
    getmeasPage([measureGroup(2, D2, [{ value: 120, type: 10, unit: 0 }, { value: 78, type: 9, unit: 0 }])]),
  ]);
  const res = await h.run();
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.counts, { seen: 2, created: 2, updated: 0, unchanged: 0, failed: 0 });
  assert.equal(h.calls[0].form.startdate, String(Date.parse('2026-08-25T06:00:00Z') / 1000));
  assert.equal(h.calls[0].form.enddate, String(Date.parse('2026-09-26T05:59:59Z') / 1000));
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer wt-access-0-xxxxxxxx');
  assert.deepEqual(jsonFiles(h.drive).map((f) => h.drive.pathOf(f.id)).sort(), [
    'Thrive Withings/measures/2026/08/2.json',
    'Thrive Withings/measures/2026/09/1.json',
  ]);
  assert.deepEqual(h.err, []);
});

test('the log carries counts, never a measurement', async () => {
  const h = harness([getmeasPage([measureGroup(1, D1, [{ value: 81234, type: 1, unit: -3 }])])]);
  await h.run();
  const log = [...h.out, ...h.err].join('\n');
  assert.match(log, /1 measure groups/);
  assert.doesNotMatch(log, /81234|81\.234/);
});

test('a second run over the same groups writes nothing; an edited one is rewritten in place', async () => {
  const drive = memoryDrive();
  const first = harness([getmeasPage([measureGroup(1, D1), measureGroup(2, D2)])], { drive });
  await first.run();
  const ids = jsonFiles(drive).map((f) => f.id).sort();
  const writes = drive.writes.length;

  const again = harness([getmeasPage([measureGroup(1, D1), measureGroup(2, D2)])], { drive });
  const res = await again.run();
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.counts, { seen: 2, created: 0, updated: 0, unchanged: 2, failed: 0 });
  assert.equal(drive.writes.length, writes);

  const edited = harness([getmeasPage([measureGroup(1, D1, [{ value: 1, type: 1, unit: 0 }]), measureGroup(2, D2)])], { drive });
  const res2 = await edited.run();
  assert.deepEqual(res2.counts, { seen: 2, created: 0, updated: 1, unchanged: 1, failed: 0 });
  assert.deepEqual(jsonFiles(drive).map((f) => f.id).sort(), ids);
});

test('a page that fails after retrying keeps earlier pages, archives nothing from the error, and exits 1 naming the class', async () => {
  const h = harness([
    getmeasPage([measureGroup(1, D1)], { more: 1, offset: 1 }),
    withingsStatus(2555, 'secret-ish error text'), withingsStatus(2555), withingsStatus(2555),
  ]);
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.equal(res.error.name, 'WithingsUnavailableError');
  assert.deepEqual(jsonFiles(h.drive).map((f) => f.data.grpid), ['1']);
  assert.ok(jsonFiles(h.drive).every((f) => !JSON.stringify(f.data).includes('error text')));
  assert.match(h.err.join('\n'), /WithingsUnavailableError/);
});

test('a refused access token exits 1 as WithingsGrantDeadError, writing nothing', async () => {
  const h = harness([withingsStatus(401)]);
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.equal(res.error.name, 'WithingsGrantDeadError');
  assert.equal(h.drive.writes.length, 0);
  assert.match(h.err.join('\n'), /WithingsGrantDeadError/);
});

test('a Drive write that fails for one group is logged with its grpid, the others still land, and the run exits 1', async () => {
  const drive = memoryDrive();
  const createJson = drive.createJson;
  drive.createJson = async (args) => {
    if (args.props.grpid === '2') throw new Error('Drive 500: backend error');
    return createJson(args);
  };
  const h = harness([getmeasPage([measureGroup(1, D1), measureGroup(2, D1), measureGroup(3, D2)])], { drive });
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.failed, ['2']);
  assert.deepEqual(res.counts, { seen: 3, created: 2, updated: 0, unchanged: 0, failed: 1 });
  assert.deepEqual(jsonFiles(drive).map((f) => f.data.grpid).sort(), ['1', '3']);
  assert.match(h.err.join('\n'), /group 2: Error: Drive 500/);
});

test('no token file ends the run before fetching, as WithingsGrantDeadError', async () => {
  const h = harness([]);
  h.store.tokens = null;
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.equal(res.error.name, 'WithingsGrantDeadError');
  assert.equal(h.calls.length, 0);
});

test('the window can be overridden for the backfill (#199)', async () => {
  const drive = memoryDrive();
  const store = memoryStore(storedWithings({ expiresInMs: 2 * HOUR }));
  const { fetchImpl, calls } = scriptedFetch([getmeasPage([])]);
  const res = await withingsRun({
    env, now: () => NOW, fetchImpl, retry, print: () => {}, printError: () => {},
    window: { startdate: 0, enddate: 100 },
    deps: { createDrive: () => drive, createTokenStore: () => store, createApi: () => fakeBodyApi() },
  });
  assert.equal(res.exitCode, 0);
  assert.equal(calls[0].form.startdate, '0');
  assert.equal(calls[0].form.enddate, '100');
});

// --- #198: the sheet write after the archive ---------------------------------

const scaleMeasures = [{ value: 81234, type: 1, unit: -3 }, { value: 18500, type: 6, unit: -3 }];
const bpMeasures = [{ value: 121, type: 10, unit: 0 }, { value: 78, type: 9, unit: 0 }, { value: 64, type: 11, unit: 0 }];

test('AC5: every archived group is normalized and upserted, with raw_ref its archive file', async () => {
  const h = harness([getmeasPage([measureGroup(1, D1, scaleMeasures), measureGroup(2, D2, bpMeasures)])]);
  const res = await h.run();
  assert.equal(res.exitCode, 0, h.err.join('\n'));
  assert.equal(h.api.calls.length, 1);
  assert.equal(h.api.calls[0].syncedAt, new Date(NOW).toISOString());
  const byGrpid = Object.fromEntries(h.api.calls[0].rows.map((r) => [r.grpid, r]));
  const fileOf = (grpid) => jsonFiles(h.drive).find((f) => f.data.grpid === grpid).id;
  assert.equal(byGrpid['1'].raw_ref, fileOf('1'));
  assert.equal(byGrpid['2'].raw_ref, fileOf('2'));
  assert.equal(byGrpid['1'].weight_kg, '81.234');
  assert.equal(byGrpid['1'].fat_ratio_pct, '18.5');
  assert.equal(byGrpid['2'].kind, 'bp');
  assert.deepEqual(res.sheet, { rows: 2, appended: 2, updated: 0, skipped: [], failed: [], notes: '', error: null });
  assert.match(h.out.join('\n'), /Sheet: 2 archived groups seen, 2 rows appended, 0 updated, 0 skipped as unattributed, 0 failed\./);
  assert.doesNotMatch([...h.out, ...h.err].join('\n'), /81\.234|81234/);
});

test('AC5: a second run over the same window updates, never appends', async () => {
  const drive = memoryDrive();
  const api = fakeBodyApi();
  const page = () => getmeasPage([measureGroup(1, D1, scaleMeasures), measureGroup(2, D2, bpMeasures)]);
  await harness([page()], { drive, api }).run();
  const res = await harness([page()], { drive, api }).run();
  assert.equal(res.exitCode, 0);
  assert.equal(res.sheet.appended, 0);
  assert.equal(res.sheet.updated, 2);
  assert.equal(api.tab.size, 2);
  assert.deepEqual(api.calls[1].rows, api.calls[0].rows, 'the same rows, re-derived from the archive');
});

test('AC3/AC5: a guest group is skipped into the notes, a malformed one fails alone, and the run exits 1', async () => {
  const h = harness([getmeasPage([
    measureGroup(1, D1, scaleMeasures),
    measureGroup(2, D1, scaleMeasures, { attrib: 1 }),
    measureGroup(3, D1, [{ value: 81.2, type: 1, unit: -3 }]),
    measureGroup(4, D2, bpMeasures),
  ])]);
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.deepEqual(h.api.calls[0].rows.map((r) => r.grpid), ['1', '4']);
  assert.deepEqual(res.sheet.skipped, [{ grpid: '2', attrib: '1' }]);
  assert.equal(res.sheet.notes, 'Skipped 1 unattributed Withings group(s): grpid 2 (attrib 1)');
  assert.deepEqual(res.sheet.failed.map((f) => [f.grpid, f.type]), [['3', 1]]);
  assert.match(h.err.join('\n'), /Could not normalize Withings group 3 type 1: value is not a non-negative integer/);
  assert.match(h.out.join('\n'), /grpid 2 \(attrib 1\)/);
  assert.match(h.out.join('\n'), /2 rows appended, 0 updated, 1 skipped as unattributed, 1 failed/);
  assert.deepEqual(res.counts, { seen: 4, created: 4, updated: 0, unchanged: 0, failed: 0 }, 'all four archived');
});

test('AC3: a skipped group alone is not a failure: the run exits 0', async () => {
  const h = harness([getmeasPage([measureGroup(1, D1, scaleMeasures), measureGroup(2, D1, scaleMeasures, { attrib: 1 })])]);
  const res = await h.run();
  assert.equal(res.exitCode, 0);
  assert.equal(res.sheet.skipped.length, 1);
});

test('AC5: a group whose archive write failed has no raw_ref and is not sent', async () => {
  const drive = memoryDrive();
  const createJson = drive.createJson;
  drive.createJson = async (args) => {
    if (args.props.grpid === '2') throw new Error('Drive 500: backend error');
    return createJson(args);
  };
  const h = harness([getmeasPage([measureGroup(1, D1), measureGroup(2, D1), measureGroup(3, D2)])], { drive });
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.deepEqual(h.api.calls[0].rows.map((r) => r.grpid), ['1', '3']);
  assert.ok(h.api.calls[0].rows.every((r) => r.raw_ref));
});

test('AC5: missing THRIVE_API_URL/KEY costs the sheet write, never the archive, and names both', async () => {
  const drive = memoryDrive();
  const store = memoryStore(storedWithings({ expiresInMs: 2 * HOUR }));
  const { fetchImpl } = scriptedFetch([getmeasPage([measureGroup(1, D1), measureGroup(2, D2, bpMeasures)])]);
  const out = [];
  const err = [];
  // The real createApi: env has no THRIVE_API_URL or THRIVE_API_KEY.
  const res = await withingsRun({
    env, now: () => NOW, fetchImpl, retry, print: (l) => out.push(l), printError: (l) => err.push(l),
    deps: { createDrive: () => drive, createTokenStore: () => store },
  });
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.counts, { seen: 2, created: 2, updated: 0, unchanged: 0, failed: 0 });
  assert.equal(jsonFiles(drive).length, 2, 'the archive landed');
  assert.equal(res.sheet.error.name, 'ThriveApiError');
  assert.match(err.join('\n'), /BodyMeasurements not written: ThriveApiError: config: THRIVE_API_URL and THRIVE_API_KEY not set/);
  // Archive first, then the failure.
  const archiveLine = out.findIndex((l) => l.startsWith('Archive:'));
  assert.ok(archiveLine >= 0);
});

test('AC5: an API refusal is reported, the archive stands, and the run exits 1', async () => {
  const api = {
    async upsertBodyMeasurements() { throw Object.assign(new Error('upsertBodyMeasurements: Sheet "BodyMeasurements" not found'), { name: 'ThriveApiError' }); },
  };
  const h = harness([getmeasPage([measureGroup(1, D1)])], { api });
  const res = await h.run();
  assert.equal(res.exitCode, 1);
  assert.equal(res.counts.created, 1);
  assert.match(h.err.join('\n'), /BodyMeasurements not written: ThriveApiError: .*not found/);
});

test('AC5: rows go through the real client in batches under the payload limit', async () => {
  const { createThriveApi, MAX_ENCODED_PAYLOAD } = await import('../src/thrive-api.mjs');
  const sent = [];
  const fetchImpl = async (url) => {
    const payload = new URL(url).searchParams.get('payload');
    assert.ok(encodeURIComponent(payload).length <= MAX_ENCODED_PAYLOAD);
    const body = JSON.parse(payload);
    sent.push(...body.rows);
    return { status: 200, text: async () => JSON.stringify({ success: true, data: { appended: body.rows.length, updated: 0 } }) };
  };
  const api = createThriveApi({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', fetchImpl });
  const groups = Array.from({ length: 40 }, (_, i) => measureGroup(1000 + i, D1 - i * 86400, scaleMeasures));
  const h = harness([getmeasPage(groups)], { api });
  const res = await h.run();
  assert.equal(res.exitCode, 0, h.err.join('\n'));
  assert.equal(sent.length, 40);
  assert.equal(res.sheet.appended, 40);
});
