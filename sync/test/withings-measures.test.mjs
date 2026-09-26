// #197 AC1 and AC3: getmeas is called with the category, the measure types
// and the window, and paged until `more` is 0. A page that still fails after
// retrying ends the fetch, keeping the pages before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WITHINGS_MEASURE_TYPES } from '../src/config.mjs';
import { withingsWindow } from '../src/dates.mjs';
import { fetchMeasureGroups } from '../src/withings-measures.mjs';
import { NOW, scriptedFetch } from './helpers.mjs';
import { getmeasPage, measureGroup, withingsStatus } from './withings-helpers.mjs';

const retry = { delays: [1, 1], wait: async () => {} };
const window = { startdate: 1787637600, enddate: 1790402399 };
const fetchAll = (fetchImpl) => fetchMeasureGroups({ fetchImpl, accessToken: 'wt-access-0-xxxxxxxx', ...window, retry });

test('getmeas is asked for category 1, the ten free-plan types and the window, with the bearer token', async () => {
  const { fetchImpl, calls } = scriptedFetch([getmeasPage([measureGroup(1, 1790000000)])]);
  const res = await fetchAll(fetchImpl);
  assert.equal(res.error, null);
  assert.equal(res.groups.length, 1);
  assert.equal(calls[0].url, 'https://wbsapi.withings.net/measure');
  assert.deepEqual(calls[0].form, {
    action: 'getmeas',
    category: '1',
    meastypes: '1,5,6,8,9,10,11,76,77,88',
    startdate: '1787637600',
    enddate: '1790402399',
  });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer wt-access-0-xxxxxxxx');
  assert.deepEqual(WITHINGS_MEASURE_TYPES, [1, 5, 6, 8, 9, 10, 11, 76, 77, 88]);
});

test('more/offset is followed until more is 0, and every page\'s groups are returned in order', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    getmeasPage([measureGroup(1, 1790000000), measureGroup(2, 1790000100)], { more: 1, offset: 2 }),
    getmeasPage([measureGroup(3, 1790000200)], { more: 1, offset: 3 }),
    getmeasPage([measureGroup(4, 1790000300)], { more: 0 }),
  ]);
  const res = await fetchAll(fetchImpl);
  assert.equal(res.error, null);
  assert.equal(res.pages, 3);
  assert.deepEqual(res.groups.map((g) => g.grpid), [1, 2, 3, 4]);
  assert.equal(calls[0].form.offset, undefined);
  assert.equal(calls[1].form.offset, '2');
  assert.equal(calls[2].form.offset, '3');
  for (const c of calls) assert.equal(c.form.startdate, '1787637600');
});

test('groups are returned as Withings sent them, key order included', async () => {
  const group = measureGroup(7, 1790000000, [{ value: 120, type: 10, unit: 0 }, { value: 80, type: 9, unit: 0 }]);
  const res = await fetchAll(scriptedFetch([getmeasPage([group])]).fetchImpl);
  assert.equal(JSON.stringify(res.groups[0]), JSON.stringify(group));
});

test('a transient non-zero status is retried, three attempts in all, and a recovered page carries on', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    withingsStatus(2555), { status: 503, body: 'down' }, getmeasPage([measureGroup(1, 1790000000)]),
  ]);
  const res = await fetchAll(fetchImpl);
  assert.equal(res.error, null);
  assert.equal(calls.length, 3);
  assert.equal(res.groups.length, 1);
});

test('a page that still fails ends the fetch as WithingsUnavailableError, keeping earlier pages', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    getmeasPage([measureGroup(1, 1790000000)], { more: 1, offset: 1 }),
    withingsStatus(2555), withingsStatus(2555), withingsStatus(2555),
  ]);
  const res = await fetchAll(fetchImpl);
  assert.equal(calls.length, 4);
  assert.equal(res.error.name, 'WithingsUnavailableError');
  assert.deepEqual(res.groups.map((g) => g.grpid), [1]);
});

test('a network failure that persists is WithingsUnavailableError', async () => {
  const boom = () => new TypeError('fetch failed');
  const res = await fetchAll(scriptedFetch([boom(), boom(), boom()]).fetchImpl);
  assert.equal(res.error.name, 'WithingsUnavailableError');
  assert.deepEqual(res.groups, []);
});

test('an auth status ends the fetch at once as WithingsGrantDeadError', async () => {
  const { fetchImpl, calls } = scriptedFetch([withingsStatus(401)]);
  const res = await fetchAll(fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(res.error.name, 'WithingsGrantDeadError');
});

test('more without a new offset is refused rather than looped on', async () => {
  const res = await fetchAll(scriptedFetch([getmeasPage([measureGroup(1, 1790000000)], { more: 1 })]).fetchImpl);
  assert.equal(res.error.name, 'WithingsRequestError');
  assert.equal(res.groups.length, 1);
});

test('the window is local D - 30 through the end of D + 1 in America/Denver', () => {
  const w = withingsWindow(NOW); // 2026-09-24 03:17 in Denver
  assert.equal(w.runDate, '2026-09-24');
  assert.equal(w.start, '2026-08-25');
  assert.equal(w.end, '2026-09-25');
  assert.equal(new Date(w.startdate * 1000).toISOString(), '2026-08-25T06:00:00.000Z');
  assert.equal(new Date(w.enddate * 1000).toISOString(), '2026-09-26T05:59:59.000Z');
});

test('the window uses Denver\'s date, not UTC\'s: 8 pm local is already tomorrow in UTC', () => {
  const w = withingsWindow(Date.parse('2026-12-02T03:00:00Z')); // 2026-12-01 20:00 MST
  assert.equal(w.runDate, '2026-12-01');
  assert.equal(new Date(w.startdate * 1000).toISOString(), '2026-11-01T06:00:00.000Z'); // MDT midnight
  assert.equal(new Date(w.enddate * 1000).toISOString(), '2026-12-03T06:59:59.000Z'); // MST
});

test('the window is a parameter: startdate 0 is passed straight through', async () => {
  const { fetchImpl, calls } = scriptedFetch([getmeasPage([])]);
  await fetchMeasureGroups({ fetchImpl, accessToken: 'a', startdate: 0, enddate: 5, retry });
  assert.equal(calls[0].form.startdate, '0');
});
