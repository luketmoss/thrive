// #215 — reconcileBodyMeasurements: rows in the window whose grpid Withings no
// longer returns are deleted, under the lock, capped, bottom-up, each row
// re-read first. This deletes user data rows, so every guard has its own test.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, bodyRow, BODY_MEASUREMENT_ORDER, type CellValue } from './apps-script-sandbox';

const COL = Object.fromEntries(BODY_MEASUREMENT_ORDER.map((f, i) => [f, i])) as Record<string, number>;
const WINDOW = { from: '2026-08-26', to: '2026-09-26' };

const row = (grpid: string, date: string, extra: Record<string, CellValue> = {}) =>
  bodyRow({ grpid, date, kind: 'scale', weight_kg: '80', source: 'withings', ...extra });

function reconcile(existing: CellValue[][] | undefined, payload: unknown, key?: string) {
  const api = loadApi(existing ? { bodyMeasurements: existing } : {});
  const res = callDoGet<any>(api.sandbox, {
    action: 'reconcileBodyMeasurements',
    payload: JSON.stringify(payload),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res, grpids: () => (existing ?? []).map((r) => r[COL.grpid]) };
}

describe('AC1: a reading deleted in Withings leaves the sheet', () => {
  it('deletes the in-window row whose grpid is absent, and says which', () => {
    const existing = [row('101', '2026-09-01'), row('102', '2026-09-10'), row('103', '2026-09-20')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: ['101', '103'], max_deletions: 5 });
    expect(r.res.success, r.res.error).toBe(true);
    expect(r.res.data).toEqual({ deleted: ['102'], refused: false });
    expect(r.grpids()).toEqual(['101', '103']);
    expect(r.lock.acquired).toBe(1);
    expect(r.lock.held).toBe(false);
  });

  it('never touches a row dated outside from/to, however many there are', () => {
    const outside = Array.from({ length: 40 }, (_, i) => row(String(500 + i), i % 2 ? '2026-08-25' : '2026-09-27'));
    const existing = [...outside, row('101', '2026-08-26'), row('102', '2026-09-26')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: ['101'], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: ['102'], refused: false });
    expect(r.grpids()).toEqual([...outside.map((o) => o[COL.grpid]), '101']);
  });

  it('deletes nothing when every in-window row is present', () => {
    const existing = [row('101', '2026-09-01'), row('102', '2026-09-10')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: ['101', '102', '999'], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: [], refused: false });
    expect(r.grpids()).toEqual(['101', '102']);
  });

  it('deletes bottom-up, so interleaved rows each go and every survivor keeps its data', () => {
    const existing = [
      row('1', '2026-09-01', { weight_kg: '71' }), row('2', '2026-09-02'), row('3', '2026-09-03', { weight_kg: '73' }),
      row('4', '2026-09-04'), row('5', '2026-09-05', { weight_kg: '75' }), row('6', '2026-09-06'),
    ];
    const api = loadApi({ bodyMeasurements: existing });
    const sheet = api.sandbox.getSheet('BodyMeasurements');
    const realDelete = sheet.deleteRow.bind(sheet);
    const order: number[] = [];
    sheet.deleteRow = (n: number) => { order.push(n); realDelete(n); };
    const res = callDoGet<any>(api.sandbox, {
      action: 'reconcileBodyMeasurements',
      payload: JSON.stringify({ ...WINDOW, present_grpids: ['1', '3', '5'], max_deletions: 5 }),
    });
    expect(res.data).toEqual({ deleted: ['2', '4', '6'], refused: false });
    expect(order).toEqual([7, 5, 3]);
    expect(existing.map((r) => [r[COL.grpid], r[COL.weight_kg]])).toEqual([['1', '71'], ['3', '73'], ['5', '75']]);
  });

  it('a missing tab deletes nothing and is not an error', () => {
    const r = reconcile(undefined, { ...WINDOW, present_grpids: ['1'], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: [], refused: false });
  });
});

