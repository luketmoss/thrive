// #154: FIT files within COROS's allowance. The budget is summed from SyncLog
// over a rolling 24 hours, a FIT is requested once and stored as it came, one
// that keeps failing stops costing budget, and no FIT URL is ever handled.
//
// Every FIT here is synthetic bytes built below. A real FIT carries GPS
// coordinates, so none is committed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createArchive } from '../src/archive.mjs';
import {
  checkFit, createFitStep, fitBudget, fitCrc, fitFromResult, FitFormatError, FIT_TOOL,
} from '../src/fit.mjs';
import { redact } from '../src/redact.mjs';
import { syncActivities } from '../src/sync-activities.mjs';
import { memoryDrive } from './helpers.mjs';

const START = '2026-09-24T17:41:10.000Z';
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.parse(START) - ms).toISOString();

// --- synthetic FITs ---------------------------------------------------------

/** A FIT file around `data`: a 14-byte header with its CRC, then the file CRC. */
function makeFit(data = Buffer.from('synthetic record bytes, not a real activity')) {
  const header = Buffer.alloc(14);
  header[0] = 14;
  header[1] = 0x20;
  header.writeUInt16LE(2132, 2);
  header.writeUInt32LE(data.length, 4);
  header.write('.FIT', 8, 'latin1');
  header.writeUInt16LE(fitCrc(header.subarray(0, 12)), 12);
  const body = Buffer.concat([header, data]);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(fitCrc(body));
  return Buffer.concat([body, crc]);
}

/** A downloadActivityFitFiles result, shaped as the live tool answers (#154). */
const fitResult = (activityId, bytes = makeFit()) => ({
  content: [
    { type: 'text', text: 'Returned raw FIT file(s). If the client can parse FIT files, use them.' },
    {
      type: 'resource',
      resource: {
        uri: `coros://activity-fit-files/${activityId}.fit`,
        mimeType: 'application/octet-stream',
        blob: bytes.toString('base64'),
      },
    },
  ],
  isError: false,
});

test('the CRC is the FIT SDK\'s CRC-16: the standard check value for "123456789" is 0xBB3D', () => {
  assert.equal(fitCrc(Buffer.from('123456789', 'latin1')), 0xbb3d);
});

test('AC1: a whole FIT passes, and so does a chained one', () => {
  checkFit(makeFit());
  checkFit(Buffer.concat([makeFit(), makeFit(Buffer.from('second'))]));
});

test('AC4: a truncated, garbled or non-FIT file is refused', () => {
  const good = makeFit();
  const cases = {
    truncated: good.subarray(0, good.length - 5),
    'bad CRC': Buffer.concat([good.subarray(0, 20), Buffer.from([good[20] ^ 0xff]), good.subarray(21)]),
    'not FIT': Buffer.from('<html>Sorry, unable to open the file</html>'),
    empty: Buffer.alloc(0),
    'trailing junk': Buffer.concat([good, Buffer.from([1, 2, 3])]),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    assert.throws(() => checkFit(bytes), FitFormatError, name);
  }
});

test('AC1: the one resource named for the activity is taken, and the text is ignored', () => {
  const bytes = makeFit();
  assert.deepEqual(fitFromResult(fitResult('42', bytes), '42'), bytes);
  assert.throws(() => fitFromResult(fitResult('43'), '42'), /different activity/);
  assert.throws(() => fitFromResult({ content: [{ type: 'text', text: 'none' }] }, '42'), /returned 0 FIT files/);
  const two = fitResult('42');
  two.content.push(two.content[1]);
  assert.throws(() => fitFromResult(two, '42'), /returned 2 FIT files/);
  assert.throws(() => fitFromResult({ ...fitResult('42'), isError: true }, '42'), /error result/);
});

// --- the budget ---------------------------------------------------------------

const row = (startedAt, n, runId = `r-${startedAt}`) => ({ run_id: runId, started_at: startedAt, n_fit_fetched: String(n) });

