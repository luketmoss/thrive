// #197 AC1 and AC2: one file per group under Thrive Withings/measures, found by
// its tags, written once, rewritten in place only when its hash changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDrive } from '../src/drive.mjs';
import { createWithingsArchive, groupHash } from '../src/withings-archive.mjs';
import { NOW, memoryDrive, scriptedFetch } from './helpers.mjs';
import { measureGroup } from './withings-helpers.mjs';

const now = () => NOW;
// 2026-09-01 05:30 UTC is 2026-08-31 23:30 in Denver.
const LATE = Date.parse('2026-09-01T05:30:00Z') / 1000;

test('a group lands at Thrive Withings/measures/<YYYY>/<MM>/<grpid>.json, foldered by its local date', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now });
  const group = measureGroup(4242, LATE);
  const res = await archive.upsertGroup(group);
  assert.equal(res.status, 'created');
  assert.equal(drive.pathOf(res.fileId), 'Thrive Withings/measures/2026/08/4242.json');
  const file = drive.files.get(res.fileId);
  assert.deepEqual(file.props, { source: 'withings', grpid: '4242' });
  assert.deepEqual(Object.keys(file.data), ['source', 'grpid', 'payload', 'payload_hash', 'fetched_at']);
  assert.equal(file.data.source, 'withings');
  assert.equal(file.data.grpid, '4242');
  assert.equal(JSON.stringify(file.data.payload), JSON.stringify(group));
  assert.equal(file.data.payload_hash, createHash('sha256').update(JSON.stringify(group)).digest('hex'));
  assert.equal(file.data.fetched_at, new Date(NOW).toISOString());
});

test('the root and folders carry Withings\' own tags, never COROS\'s', async () => {
  const drive = memoryDrive();
  await createWithingsArchive(drive, { now }).upsertGroup(measureGroup(1, LATE));
  const folders = [...drive.files.values()].filter((f) => f.mimeType === 'folder');
  assert.deepEqual(folders.map((f) => f.props), [
    { kind: 'thrive-withings-root' },
    { kind: 'thrive-withings-folder', path: 'measures' },
    { kind: 'thrive-withings-folder', path: 'measures/2026' },
    { kind: 'thrive-withings-folder', path: 'measures/2026/08' },
  ]);
});

test('an identical group seen again writes nothing', async () => {
  const drive = memoryDrive();
  const group = measureGroup(1, LATE);
  const first = await createWithingsArchive(drive, { now }).upsertGroup(group);
  const before = drive.writes.length;
  const again = await createWithingsArchive(drive, { now: () => NOW + 1000 }).upsertGroup(structuredClone(group));
  assert.deepEqual(again, { status: 'unchanged', fileId: first.fileId });
  assert.equal(drive.writes.length, before);
});

test('an edited group rewrites the same file in place, so its Drive ID never changes', async () => {
  const drive = memoryDrive();
  const first = await createWithingsArchive(drive, { now }).upsertGroup(measureGroup(1, LATE));
  const edited = measureGroup(1, LATE, [{ value: 80100, type: 1, unit: -3 }], { modified: LATE + 999 });
  const later = NOW + 60_000;
  const res = await createWithingsArchive(drive, { now: () => later }).upsertGroup(edited);
  assert.deepEqual(res, { status: 'updated', fileId: first.fileId });
  const files = [...drive.files.values()].filter((f) => f.mimeType !== 'folder');
  assert.equal(files.length, 1);
  assert.equal(JSON.stringify(files[0].data.payload), JSON.stringify(edited));
  assert.equal(files[0].data.payload_hash, groupHash(edited));
  assert.equal(files[0].data.fetched_at, new Date(later).toISOString());
  assert.equal('normalized' in files[0].data, false);
});

test('a file renamed and moved in Drive is still found by its tags and updated, not duplicated', async () => {
  const drive = memoryDrive();
  const first = await createWithingsArchive(drive, { now }).upsertGroup(measureGroup(1, LATE));
  Object.assign(drive.files.get(first.fileId), { name: 'renamed.json', parentId: 'somewhere-else' });
  const res = await createWithingsArchive(drive, { now }).upsertGroup(measureGroup(1, LATE, [{ value: 1, type: 1, unit: 0 }]));
  assert.deepEqual(res, { status: 'updated', fileId: first.fileId });
  assert.equal([...drive.files.values()].filter((f) => f.mimeType !== 'folder').length, 1);
});

