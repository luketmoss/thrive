// #152: raw COROS payloads land in Drive, once each, and errors never do.
// MCP and Drive are both fakes; nothing here touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArchive, sha256 } from '../src/archive.mjs';
import { CorosUnavailableError } from '../src/errors.mjs';
import { callTool, CorosToolError, healthCalls, ingest, parseSportRecords } from '../src/ingest.mjs';
import { corosText, fakeCoros, memoryDrive, noWait } from './helpers.mjs';

// 03:00 UTC on 24 Sept: Denver's run date is still the 23rd.
const NOW = Date.parse('2026-09-24T03:00:00Z');
const LATER = Date.parse('2026-09-24T05:00:00Z');

// The shape COROS returned in #152's live run, shortened.
const LIST = [
  'Sport Records — 2026-09-13 to 2026-09-24 (3 records)',
  '========================',
  '',
  '1. Gym Cardio — 2026-09-23',
  '   Location: Gym Cardio',
  '   Time Window: startTimestamp=1790166371 | endTimestamp=1790168672',
  '   Duration: 37:38',
  ' | Avg HR: 99 bpm | Calories: 186 kcal',
  '   LabelId: 480544748954747182 | SportType: 400',
  '',
  '2. Strength — 2026-09-23',
  '   Location: Strength',
  '   Time Window: startTimestamp=1790165808 | endTimestamp=1790165879',
  '   Duration: 1:11 | Sets: 2',
  ' | Avg HR: 51 bpm | Calories: 13 kcal',
  '   LabelId: 480543998669259351 | SportType: 402',
  '',
  // 04:30 UTC on 1 Sept is still 31 Aug in Denver: the folder follows the local date.
  '3. Outdoor Bike — 2026-08-31',
  '   Time Window: startTimestamp=1788237000 | endTimestamp=1788240600',
  '   LabelId: 999 | SportType: 200',
].join('\n');

const detail = (id, extra = '') => corosText(`Activity ${id} Details\n=====\n\nWorkout Time: 37:38${extra}`);

function healthHandlers() {
  const h = {};
  for (const [tool] of healthCalls({ start: '2026-09-13', end: '2026-09-24', recentDays: 11 })) {
    h[tool] = (args) => corosText(`${tool} ${JSON.stringify(args)}`);
  }
  return h;
}

function coros(overrides = {}) {
  return fakeCoros({
    querySportRecords: corosText(LIST),
    getActivityDetail: ({ labelId }) => detail(labelId),
    ...healthHandlers(),
    ...overrides,
  });
}

const silent = () => {};
const run = (client, drive, now = NOW) =>
  ingest({ client, archive: createArchive(drive, { now: () => now }), now, log: silent, retry: noWait });

const activityFile = (drive, id) => [...drive.files.values()].find((f) => f.props.activity_id === id);
const healthFile = (drive, date) => [...drive.files.values()].find((f) => f.props.run_date === date);

// --- AC1 ---------------------------------------------------------------------

test('the list is requested for D − 10 to D + 1 in Denver dates', async () => {
  const client = coros();
  await run(client, memoryDrive());
  assert.deepEqual(client.calls[0], {
    name: 'querySportRecords', args: { startDate: '20260913', endDate: '20260924', limit: 100 },
  });
});