test('AC2: the budget is 50 minus what SyncLog rows of the last 24 hours fetched', () => {
  const rows = [row(ago(1 * HOUR), 3), row(ago(24 * HOUR - 60000), 5), row(ago(24 * HOUR), 40), row(ago(30 * HOUR), 40)];
  assert.deepEqual(fitBudget(rows, START), { known: true, used: 8, remaining: 42 });
});

test('AC2: it is a rolling 24 hours, not a calendar day: 30 fetched at 22:00 still count at 06:00', () => {
  const evening = '2026-09-24T04:00:00.000Z'; // 22:00 MDT on the 23rd
  const morning = '2026-09-24T12:00:00.000Z'; // 06:00 MDT on the 24th
  assert.equal(fitBudget([row(evening, 30)], morning).remaining, 20);
});

test('AC2: never below 0, and a row whose start cannot be read is counted', () => {
  assert.equal(fitBudget([row(ago(HOUR), 60)], START).remaining, 0);
  assert.equal(fitBudget([row('not a date', 7)], START).remaining, 43);
});

test('AC2: the budget is unknown when SyncLog may hold more rows than were read, or a count is bad', () => {
  const full = Array.from({ length: 100 }, (_, i) => row(ago(i * 60000), 0));
  assert.equal(fitBudget(full, START).known, false);
  const partlyOld = [...full.slice(0, 99), row(ago(25 * HOUR), 0)];
  assert.equal(fitBudget(partlyOld, START).known, true);
  assert.equal(fitBudget([row(ago(HOUR), 'x')], START).known, false);
});

// --- the step, through syncActivities ------------------------------------------

const DIR = new URL('./fixtures/activities/', import.meta.url);
const FIXTURES = readdirSync(DIR).filter((n) => n.endsWith('.json'))
  .map((n) => JSON.parse(readFileSync(new URL(n, DIR), 'utf8')));
const legacy = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const GYM = legacy('activity-gym-cardio-471093826615208843.json');
const STRENGTH = legacy('activity-strength-471093115402967310.json');
const ALL = [...FIXTURES, GYM, STRENGTH];
const MAPPED = [...FIXTURES].sort((a, b) => a.list_entry.startTimestamp - b.list_entry.startTimestamp);
const ids = (files) => files.map((f) => f.activity_id);

async function archiveWith(files) {
  const drive = memoryDrive();
  const archive = createArchive(drive, { now: () => Date.parse(START) });
  for (const f of files) {
    await archive.upsertActivity({
      activityId: f.activity_id, localDate: f.list_entry.date, tool: f.tool, args: f.args,
      listEntry: f.list_entry, payload: f.payload,
    });
  }
  drive.writes.length = 0;
  return { drive, archive };
}

/** Workouts and SyncLog, as far as the FIT step needs them. */
function fakeApi({ syncLog = [], syncLogError = null } = {}) {
  const calls = [];
  const rows = new Map();
  let seq = 0;
  return {
    calls,
    rows,
    async getSyncLog(limit) {
      calls.push({ action: 'getSyncLog', limit });
      if (syncLogError) throw syncLogError;
      return syncLog;
    },
    async upsertSyncedWorkout(payload) {
      calls.push({ action: 'upsertSyncedWorkout', ...payload });
      const row = rows.get(payload.source_activity_id);
      const id = row?.id ?? `w_${++seq}`;
      rows.set(payload.source_activity_id, { id, fit_ref: payload.fit_ref, fit_fetched_at: payload.fit_fetched_at });
      return { status: row ? 'updated' : 'created', id, written: { ...payload.incoming, edited: [] }, kept: [] };
    },
  };
}

/** A COROS client that serves downloadActivityFitFiles, or fails it. */
function fakeCoros(handler = (args) => fitResult(args.labelId)) {
  const calls = [];
  return {
    calls,
    async callTool({ name, arguments: args }) {
      calls.push({ name, args });
      if (name !== FIT_TOOL) throw new Error(`unexpected tool ${name}`);
      const res = handler(args, calls.length);
      if (res instanceof Error) throw res;
      return res;
    },
  };
}

