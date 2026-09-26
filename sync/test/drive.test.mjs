// #151 AC0/AC1: the Drive helper and the single token file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appPropertiesQuery, createDrive, DriveError } from '../src/drive.mjs';
import { DriveAuthError } from '../src/errors.mjs';
import { createTokenStore } from '../src/token-store.mjs';
import { scriptedFetch } from './helpers.mjs';

const getToken = async () => 'google-access-token-xxxx';

test('files are found by app property, never by name, and trashed files are ignored', () => {
  assert.equal(
    appPropertiesQuery({ kind: 'coros-token' }),
    "appProperties has { key='kind' and value='coros-token' } and trashed = false",
  );
  assert.equal(
    appPropertiesQuery({ kind: "it's" }, 'application/vnd.google-apps.folder'),
    "appProperties has { key='kind' and value='it\\'s' } and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
});

test('two files with the same properties are refused rather than guessed between', async () => {
  const { fetchImpl } = scriptedFetch([{ body: { files: [{ id: 'a' }, { id: 'b' }] } }]);
  const drive = createDrive({ getToken, fetchImpl });
  await assert.rejects(drive.findOne({ kind: 'coros-token' }), (err) => {
    assert.ok(err instanceof DriveError);
    assert.match(err.message, /a, b/);
    return true;
  });
});

test('a 401 from Drive is a DriveAuthError naming google-authorize.mjs', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 401, body: { error: { message: 'Invalid Credentials' } } }]);
  const drive = createDrive({ getToken, fetchImpl });
  await assert.rejects(drive.findFiles({ kind: 'x' }), (err) => {
    assert.ok(err instanceof DriveAuthError);
    assert.match(err.message, /google-authorize\.mjs/);
    return true;
  });
});

test('the first save creates the folder and one token file; the next save updates it in place', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: { files: [] } },                  // find token file: none
    { body: { files: [] } },                  // re-check before creating: none
    { body: { files: [] } },                  // find root folder: none
    { body: { id: 'folder-1' } },             // create folder
    { body: { id: 'token-file-1' } },         // create token file
    { body: { id: 'token-file-1' } },         // second save: update in place
  ]);
  const store = createTokenStore(createDrive({ getToken, fetchImpl }));

  assert.equal(await store.save({ refresh_token: 'r1' }), 'token-file-1');
  assert.equal(await store.save({ refresh_token: 'r2' }), 'token-file-1');

  const folder = JSON.parse(calls[3].init.body);
  assert.equal(folder.name, 'Thrive COROS');
  assert.deepEqual(folder.appProperties, { kind: 'thrive-coros-root' });

  assert.match(calls[4].url, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(calls[4].init.body, /"appProperties":\{"kind":"coros-token"\}/);
  assert.match(calls[4].init.body, /"parents":\["folder-1"\]/);

  assert.equal(calls[5].init.method, 'PATCH');
  assert.match(calls[5].url, /files\/token-file-1\?uploadType=media/);
  assert.equal(JSON.parse(calls[5].init.body).refresh_token, 'r2');
  assert.equal(calls.length, 6);
});

test('an existing token file is updated, never duplicated', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: { files: [{ id: 'token-file-7' }] } },
    { body: { id: 'token-file-7' } },
  ]);
  const store = createTokenStore(createDrive({ getToken, fetchImpl }));
  assert.equal(await store.save({ refresh_token: 'r' }), 'token-file-7');
  assert.equal(calls[1].init.method, 'PATCH');
});

test('load returns null when there is no token file yet', async () => {
  const { fetchImpl } = scriptedFetch([{ body: { files: [] } }]);
  const store = createTokenStore(createDrive({ getToken, fetchImpl }));
  assert.equal(await store.load(), null);
});

test('every request carries the bot account\'s bearer token', async () => {
  const { fetchImpl, calls } = scriptedFetch([{ body: { files: [] } }]);
  await createDrive({ getToken, fetchImpl }).findFiles({ kind: 'x' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer google-access-token-xxxx');
});

test('#199: findAll pages past the 10-file cap, following nextPageToken to the end', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: { nextPageToken: 'page-2', files: [{ id: 'f1', name: '1.json' }, { id: 'f2', name: '2.json' }] } },
    { body: { files: [{ id: 'f3', name: '3.json' }] } },
  ]);
  const drive = createDrive({ getToken, fetchImpl });
  const files = await drive.findAll({ source: 'withings' });
  assert.deepEqual(files.map((f) => f.id), ['f1', 'f2', 'f3']);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('pageToken'), null);
  assert.equal(new URL(calls[1].url).searchParams.get('pageToken'), 'page-2');
  assert.match(new URL(calls[0].url).searchParams.get('fields'), /appProperties/);
});

test('#154: a FIT is uploaded as binary, byte for byte, tagged and foldered', async () => {
  const { fetchImpl, calls } = scriptedFetch([{ body: { id: 'fit-file-1' } }]);
  const bytes = Buffer.from([0x0e, 0x20, 0x00, 0xff, 0x2e, 0x46, 0x49, 0x54, 0x0d, 0x0a]);
  const id = await createDrive({ getToken, fetchImpl }).createBinary({
    name: '42.fit', parentId: 'folder-9', props: { source: 'coros', kind: 'fit', fit_activity_id: '42' }, bytes,
  });
  assert.equal(id, 'fit-file-1');
  const body = calls[0].init.body;
  assert.ok(Buffer.isBuffer(body));
  const boundary = calls[0].init.headers['Content-Type'].match(/boundary=(.+)$/)[1];
  const text = body.toString('latin1');
  assert.match(text, /"appProperties":\{"source":"coros","kind":"fit","fit_activity_id":"42"\}/);
  assert.match(text, /"parents":\["folder-9"\]/);
  const start = body.indexOf('Content-Type: application/octet-stream\r\n\r\n') + 'Content-Type: application/octet-stream\r\n\r\n'.length;
  assert.deepEqual(body.subarray(start, start + bytes.length), bytes);
  assert.ok(text.endsWith(`\r\n--${boundary}--`));
});
