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
const retry = { delays: [1, 1], wait: async () => {} };
const D1 = Date.parse('2026-09-20T13:00:00Z') / 1000;
const D2 = Date.parse('2026-08-31T12:00:00Z') / 1000;

function harness(responses, { drive = memoryDrive() } = {}) {
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
    deps: { createDrive: () => drive, createTokenStore: () => store },
  });
  return { drive, store, calls, out, err, run };
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
    deps: { createDrive: () => drive, createTokenStore: () => store },
  });
  assert.equal(res.exitCode, 0);
  assert.equal(calls[0].form.startdate, '0');
  assert.equal(calls[0].form.enddate, '100');
});