async function runOnce({ archive, api, client, startedAt = START, activityIds = ids(ALL), budgetOverride } = {}) {
  const lines = [];
  const fit = createFitStep({ client, archive, api, startedAt, log: (l) => lines.push(l), budgetOverride });
  const out = await syncActivities({ archive, api, activityIds, syncedAt: startedAt, fit, log: (l) => lines.push(l) });
  return { fit, out, lines, failures: [...out.failures, ...fit.failures] };
}

const upserts = (api) => api.calls.filter((c) => c.action === 'upsertSyncedWorkout');
const fitFiles = (drive) => [...drive.files.values()].filter((f) => f.props.kind === 'fit');
const archived = (drive, id) => [...drive.files.values()].find((f) => f.props.activity_id === id).data;

test('AC1: each mapped activity gets one request, a FIT in fit/<YYYY>/<MM>/, and fit_ref on its row', async () => {
  const { drive, archive } = await archiveWith(ALL);
  const api = fakeApi();
  const client = fakeCoros();
  const { fit, failures } = await runOnce({ archive, api, client });

  assert.deepEqual(failures, []);
  // Strength (402) and gym cardio (400) get no request; the args are the list's.
  assert.deepEqual(client.calls.map((c) => c.args), MAPPED.map((f) => f.args));
  assert.equal(fit.counts.requested, 4);
  assert.equal(fit.counts.stored, 4);

  const files = fitFiles(drive);
  assert.equal(files.length, 4);
  for (const f of MAPPED) {
    const file = files.find((x) => x.props.fit_activity_id === f.activity_id);
    assert.equal(drive.pathOf(file.id), `Thrive COROS/fit/2026/09/${f.activity_id}.fit`);
    assert.deepEqual(file.props, { source: 'coros', kind: 'fit', fit_activity_id: f.activity_id });
    assert.deepEqual(file.bytes, makeFit(), 'stored as it came');
    const call = upserts(api).find((c) => c.source_activity_id === f.activity_id);
    assert.equal(call.fit_ref, file.id);
    assert.equal(call.fit_fetched_at, START);
    assert.equal(archived(drive, f.activity_id).fit.status, 'stored');
  }
});

test('AC1: rows are written oldest first, so the FIT budget goes to the oldest', async () => {
  const { archive } = await archiveWith(ALL);
  const api = fakeApi();
  await runOnce({ archive, api, client: fakeCoros() });
  assert.deepEqual(upserts(api).map((c) => c.source_activity_id), ids(MAPPED));
});

test('AC3: a second run makes no request and re-sends the same fit fields', async () => {
  const { drive, archive } = await archiveWith(ALL);
  const api = fakeApi();
  const client = fakeCoros();
  await runOnce({ archive, api, client });
  const first = upserts(api).map((c) => [c.fit_ref, c.fit_fetched_at]);
  api.calls.length = 0;

  const second = await runOnce({ archive, api, client, startedAt: '2026-09-24T18:17:03.000Z' });
  assert.equal(client.calls.length, 4, 'no new request');
  assert.equal(second.fit.counts.requested, 0);
  assert.deepEqual(second.failures, []);
  assert.deepEqual(upserts(api).map((c) => [c.fit_ref, c.fit_fetched_at]), first);
  assert.ok(!api.calls.some((c) => c.action === 'getSyncLog'), 'nothing to fetch, so the budget is not read');
  // The FIT's tags do not collide with the activity's: every lookup still found one file.
  assert.equal(fitFiles(drive).length, 4);
});

test('AC3: a FIT in Drive that the archive lost is adopted, without a request', async () => {
  const { drive, archive } = await archiveWith([FIXTURES[0]]);
  const id = FIXTURES[0].activity_id;
  await runOnce({ archive, api: fakeApi(), client: fakeCoros(), activityIds: [id] });
  const file = [...drive.files.values()].find((f) => f.props.activity_id === id);
  delete file.data.fit; // a run died between the upload and the record

  const api = fakeApi();
  const client = fakeCoros();
  const { fit } = await runOnce({ archive, api, client, activityIds: [id], startedAt: '2026-09-24T18:17:03.000Z' });
  assert.equal(client.calls.length, 0);
  assert.equal(fit.counts.adopted, 1);
  assert.equal(upserts(api)[0].fit_ref, fitFiles(drive)[0].id);
  assert.equal(upserts(api)[0].fit_fetched_at, '2026-09-24T17:41:12.345Z', 'the file\'s own time');
});

