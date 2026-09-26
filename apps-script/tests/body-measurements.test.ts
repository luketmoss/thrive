// #198 — upsertBodyMeasurements: BodyMeasurements rows written by Withings
// grpid, rewritten whole, through the key only, every value stored as text.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadApi, callDoGet, bodyRow, BODY_MEASUREMENT_ORDER, type CellValue,
} from './apps-script-sandbox';

const T1 = '2026-09-24T13:25:32.000Z';
const T2 = '2026-09-25T13:25:40.000Z';

const COL = Object.fromEntries(BODY_MEASUREMENT_ORDER.map((f, i) => [f, i])) as Record<string, number>;

function upsert(existing: CellValue[][], rows: unknown, syncedAt: string | undefined = T1, key?: string) {
  const api = loadApi({ bodyMeasurements: existing });
  const res = callDoGet<any>(api.sandbox, {
    action: 'upsertBodyMeasurements',
    payload: JSON.stringify({ rows, synced_at: syncedAt }),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res, body: api.bodyRows! };
}

/** A scale group as the normalizer sends it: every field named. */
const scale = (grpid: string, extra: Record<string, string> = {}) => ({
  grpid, date: '2026-09-24', time: '06:41', measured_at_utc: '2026-09-24T06:41:12-06:00',
  kind: 'scale', device_model: 'Body+',
  weight_kg: '81.234', fat_ratio_pct: '18.5', fat_mass_kg: '15.03', fat_free_mass_kg: '66.2',
  muscle_mass_kg: '62.9', hydration_kg: '45.1', bone_mass_kg: '3.3',
  systolic_mmhg: '', diastolic_mmhg: '', pulse_bpm: '61',
  attrib: '0', source: 'withings', raw_ref: 'drive-' + grpid, ...extra,
});

const bp = (grpid: string, extra: Record<string, string> = {}) => ({
  grpid, date: '2026-09-24', time: '19:02', measured_at_utc: '2026-09-24T19:02:00-06:00',
  kind: 'bp', device_model: 'BPM Connect',
  weight_kg: '', fat_ratio_pct: '', fat_mass_kg: '', fat_free_mass_kg: '', muscle_mass_kg: '',
  hydration_kg: '', bone_mass_kg: '',
  systolic_mmhg: '121', diastolic_mmhg: '78', pulse_bpm: '64',
  attrib: '5', source: 'withings', raw_ref: 'drive-' + grpid, ...extra,
});

describe('BODY_MEASUREMENT_FIELDS is the one layout', () => {
  it('lists the 20 fields A:T in the order the issue fixed', () => {
    const { sandbox } = loadApi();
    expect([...sandbox.BODY_MEASUREMENT_FIELDS]).toEqual(BODY_MEASUREMENT_ORDER);
    expect(sandbox.BODY_MEASUREMENT_COLUMN_COUNT).toBe(20);
  });

  // The migration writes the header the API then writes rows under. Two
  // copies of one list, so they are held together here.
  it('matches the headers the migration script creates', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(
      path.resolve(here, '..', '..', 'scripts', 'migrate-198-body-measurements-tab.mjs'), 'utf8');
    const list = script.match(/const HEADERS = \[([\s\S]*?)\];/);
    expect(list, 'HEADERS array in the migration').not.toBeNull();
    const headers = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const { sandbox } = loadApi();
    expect(headers).toEqual([...sandbox.BODY_MEASUREMENT_FIELDS]);
  });
});

