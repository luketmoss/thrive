// #196 AC2: withings-authorize.mjs checks state, exchanges the pasted code at
// once, writes the one token file under `Thrive Withings`, proves the grant,
// and re-prompts for an expired code at most 3 times.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeWithings, MAX_REPROMPTS } from '../withings-authorize.mjs';
import { createTokenStore, createWithingsTokenStore } from '../src/token-store.mjs';
import { clearSecrets } from '../src/redact.mjs';
import { NOW, memoryDrive, scriptedFetch } from './helpers.mjs';
import { CLIENT_ID, CLIENT_SECRET, withingsStatus, withingsTokens } from './withings-helpers.mjs';

beforeEach(() => clearSecrets());

const measures = (n) => ({ body: { status: 0, body: { measuregrps: Array.from({ length: n }, () => ({})) } } });

function harness(pastes, responses, { drive = memoryDrive() } = {}) {
  const out = [];
  const opened = [];
  const { fetchImpl, calls } = scriptedFetch(responses);
  const queue = [...pastes];
  const promise = authorizeWithings({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    store: createWithingsTokenStore(drive),
    readPaste: async () => (queue.length ? queue.shift() : null),
    fetchImpl,
    print: (line) => out.push(line),
    open: (url) => opened.push(url),
    now: () => NOW,
    state: 'state-abc',
  });
  return { promise, out, opened, calls, drive };
}

test('prints and opens the authorize URL with the run\'s state before waiting', async () => {
  const h = harness(['code=code-1-xxxxxxxx&state=state-abc'], [withingsTokens(1), measures(0)]);
  await h.promise;
  assert.equal(h.opened.length, 1);
  assert.equal(new URL(h.opened[0]).searchParams.get('state'), 'state-abc');
  assert.ok(h.out[0].includes(h.opened[0]));
});

test('a pasted response is exchanged at once and written to Thrive Withings/withings-token.json', async () => {
  const h = harness(['code=code-1-xxxxxxxx&state=state-abc'], [withingsTokens(1), measures(4)]);
  const res = await h.promise;
  assert.equal(h.calls[0].form.code, 'code-1-xxxxxxxx');
  assert.equal(h.calls[0].form.action, 'requesttoken');

  const file = h.drive.files.get(res.fileId);
  assert.equal(h.drive.pathOf(res.fileId), 'Thrive Withings/withings-token.json');
  assert.deepEqual(file.props, { kind: 'withings-token' });
  assert.deepEqual(h.drive.files.get(file.parentId).props, { kind: 'thrive-withings-root' });
  assert.deepEqual(Object.keys(file.data).sort(), ['access_expires_at', 'access_token', 'refresh_token', 'updated_at', 'userid']);
  assert.equal(file.data.userid, '1234567');
  assert.equal(file.data.access_expires_at, new Date(NOW + 10800 * 1000).toISOString());

  assert.equal(res.measureGroups, 4);
  assert.equal(h.calls[1].url, 'https://wbsapi.withings.net/measure');
  assert.ok(h.out.some((l) => /returned 4 measure groups/.test(l)));
});

test('a full callback URL and a bare code are accepted too', async () => {
  const url = harness(['https://luketmoss.github.io/thrive/withings-callback.html?code=code-2-xxxxxxxx&state=state-abc'], [withingsTokens(1), measures(0)]);
  await url.promise;
  assert.equal(url.calls[0].form.code, 'code-2-xxxxxxxx');

  const bare = harness(['code-3-xxxxxxxx'], [withingsTokens(1), measures(0)]);
  await bare.promise;
  assert.equal(bare.calls[0].form.code, 'code-3-xxxxxxxx');
});

test('a re-run updates the one file rather than creating a second', async () => {
  const drive = memoryDrive();
  await harness(['code-1-xxxxxxxx'], [withingsTokens(1), measures(0)], { drive }).promise;
  await harness(['code-2-xxxxxxxx'], [withingsTokens(2), measures(0)], { drive }).promise;
  const tokenFiles = [...drive.files.values()].filter((f) => f.props.kind === 'withings-token');
  assert.equal(tokenFiles.length, 1);
  assert.equal(tokenFiles[0].data.refresh_token, 'wt-refresh-2-xxxxxxxx');
  assert.deepEqual(drive.writes.map((w) => w.op), ['folder', 'create', 'update']);
});

test('the Withings file never collides with the COROS one', async () => {
  const drive = memoryDrive();
  const coros = createTokenStore(drive);
  await coros.save({ client_id: 'c', refresh_token: 'coros-refresh-xxxxxxxx' });
  await harness(['code-1-xxxxxxxx'], [withingsTokens(1), measures(0)], { drive }).promise;
  assert.equal((await coros.load()).refresh_token, 'coros-refresh-xxxxxxxx');
  assert.equal((await createWithingsTokenStore(drive).load()).refresh_token, 'wt-refresh-1-xxxxxxxx');
  const paths = [...drive.files.keys()].map((id) => drive.pathOf(id)).sort();
  assert.deepEqual(paths, ['Thrive COROS', 'Thrive COROS/coros-token.json', 'Thrive Withings', 'Thrive Withings/withings-token.json']);
});

test('a state mismatch is refused and never exchanged', async () => {
  const h = harness(['code=code-1-xxxxxxxx&state=someone-else', 'code=code-2-xxxxxxxx&state=state-abc'], [withingsTokens(1), measures(0)]);
  await h.promise;
  assert.ok(h.out.some((l) => /Refused: .*state/.test(l)));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].form.code, 'code-2-xxxxxxxx');
});

test('an expired code is reported, the URL printed again, and a new paste accepted', async () => {
  const h = harness(['code-old-xxxxxxxx', 'code-new-xxxxxxxx'], [
    withingsStatus(503, 'Invalid Params: invalid code'), withingsTokens(1), measures(0),
  ]);
  await h.promise;
  assert.ok(h.out.some((l) => /expired or already used/.test(l)));
  assert.equal(h.opened.length, 2);
  assert.equal(h.out.filter((l) => l.includes(h.opened[0])).length, 2);
  assert.equal(h.calls[1].form.code, 'code-new-xxxxxxxx');
});

test('after 3 re-prompts it gives up and fails', async () => {
  assert.equal(MAX_REPROMPTS, 3);
  const refusals = Array.from({ length: 4 }, () => withingsStatus(503, 'Invalid Params: invalid code'));
  const h = harness(['c-1-xxxxxxxx', 'c-2-xxxxxxxx', 'c-3-xxxxxxxx', 'c-4-xxxxxxxx', 'c-5-xxxxxxxx'], refusals);
  await assert.rejects(h.promise, /No usable authorization code after 4 tries/);
  assert.equal(h.calls.length, 4);
  assert.equal(h.opened.length, 4);
  assert.equal(h.drive.writes.length, 0);
});

test('an outage during the exchange fails as unavailable, without re-prompting', async () => {
  const h = harness(['code-1-xxxxxxxx'], [withingsStatus(601)]);
  await assert.rejects(h.promise, (err) => err.name === 'WithingsUnavailableError');
  assert.equal(h.opened.length, 1);
});

test('without the client credentials it says which to set', async () => {
  await assert.rejects(
    authorizeWithings({ clientId: CLIENT_ID, clientSecret: '', store: {}, readPaste: async () => null, print: () => {}, open: () => {} }),
    /WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET/,
  );
});
