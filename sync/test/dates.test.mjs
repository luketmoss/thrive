// #152 AC1/AC3/AC5: the run date is Denver's, never the runner's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, chunkRange, corosDate, daysInclusive, localDate, syncWindow } from '../src/dates.mjs';

test('the run date is the Denver date, not the UTC one, across the UTC boundary', () => {
  // MDT is UTC−6: 03:00 UTC on the 24th is 21:00 on the 23rd.
  assert.equal(localDate(Date.parse('2026-09-24T03:00:00Z')), '2026-09-23');
  // 06:00 UTC is midnight MDT: the 24th starts.
  assert.equal(localDate(Date.parse('2026-09-24T05:59:59Z')), '2026-09-23');
  assert.equal(localDate(Date.parse('2026-09-24T06:00:00Z')), '2026-09-24');
});

test('the boundary moves with the DST changeover on 1 November 2026', () => {
  // Still MDT (UTC−6) until 08:00 UTC: 06:30 UTC on 1 Nov is 00:30 on 1 Nov.
  assert.equal(localDate(Date.parse('2026-11-01T06:30:00Z')), '2026-11-01');
  // Now MST (UTC−7): the same 06:30 UTC a day later is still 1 Nov, 23:30.
  assert.equal(localDate(Date.parse('2026-11-02T06:30:00Z')), '2026-11-01');
  assert.equal(localDate(Date.parse('2026-11-02T07:00:00Z')), '2026-11-02');
});

test('the window runs from D − 10 to D + 1, with 11 recent days for "last N days" tools', () => {
  const w = syncWindow(Date.parse('2026-09-24T03:00:00Z'));
  assert.deepEqual(w, { runDate: '2026-09-23', start: '2026-09-13', end: '2026-09-24', recentDays: 11 });
});

test('window bounds cross month and year ends by the calendar', () => {
  assert.deepEqual(syncWindow(Date.parse('2027-01-03T18:00:00Z')), {
    runDate: '2027-01-03', start: '2026-12-24', end: '2027-01-04', recentDays: 11,
  });
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysInclusive('2026-10-25', '2026-11-05'), 12);
});

test('dates are sent to COROS as yyyyMMdd', () => {
  assert.equal(corosDate('2026-09-04'), '20260904');
});

test('the 12-day window is two sleep-HRV ranges of at most 7 days', () => {
  assert.deepEqual(chunkRange('2026-09-13', '2026-09-24'), [
    ['2026-09-13', '2026-09-19'],
    ['2026-09-20', '2026-09-24'],
  ]);
  assert.deepEqual(chunkRange('2026-09-01', '2026-09-07'), [['2026-09-01', '2026-09-07']]);
  assert.deepEqual(chunkRange('2026-09-01', '2026-09-15'), [
    ['2026-09-01', '2026-09-07'], ['2026-09-08', '2026-09-14'], ['2026-09-15', '2026-09-15'],
  ]);
  for (const [from, to] of chunkRange('2026-10-25', '2026-11-05')) {
    assert.ok(daysInclusive(from, to) <= 7, `${from}..${to} is at most 7 days across the DST change`);
  }
});