test('AC2: at the cap the run stops requesting, logs the backlog, and is not a failure', async () => {
  const { archive } = await archiveWith(ALL);
  const api = fakeApi({ syncLog: [row(ago(2 * HOUR), 30), row(ago(8 * HOUR), 18), row(ago(26 * HOUR), 50)] });
  const client = fakeCoros();
  const { fit, failures, lines } = await runOnce({ archive, api, client });

  assert.deepEqual(failures, []);
  assert.equal(fit.counts.requested, 2, '50 − 48');
  assert.deepEqual(client.calls.map((c) => c.args.labelId), ids(MAPPED).slice(0, 2), 'the oldest two');
  assert.equal(fit.counts.waiting, 2);
  assert.equal(fit.remaining, 0);
  assert.equal(api.calls.filter((c) => c.action === 'getSyncLog').length, 1, 'read once');
  assert.equal(api.calls.find((c) => c.action === 'getSyncLog').limit, 100);
  // Every activity still gets its row; the waiting ones with blank fit fields.
  const waiting = upserts(api).slice(2);
  assert.equal(waiting.length, 2);
  for (const c of waiting) assert.deepEqual([c.fit_ref, c.fit_fetched_at], ['', '']);
  assert.ok(lines.some((l) => /48 of 50 used in the last 24 h, 2 left/.test(l)));
});

test('AC2: an injected budget lowers the cap, and can never raise it', async () => {
  const { archive } = await archiveWith(ALL);
  const lowered = await runOnce({ archive, api: fakeApi(), client: fakeCoros(), budgetOverride: 1 });
  assert.equal(lowered.fit.counts.requested, 1);
  assert.equal(lowered.fit.counts.waiting, 3);

  const again = await archiveWith(ALL);
  const raised = await runOnce({
    archive: again.archive, api: fakeApi({ syncLog: [row(ago(HOUR), 49)] }), client: fakeCoros(), budgetOverride: 40,
  });
  assert.equal(raised.fit.counts.requested, 1);
});

test('AC2: when the budget cannot be read, nothing is requested and the run says why', async () => {
  const { archive } = await archiveWith(ALL);
  const api = fakeApi({ syncLogError: new Error('getSyncLog: Sheet "SyncLog" not found') });
  const client = fakeCoros();
  const { fit, failures } = await runOnce({ archive, api, client });
  assert.equal(client.calls.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /FIT budget unknown, so no FIT was requested this run: getSyncLog failed/);
  assert.equal(upserts(api).length, 4, 'the rows are still written');
  assert.equal(fit.remaining, 'unknown');
});

test('AC4: a failing FIT is tried once a run, counted every time, and given up on after 3', async () => {
  const id = FIXTURES[0].activity_id;
  const { drive, archive } = await archiveWith([FIXTURES[0]]);
  const client = fakeCoros(() => new Error('COROS answered 500'));
  const times = ['2026-09-24T09:17:00.000Z', '2026-09-24T13:17:00.000Z', '2026-09-24T18:17:00.000Z', '2026-09-25T00:17:00.000Z'];

  const runs = [];
  for (const startedAt of times) {
    const api = fakeApi();
    runs.push({ ...(await runOnce({ archive, api, client, startedAt, activityIds: [id] })), api });
  }
  assert.equal(client.calls.length, 3, 'one request a run, and none after the third failure');
  assert.deepEqual(runs.map((r) => r.fit.counts.requested), [1, 1, 1, 0]);
  assert.match(runs[0].failures[0], /FIT request 1 of 3 failed; the next run tries again: COROS answered 500/);
  assert.match(runs[1].failures[0], /FIT request 2 of 3 failed/);
  assert.match(runs[2].failures[0], /FIT request failed 3 times, so the sync has stopped asking for it/);
  assert.deepEqual(runs[3].failures, [], 'giving up is reported once');

  // "No FIT will be fetched": fit_fetched_at set, fit_ref blank, from the third run on.
  assert.deepEqual([upserts(runs[1].api)[0].fit_ref, upserts(runs[1].api)[0].fit_fetched_at], ['', '']);
  assert.deepEqual([upserts(runs[2].api)[0].fit_ref, upserts(runs[2].api)[0].fit_fetched_at], ['', times[2]]);
  assert.deepEqual([upserts(runs[3].api)[0].fit_ref, upserts(runs[3].api)[0].fit_fetched_at], ['', times[2]]);
  assert.equal(archived(drive, id).fit.status, 'unavailable');
  assert.equal(fitFiles(drive).length, 0);
});

