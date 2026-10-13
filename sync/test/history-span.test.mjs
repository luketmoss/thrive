// #162 — the DailySummary backfill's default span takes in DailyHealth dates,
// not only Workouts dates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widenSpan } from '../../scripts/history-span.mjs';

const health = (...dates) => dates.map((date) => ({ date }));

test('AC1: health before the first and after the last workout widens both ends', () => {
  assert.deepEqual(
    widenSpan({ from: '2017-07-03', to: '2026-09-28' }, health('2017-06-30', '2020-01-01', '2026-10-02')),
    { from: '2017-06-30', to: '2026-10-02', widened: true },
  );
});

test('AC1: health inside the workouts span changes nothing', () => {
  assert.deepEqual(
    widenSpan({ from: '2017-07-03', to: '2026-09-28' }, health('2018-01-01', '2026-09-28')),
    { from: '2017-07-03', to: '2026-09-28', widened: false },
  );
});

test('AC1: no health rows, or none usable, leaves the workouts span', () => {
  const span = { from: '2017-07-03', to: '2026-09-28' };
  assert.deepEqual(widenSpan(span, []), { ...span, widened: false });
  assert.deepEqual(widenSpan(span, undefined), { ...span, widened: false });
  assert.deepEqual(widenSpan(span, [{ date: 'x' }, {}]), { ...span, widened: false });
});

test('AC1: no workouts at all takes the health span', () => {
  assert.deepEqual(widenSpan({ from: '', to: '' }, health('2019-03-02', '2019-03-01')), {
    from: '2019-03-01', to: '2019-03-02', widened: true,
  });
  assert.deepEqual(widenSpan({ from: '', to: '' }, []), { from: '', to: '', widened: false });
});