test('a grpid matching two files is refused, naming both (drive.findOne)', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: { files: [{ id: 'dup-a' }, { id: 'dup-b' }] } },
  ]);
  const drive = createDrive({ getToken: async () => 'g', fetchImpl });
  await assert.rejects(
    createWithingsArchive(drive, { now }).upsertGroup(measureGroup(99, LATE)),
    /2 files match .*"grpid":"99".*dup-a, dup-b/,
  );
  assert.match(new URL(calls[0].url).searchParams.get('q'), /key='source' and value='withings'.*key='grpid' and value='99'/);
  assert.equal(calls.length, 1);
});

test('a group with no grpid is refused rather than filed under "undefined"', async () => {
  const drive = memoryDrive();
  assert.throws(() => createWithingsArchive(drive, { now }).upsertGroup({ date: LATE }), /grpid/);
  assert.equal(drive.writes.length, 0);
});

// --- #199: the bulk index, for a backfill's thousands of groups -------------

test('preloadIndex reads every archived group once, keyed by grpid, and a new group needs no findOne', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now });
  await archive.upsertGroup(measureGroup(1, LATE));
  await archive.upsertGroup(measureGroup(2, LATE));

  const index = await archive.preloadIndex();
  assert.equal(drive.calls.findAll, 1);
  assert.deepEqual([...index.keys()].sort(), ['1', '2']);

  const before = { findOne: drive.calls.findOne, readJson: drive.calls.readJson };
  const res = await archive.upsertGroup(measureGroup(3, LATE), { index });
  assert.equal(res.status, 'created');
  // A group the index says is new skips findOne entirely.
  assert.equal(drive.calls.findOne, before.findOne);
});

test('with an index, an existing unchanged group still writes nothing, and a changed one updates in place', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now });
  const first = await archive.upsertGroup(measureGroup(1, LATE));
  const writesBefore = drive.writes.length;

  const index = await archive.preloadIndex();
  const findOneBefore = drive.calls.findOne;
  const unchanged = await archive.upsertGroup(measureGroup(1, LATE), { index });
  assert.deepEqual(unchanged, { status: 'unchanged', fileId: first.fileId });
  assert.equal(drive.calls.findOne, findOneBefore, 'no findOne: the index already had the answer');
  assert.equal(drive.writes.length, writesBefore);

  const edited = await archive.upsertGroup(
    measureGroup(1, LATE, [{ value: 1, type: 1, unit: 0 }]),
    { index },
  );
  assert.deepEqual(edited, { status: 'updated', fileId: first.fileId });
});

test('preloadIndex matches by tag, not name: a file renamed in Drive is still found', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now });
  const first = await archive.upsertGroup(measureGroup(1, LATE));
  Object.assign(drive.files.get(first.fileId), { name: 'renamed.json' });

  const index = await archive.preloadIndex();
  const res = await archive.upsertGroup(measureGroup(1, LATE, [{ value: 2, type: 1, unit: 0 }]), { index });
  assert.deepEqual(res, { status: 'updated', fileId: first.fileId });
  assert.equal([...drive.files.values()].filter((f) => f.mimeType !== 'folder').length, 1);
});

test('a fresh archive preloads an empty index, so a new group is created with no tag lookup for it', async () => {
  const drive = memoryDrive();
  const archive = createWithingsArchive(drive, { now });
  const index = await archive.preloadIndex();
  assert.equal(index.size, 0);
  const res = await archive.upsertGroup(measureGroup(1, LATE), { index });
  assert.equal(res.status, 'created');
  // findOne is still spent on folder lookups (root, measures, year, month);
  // none of it is the group's own grpid tag.
  assert.equal(drive.calls.findOne, 4);
  assert.equal(drive.writes.filter((w) => w.op !== 'folder').length, 1);
});