describe('AC4: upsert by grpid', () => {
  it('appends a grpid with no row, every value stored as text', () => {
    const { res, body } = upsert([], [scale('1001'), bp('1002')]);
    expect(res.success, res.error).toBe(true);
    expect(res.data).toEqual({ appended: 2, updated: 0, synced_at: T1 });
    expect(body).toHaveLength(2);
    expect(body[0][COL.grpid]).toBe('1001');
    expect(body[0][COL.date]).toBe('2026-09-24');
    expect(body[0][COL.time]).toBe('06:41');
    expect(body[0][COL.weight_kg]).toBe('81.234');
    expect(body[0][COL.systolic_mmhg]).toBe('');
    expect(body[0][COL.synced_at]).toBe(T1);
    expect(body[1][COL.kind]).toBe('bp');
    expect(body[1][COL.weight_kg]).toBe('');
    for (const row of body) {
      expect(row).toHaveLength(20);
      for (const v of row) expect(typeof v).toBe('string');
    }
  });

  it('writes a field the row does not name blank, never 0', () => {
    const { body } = upsert([], [{
      grpid: '7', date: '2026-09-24', time: '06:41', measured_at_utc: '2026-09-24T06:41:12-06:00',
      kind: 'scale', weight_kg: '80.1', source: 'withings',
    }]);
    expect(body[0][COL.fat_ratio_pct]).toBe('');
    expect(body[0][COL.pulse_bpm]).toBe('');
    expect(body[0][COL.attrib]).toBe('');
  });

  it('rewrites an existing grpid whole: a measure removed in a Withings edit becomes blank', () => {
    const existing = [
      bodyRow({ grpid: '1000', weight_kg: '79', synced_at: T1 }),
      bodyRow({ grpid: '1001', weight_kg: '81.234', fat_ratio_pct: '18.5', pulse_bpm: '61', synced_at: T1 }),
    ];
    const edited = scale('1001', { weight_kg: '81.3', fat_ratio_pct: '', pulse_bpm: '' });
    const { res, body } = upsert(existing, [edited], T2);
    expect(res.data).toEqual({ appended: 0, updated: 1, synced_at: T2 });
    expect(body).toHaveLength(2);
    expect(body[1][COL.weight_kg]).toBe('81.3');
    expect(body[1][COL.fat_ratio_pct]).toBe('');
    expect(body[1][COL.pulse_bpm]).toBe('');
    expect(body[1][COL.synced_at]).toBe(T2);
    expect(body[0]).toEqual(bodyRow({ grpid: '1000', weight_kg: '79', synced_at: T1 }));
  });

  it('a field left out of an update is blanked too, since the row is rewritten whole', () => {
    const existing = [bodyRow({ grpid: '5', weight_kg: '80', bone_mass_kg: '3.3' })];
    const row = { ...scale('5') } as Record<string, string>;
    delete row.bone_mass_kg;
    const { body } = upsert(existing, [row]);
    expect(body[0][COL.bone_mass_kg]).toBe('');
  });

  it('re-sending the same window twice leaves the tab identical except synced_at', () => {
    const rows = [scale('1001'), bp('1002'), scale('1003', { date: '2026-09-25' })];
    const first = upsert([], rows, T1);
    const after = JSON.parse(JSON.stringify(first.body));
    const second = upsert(after, rows, T2);

    expect(second.res.data).toEqual({ appended: 0, updated: 3, synced_at: T2 });
    expect(second.body).toHaveLength(3);
    const strip = (r: CellValue[]) => r.filter((_, i) => i !== COL.synced_at);
    expect(second.body.map(strip)).toEqual(first.body.map(strip));
    expect(second.body.map((r) => r[COL.synced_at])).toEqual([T2, T2, T2]);
  });

  it('accepts a numeric grpid and matches it to the stored text', () => {
    const existing = [bodyRow({ grpid: '42', weight_kg: '70' })];
    const { res, body } = upsert(existing, [{ ...scale('x'), grpid: 42 }]);
    expect(res.data).toMatchObject({ appended: 0, updated: 1 });
    expect(body).toHaveLength(1);
    expect(body[0][COL.grpid]).toBe('42');
  });

  // Row-index drift: the index is read once, so a row that moved before the
  // write must not be overwritten with another reading.
  it('re-reads column A before an update and refuses a row that no longer holds the grpid', () => {
    const existing = [bodyRow({ grpid: '1000', weight_kg: '79' }), bodyRow({ grpid: '1001' })];
    const api = loadApi({ bodyMeasurements: existing });
    const sheet = api.sandbox.getSheet('BodyMeasurements');
    const realGetRange = sheet.getRange.bind(sheet);
    let reads = 0;
    // After the grpid index is read, another writer inserts a row at the top.
    sheet.getRange = (r: number, c: number, n: number, w: number) => {
      if (w === 1 && n === 1 && reads++ === 0) existing.unshift(bodyRow({ grpid: '999' }));
      return realGetRange(r, c, n, w);
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'upsertBodyMeasurements',
      payload: JSON.stringify({ rows: [scale('1001')], synced_at: T1 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expected to hold grpid 1001/);
    expect(existing.map((r) => r[COL.grpid])).toEqual(['999', '1000', '1001']);
    expect(existing[1][COL.weight_kg]).toBe('79');
  });

  it('escapes free text rather than evaluating it', () => {
    const { body } = upsert([], [scale('9', { device_model: '=HYPERLINK("x")' })]);
    expect(body[0][COL.device_model]).toBe('=HYPERLINK("x")');
  });

  it('takes the script lock', () => {
    const api = upsert([], [scale('1')]);
    expect(api.lock.acquired).toBe(1);
    expect(api.lock.held).toBe(false);
  });

  it('fails, writing nothing, when the tab does not exist yet', () => {
    const api = loadApi();
    const res = callDoGet<any>(api.sandbox, {
      action: 'upsertBodyMeasurements',
      payload: JSON.stringify({ rows: [scale('1')], synced_at: T1 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Sheet "BodyMeasurements" not (found|stubbed)/);
  });
});

describe('AC4: validation rejects the batch before any write', () => {
  const cases: [string, unknown, RegExp][] = [
    ['an unknown field', [{ ...scale('3'), weight_lb: '180' }], /unknown field "weight_lb"/],
    ['a per-row synced_at', [{ ...scale('3'), synced_at: T2 }], /synced_at is set once per call/],
    ['a missing grpid', [{ ...scale('3'), grpid: '' }], /grpid is required/],
    ['a non-numeric grpid', [scale('abc')], /grpid must be a whole number/],
    ['a malformed date', [scale('3', { date: '24 Sept' })], /date must be local YYYY-MM-DD/],
    ['a missing date', [scale('3', { date: '' })], /date must be local YYYY-MM-DD/],
    ['a 12-hour time', [scale('3', { time: '6:41 AM' })], /time must be local HH:mm/],
    ['a measured_at_utc with no offset', [scale('3', { measured_at_utc: '2026-09-24T06:41:12' })],
      /measured_at_utc must be ISO 8601/],
    ['a bare epoch for measured_at_utc', [scale('3', { measured_at_utc: '1790000000' })], /measured_at_utc must be ISO 8601/],
    ['an unknown kind', [scale('3', { kind: 'thermometer' })], /kind must be one of scale, bp/],
    ['a source other than withings', [scale('3', { source: 'coros' })], /source must be "withings"/],
    ['a non-numeric measure', [scale('3', { weight_kg: '81.2 kg' })], /weight_kg must be a non-negative number/],
    ['a negative measure', [scale('3', { fat_mass_kg: '-1.5' })], /fat_mass_kg must be a non-negative number/],
    ['a formula in a measure', [bp('3', { systolic_mmhg: '=1+1' })], /systolic_mmhg must be a non-negative number/],
    ['a non-numeric attrib', [scale('3', { attrib: 'guest' })], /attrib must be a whole number/],
    ['the same grpid twice', [scale('3'), scale('3')], /grpid 3 appears twice/],
    ['a row that is not an object', ['1001'], /must be an object/],
  ];
  for (const [name, rows, error] of cases) {
    it(`refuses ${name}`, () => {
      const existing = [bodyRow({ grpid: '1', weight_kg: '80' })];
      const { res, body } = upsert(existing, [scale('2'), ...(rows as object[])]);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(error);
      // The valid row before it was not written either.
      expect(body).toEqual([bodyRow({ grpid: '1', weight_kg: '80' })]);
    });
  }

  it('requires rows and synced_at', () => {
    expect(upsert([], undefined).res.error).toMatch(/payload.rows field required/);
    expect(upsert([], [], '').res.error).toMatch(/payload.synced_at field required/);
  });
});

describe('AC4: only through the key', () => {
  it('refuses a call with no key, or the wrong key', () => {
    for (const key of ['', 'not-the-key']) {
      const { res, body } = upsert([], [scale('1')], T1, key);
      expect(res.error).toBe('Invalid or missing API key');
      expect(body).toHaveLength(0);
    }
  });

  it('is not on the token read allow-list', () => {
    const { sandbox } = loadApi();
    expect(sandbox.TOKEN_READ_ACTIONS).not.toContain('upsertBodyMeasurements');
  });
});

describe('readBodyMeasurementRows (for #201 and #203)', () => {
  it('is [] when the tab does not exist', () => {
    const { sandbox } = loadApi();
    expect(sandbox.readBodyMeasurementRows()).toEqual([]);
  });

  it('reads what the upsert wrote, every field present, blank as "" never 0', () => {
    const api = loadApi({ bodyMeasurements: [] });
    callDoGet<any>(api.sandbox, {
      action: 'upsertBodyMeasurements',
      payload: JSON.stringify({ rows: [scale('1001'), bp('1002')], synced_at: T1 }),
    });
    api.bodyRows!.push(bodyRow({})); // a blank row is skipped
    const rows = JSON.parse(JSON.stringify(api.sandbox.readBodyMeasurementRows()));
    expect(rows).toEqual([{ ...scale('1001'), synced_at: T1 }, { ...bp('1002'), synced_at: T1 }]);
  });
});