test('every listed activity, strength included, lands as one file keyed by vendor ID', async () => {
  const drive = memoryDrive();
  const client = coros();
  const summary = await run(client, drive);

  assert.deepEqual(summary.activities, { created: 3, updated: 0, unchanged: 0 });
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(
    client.calls.filter((c) => c.name === 'getActivityDetail').map((c) => c.args),
    [
      { labelId: '480544748954747182', sportType: 400 },
      { labelId: '480543998669259351', sportType: 402 },
      { labelId: '999', sportType: 200 },
    ],
  );

  const strength = activityFile(drive, '480543998669259351');
  assert.equal(drive.pathOf(strength.id), 'Thrive COROS/activities/2026/09/480543998669259351.json');
  assert.deepEqual(strength.props, { source: 'coros', activity_id: '480543998669259351' });

  const payload = detail('480543998669259351').content[0].text;
  assert.deepEqual(Object.keys(strength.data).sort(), [
    'activity_id', 'args', 'fetched_at', 'list_entry', 'normalized', 'payload', 'payload_hash', 'source', 'tool',
  ]);
  assert.equal(strength.data.source, 'coros');
  assert.equal(strength.data.tool, 'getActivityDetail');
  assert.deepEqual(strength.data.args, { labelId: '480543998669259351', sportType: 402 });
  assert.equal(strength.data.payload, payload, 'the payload is the tool text byte-for-byte, JSON quoting and all');
  assert.equal(strength.data.payload_hash, sha256(payload));
  assert.equal(strength.data.fetched_at, new Date(NOW).toISOString());
  assert.equal(strength.data.normalized, null);
  assert.equal(strength.data.list_entry.sportType, 402);
  assert.match(strength.data.list_entry.text, /^2\. Strength — 2026-09-23/);
});

test('an activity is foldered by its Denver start date, not the UTC one', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  assert.equal(drive.pathOf(activityFile(drive, '999').id), 'Thrive COROS/activities/2026/08/999.json');
});

test('folders are created once and reused', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const folders = [...drive.files.values()].filter((f) => f.mimeType === 'folder').map((f) => drive.pathOf(f.id)).sort();
  assert.deepEqual(folders, [
    'Thrive COROS',
    'Thrive COROS/activities',
    'Thrive COROS/activities/2026',
    'Thrive COROS/activities/2026/08',
    'Thrive COROS/activities/2026/09',
    'Thrive COROS/health',
    'Thrive COROS/health/2026',
    'Thrive COROS/health/2026/09',
  ]);
});

// --- AC2 ---------------------------------------------------------------------

test('a second run with unchanged payloads writes nothing at all', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const before = drive.writes.length;

  const summary = await run(coros(), drive, LATER);
  assert.deepEqual(summary.activities, { created: 0, updated: 0, unchanged: 3 });
  assert.equal(summary.health, 'unchanged');
  assert.equal(drive.writes.length, before);
});

test('a changed payload updates the same file in place and keeps normalized', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const file = activityFile(drive, '480544748954747182');
  file.data.normalized = { Name: 'Gym Cardio', 'Elapsed (s)': 2258 }; // #153's, written later

  const summary = await run(coros({
    getActivityDetail: ({ labelId }) => detail(labelId, labelId === '480544748954747182' ? '\nTrimmed' : ''),
  }), drive, LATER);

  assert.deepEqual(summary.activities, { created: 0, updated: 1, unchanged: 2 });
  const after = activityFile(drive, '480544748954747182');
  assert.equal(after.id, file.id, 'the Drive file ID, the future raw_ref, is unchanged');
  assert.match(after.data.payload, /Trimmed/);
  assert.equal(after.data.payload_hash, sha256(after.data.payload));
  assert.equal(after.data.fetched_at, new Date(LATER).toISOString());
  assert.deepEqual(after.data.normalized, { Name: 'Gym Cardio', 'Elapsed (s)': 2258 });
  assert.equal([...drive.files.values()].filter((f) => f.props.activity_id === '480544748954747182').length, 1);
});

test('a moved and renamed file is found by its app properties, not duplicated', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const file = activityFile(drive, '999');
  file.name = 'renamed.json';
  file.parentId = 'somewhere-else';

  await run(coros({ getActivityDetail: ({ labelId }) => detail(labelId, '\nEdited') }), drive, LATER);
  assert.equal([...drive.files.values()].filter((f) => f.props.activity_id === '999').length, 1);
  assert.match(activityFile(drive, '999').data.payload, /Edited/);
});

// --- AC3 ---------------------------------------------------------------------

test('health calls cover the window, with sleep HRV in ranges of at most 7 days', () => {
  assert.deepEqual(healthCalls({ start: '2026-09-13', end: '2026-09-24', recentDays: 11 }), [
    ['queryDailyHealthData', { days: 11 }],
    ['querySleepOverview', { startDate: '20260913', endDate: '20260924' }],
    ['queryRestingHeartRate', { days: 11 }],
    ['queryTrainingLoadAssessment', { days: 11 }],
    ['querySleepHrv', { startDate: '20260913', endDate: '20260919' }],
    ['querySleepHrv', { startDate: '20260920', endDate: '20260924' }],
    ['queryRecoveryStatus', {}],
    ['queryFitnessAssessmentOverview', {}],
  ]);
});