test('AC4: a file that is not a valid FIT counts as a failed attempt too', async () => {
  const id = FIXTURES[0].activity_id;
  const { drive, archive } = await archiveWith([FIXTURES[0]]);
  const client = fakeCoros((args) => fitResult(args.labelId, makeFit().subarray(0, 30)));
  const { fit, failures } = await runOnce({ archive, api: fakeApi(), client, activityIds: [id] });
  assert.equal(fit.counts.requested, 1);
  assert.match(failures[0], /truncated FIT file/);
  assert.equal(archived(drive, id).fit.attempts, 1);
  assert.equal(fitFiles(drive).length, 0);
});

test('AC4: a Drive failure after a good download counts the request but not an attempt', async () => {
  const id = FIXTURES[0].activity_id;
  const { drive, archive } = await archiveWith([FIXTURES[0]]);
  drive.failBinary = new Error('Drive 503: backend error');
  const { fit, failures } = await runOnce({ archive, api: fakeApi(), client: fakeCoros(), activityIds: [id] });
  assert.equal(fit.counts.requested, 1);
  assert.match(failures[0], /FIT downloaded but not stored in Drive: Drive 503/);
  assert.equal(archived(drive, id).fit, undefined, 'no attempt used up');
});

test('AC4: the archive keeps the FIT record through an ingest update and a normalized write-back', async () => {
  const { drive, archive } = await archiveWith([FIXTURES[0]]);
  const f = FIXTURES[0];
  await runOnce({ archive, api: fakeApi(), client: fakeCoros(), activityIds: [f.activity_id] });
  await archive.upsertActivity({
    activityId: f.activity_id, localDate: f.list_entry.date, tool: f.tool, args: f.args,
    listEntry: f.list_entry, payload: `${f.payload} `,
  });
  assert.equal(archived(drive, f.activity_id).fit.status, 'stored');
});

test('AC5: the sync never asks for a download URL, and redact() masks one anywhere', async () => {
  const { archive } = await archiveWith(ALL);
  const client = fakeCoros();
  await runOnce({ archive, api: fakeApi(), client });
  assert.ok(client.calls.every((c) => c.name === 'downloadActivityFitFiles'));
  const url = 'https://s3.coros.com/fit/000000000000/000000000000000000.fit';
  for (const text of [`failed: ${url}`, `"${url}"`, `(${url.replace('https://', '')})`]) {
    const out = redact(text);
    assert.doesNotMatch(out, /s3\.coros\.com/);
    assert.match(out, /\[fit-url redacted\]/);
  }
});

test('AC5: a failure message quoting a FIT URL reaches the log and the row redacted', async () => {
  const id = FIXTURES[0].activity_id;
  const { archive, drive } = await archiveWith([FIXTURES[0]]);
  const client = fakeCoros(() => new Error('fetch https://s3.coros.com/fit/000000000000/000000000000000000.fit failed'));
  const { failures, lines } = await runOnce({ archive, api: fakeApi(), client, activityIds: [id] });
  for (const text of [...failures, ...lines, JSON.stringify(archived(drive, id))]) {
    assert.doesNotMatch(text, /s3\.coros\.com/);
  }
});