describe('AC1: the row-drift guard', () => {
  it('refuses, deleting nothing, when a target row no longer holds its grpid', () => {
    const existing = [row('101', '2026-09-01'), row('102', '2026-09-10'), row('103', '2026-09-20')];
    const api = loadApi({ bodyMeasurements: existing });
    const sheet = api.sandbox.getSheet('BodyMeasurements');
    const realGetRange = sheet.getRange.bind(sheet);
    let reads = 0;
    // After the window is read, a row is inserted at the top: every index moves.
    sheet.getRange = (r: number, c: number, n: number, w: number) => {
      if (w === 1 && n === 1 && reads++ === 0) existing.unshift(row('999', '2026-09-05'));
      return realGetRange(r, c, n, w);
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'reconcileBodyMeasurements',
      payload: JSON.stringify({ ...WINDOW, present_grpids: ['101', '103'], max_deletions: 5 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expected to hold grpid 102/);
    expect(res.error).toMatch(/0 row\(s\) had been deleted/);
    expect(existing.map((r) => r[COL.grpid])).toEqual(['999', '101', '102', '103']);
    expect(api.lock.held).toBe(false);
  });

  it('re-checks each row just before its own delete, stopping at the first that moved', () => {
    const existing = [row('1', '2026-09-01'), row('2', '2026-09-02'), row('3', '2026-09-03')];
    const api = loadApi({ bodyMeasurements: existing });
    const sheet = api.sandbox.getSheet('BodyMeasurements');
    const realDelete = sheet.deleteRow.bind(sheet);
    let deletes = 0;
    // After the first (bottom) delete, a row appears at the top.
    sheet.deleteRow = (n: number) => {
      realDelete(n);
      if (deletes++ === 0) existing.unshift(row('888', '2026-09-01'));
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'reconcileBodyMeasurements',
      payload: JSON.stringify({ ...WINDOW, present_grpids: ['2'], max_deletions: 5 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expected to hold grpid 1 /);
    expect(res.error).toMatch(/1 row\(s\) had been deleted/);
    expect(existing.map((r) => r[COL.grpid])).toEqual(['888', '1', '2']);
  });
});

describe('AC3: the cap refuses a suspicious sweep', () => {
  const six = () => Array.from({ length: 6 }, (_, i) => row(String(i + 1), '2026-09-1' + i));

  it('refuses more than max_deletions, deleting nothing', () => {
    const existing = [...six(), row('50', '2026-09-20')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: ['50'], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: [], refused: true, would_delete: 6 });
    expect(r.grpids()).toEqual(['1', '2', '3', '4', '5', '6', '50']);
  });

  it('defaults the cap to 5 when max_deletions is left out', () => {
    const existing = [...six(), row('50', '2026-09-20')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: ['50'] });
    expect(r.res.data).toEqual({ deleted: [], refused: true, would_delete: 6 });
    expect(r.grpids()).toHaveLength(7);
  });

  it('deletes exactly max_deletions rows, and a raised cap lets a larger sweep through', () => {
    const atCap = reconcile([...six().slice(0, 5), row('50', '2026-09-20')],
      { ...WINDOW, present_grpids: ['50'], max_deletions: 5 });
    expect(atCap.res.data).toEqual({ deleted: ['1', '2', '3', '4', '5'], refused: false });
    const raised = reconcile([...six(), row('50', '2026-09-20')], { ...WINDOW, present_grpids: ['50'], max_deletions: 6 });
    expect(raised.res.data.deleted).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(raised.grpids()).toEqual(['50']);
  });

  // A Withings fault can answer status 0 with an empty list. That must never
  // empty the tab, even when the window holds fewer rows than the cap.
  it('refuses an empty present_grpids against a non-empty window, even under the cap', () => {
    const existing = [row('101', '2026-09-01'), row('102', '2026-09-10'), row('7', '2026-01-01')];
    const r = reconcile(existing, { ...WINDOW, present_grpids: [], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: [], refused: true, would_delete: 2 });
    expect(r.grpids()).toEqual(['101', '102', '7']);
  });

  it('an empty present_grpids against an empty window is no deletion, not a refusal', () => {
    const r = reconcile([row('7', '2026-01-01')], { ...WINDOW, present_grpids: [], max_deletions: 5 });
    expect(r.res.data).toEqual({ deleted: [], refused: false });
  });

  it('allow_empty lifts the empty rule, but never the cap', () => {
    const two = reconcile([row('101', '2026-09-01'), row('102', '2026-09-10')],
      { ...WINDOW, present_grpids: [], max_deletions: 2, allow_empty: true });
    expect(two.res.data).toEqual({ deleted: ['101', '102'], refused: false });
    const over = reconcile([row('101', '2026-09-01'), row('102', '2026-09-10')],
      { ...WINDOW, present_grpids: [], max_deletions: 1, allow_empty: true });
    expect(over.res.data).toEqual({ deleted: [], refused: true, would_delete: 2 });
  });
});

describe('validation', () => {
  const existing = () => [row('101', '2026-09-01')];
  const cases: [string, unknown, RegExp][] = [
    ['no from', { to: WINDOW.to, present_grpids: [] }, /from and to are required/],
    ['a bad to', { from: WINDOW.from, to: '2026-9-1', present_grpids: [] }, /Invalid to/],
    ['from after to', { from: '2026-09-27', to: '2026-09-26', present_grpids: [] }, /is after/],
    ['no present_grpids', { ...WINDOW }, /present_grpids must be an array/],
    ['a numeric grpid', { ...WINDOW, present_grpids: [101] }, /present_grpids\[0\] must be a numeric string/],
    ['a non-numeric grpid', { ...WINDOW, present_grpids: ['101', 'abc'] }, /present_grpids\[1\]/],
    ['max_deletions 0', { ...WINDOW, present_grpids: [], max_deletions: 0 }, /max_deletions must be a positive integer/],
    ['max_deletions 2.5', { ...WINDOW, present_grpids: [], max_deletions: 2.5 }, /max_deletions/],
    ['max_deletions "5"', { ...WINDOW, present_grpids: [], max_deletions: '5' }, /max_deletions/],
    ['allow_empty "yes"', { ...WINDOW, present_grpids: [], allow_empty: 'yes' }, /allow_empty/],
  ];
  for (const [name, payload, error] of cases) {
    it(`refuses ${name}, deleting nothing`, () => {
      const rows = existing();
      const r = reconcile(rows, payload);
      expect(r.res.success).toBe(false);
      expect(r.res.error).toMatch(error);
      expect(rows).toHaveLength(1);
    });
  }

  it('needs the key', () => {
    const rows = existing();
    const r = reconcile(rows, { ...WINDOW, present_grpids: [] }, 'wrong-key');
    expect(r.res.success).toBe(false);
    expect(rows).toHaveLength(1);
  });
});