test('daily health lands as one bundle for the local run date', async () => {
  const drive = memoryDrive();
  const summary = await run(coros(), drive);
  assert.equal(summary.health, 'created');

  const file = healthFile(drive, '2026-09-23');
  assert.equal(drive.pathOf(file.id), 'Thrive COROS/health/2026/09/2026-09-23.json');
  assert.deepEqual(file.props, { source: 'coros', kind: 'health', run_date: '2026-09-23' });
  assert.equal(file.data.calls.length, 8);
  const recovery = file.data.calls.find((c) => c.tool === 'queryRecoveryStatus');
  assert.deepEqual(recovery.args, {});
  assert.equal(recovery.payload, JSON.stringify('queryRecoveryStatus {}'));
  assert.match(file.data.payload_hash, /^[0-9a-f]{64}$/);
  assert.equal(file.data.fetched_at, new Date(NOW).toISOString());
});

test('a later run on the same date updates the bundle in place when it changed', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const id = healthFile(drive, '2026-09-23').id;

  const summary = await run(coros({ queryRecoveryStatus: corosText('Recovery: 80%') }), drive, LATER);
  assert.equal(summary.health, 'updated');
  const file = healthFile(drive, '2026-09-23');
  assert.equal(file.id, id);
  assert.equal(file.data.calls.find((c) => c.tool === 'queryRecoveryStatus').payload, JSON.stringify('Recovery: 80%'));
  assert.equal([...drive.files.values()].filter((f) => f.props.kind === 'health').length, 1);
});

// --- AC4 ---------------------------------------------------------------------

test('each kind of failure is retried, three attempts in all, then reported', async () => {
  const failures = {
    'a thrown transport error': new Error('fetch failed'),
    'a 5xx': Object.assign(new Error('Streamable HTTP error: 503 Service Unavailable'), { code: 503 }),
    'an isError result': corosText('Internal error', { isError: true }),
    'the unavailable text': corosText('COROS API is temporarily unavailable. Please try again later.'),
    'the anomaly text': corosText('Tool call anomalies detected. High risk of session context pollution.'),
  };
  for (const [what, failure] of Object.entries(failures)) {
    const client = fakeCoros({ getActivityDetail: failure });
    await assert.rejects(
      callTool(client, 'getActivityDetail', { labelId: '1', sportType: 400 }, { retry: noWait }),
      CorosToolError,
      what,
    );
    assert.equal(client.calls.length, 3, `${what}: three attempts`);
  }
});

test('the delays between attempts back off', async () => {
  const waited = [];
  const client = fakeCoros({ queryRecoveryStatus: new Error('fetch failed') });
  await assert.rejects(callTool(client, 'queryRecoveryStatus', {}, {
    retry: { wait: async (ms) => { waited.push(ms); } },
  }));
  assert.equal(waited.length, 2);
  assert.ok(waited[1] > waited[0]);
});

test('a transient failure followed by success archives only the good payload', async () => {
  const drive = memoryDrive();
  let attempts = 0;
  const client = coros({
    getActivityDetail: ({ labelId }) =>
      (labelId === '999' && ++attempts < 3 ? corosText('COROS API is temporarily unavailable') : detail(labelId)),
  });
  const summary = await run(client, drive);
  assert.deepEqual(summary.failures, []);
  assert.equal(attempts, 3, 'succeeded on the third and last attempt');
  assert.equal(activityFile(drive, '999').data.payload, detail('999').content[0].text);
});

test('a detail that keeps failing is never archived, and the other activities still land', async () => {
  const drive = memoryDrive();
  const logs = [];
  const client = coros({
    getActivityDetail: ({ labelId }) =>
      (labelId === '480544748954747182' ? corosText('COROS API is temporarily unavailable') : detail(labelId)),
  });
  const summary = await ingest({
    client, archive: createArchive(drive, { now: () => NOW }), now: NOW, log: (l) => logs.push(l), retry: noWait,
  });

  assert.equal(activityFile(drive, '480544748954747182'), undefined);
  assert.ok(activityFile(drive, '480543998669259351'));
  assert.ok(activityFile(drive, '999'));
  assert.equal(summary.health, 'created');
  assert.equal(summary.failures.length, 1, 'the run reports a failure, so it exits non-zero');
  assert.match(summary.failures[0], /480544748954747182/);
  assert.ok(logs.some((l) => /FAILED activity 480544748954747182/.test(l)));
  for (const f of drive.files.values()) {
    assert.doesNotMatch(JSON.stringify(f.data ?? {}), /temporarily unavailable/);
  }
});

test('an error on an activity already archived leaves its file untouched', async () => {
  const drive = memoryDrive();
  await run(coros(), drive);
  const before = JSON.stringify(activityFile(drive, '999').data);
  const summary = await run(coros({
    getActivityDetail: ({ labelId }) => (labelId === '999' ? corosText('x', { isError: true }) : detail(labelId)),
  }), drive, LATER);
  assert.equal(summary.failures.length, 1);
  assert.equal(JSON.stringify(activityFile(drive, '999').data), before);
});

test('a failed list call ends the run before any detail call', async () => {
  const client = coros({ querySportRecords: corosText('COROS API is temporarily unavailable') });
  const drive = memoryDrive();
  await assert.rejects(run(client, drive), CorosUnavailableError);
  assert.equal(client.calls.filter((c) => c.name === 'querySportRecords').length, 3);
  assert.equal(client.calls.filter((c) => c.name !== 'querySportRecords').length, 0);
  assert.equal(drive.writes.length, 0);
});

test('a failed health call writes no bundle and is reported', async () => {
  const drive = memoryDrive();
  const summary = await run(coros({ querySleepHrv: corosText('boom', { isError: true }) }), drive);
  assert.equal(summary.health, null);
  assert.equal(healthFile(drive, '2026-09-23'), undefined);
  assert.match(summary.failures.at(-1), /health 2026-09-23: querySleepHrv/);
  assert.equal(summary.activities.created, 3);
});

test('a payload carrying a FIT download URL is refused, not archived', async () => {
  const drive = memoryDrive();
  const summary = await run(coros({
    getActivityDetail: ({ labelId }) => detail(labelId, labelId === '999' ? '\nhttps://s3.coros.com/fit/1/999.fit' : ''),
  }), drive);
  assert.equal(activityFile(drive, '999'), undefined);
  assert.match(summary.failures[0], /FIT download URL/);
});

// --- the list ----------------------------------------------------------------

test('the list parser reads every record and its timestamps', () => {
  const entries = parseSportRecords(JSON.stringify(LIST));
  assert.deepEqual(entries.map((e) => [e.activityId, e.sportType, e.name, e.date, e.startTimestamp]), [
    ['480544748954747182', 400, 'Gym Cardio', '2026-09-23', 1790166371],
    ['480543998669259351', 402, 'Strength', '2026-09-23', 1790165808],
    ['999', 200, 'Outdoor Bike', '2026-08-31', 1788237000],
  ]);
});

test('an empty window is zero activities, not an error', () => {
  assert.deepEqual(parseSportRecords(JSON.stringify('No sport records found from 2026-09-01 to 2026-09-10.')), []);
});

test('a list that cannot be read in full fails rather than dropping activities', () => {
  assert.throws(() => parseSportRecords(JSON.stringify(LIST.replace('(3 records)', '(4 records)'))), /declares 4/);
  assert.throws(() => parseSportRecords(JSON.stringify(LIST.replace('LabelId: 999', 'Label: 999'))), /unreadable/);
  assert.throws(() => parseSportRecords(JSON.stringify('Something new entirely')), /unrecognized/);
});

// --- AC5 ---------------------------------------------------------------------

test('the ingest calls only COROS read tools', async () => {
  const client = coros();
  await run(client, memoryDrive());
  for (const { name } of client.calls) assert.match(name, /^(query|get)/);
});
