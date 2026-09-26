// #201 — getBodyMeasurements: BodyMeasurements rows for a date range and
// optional kind, oldest first by measured_at_utc, read through the key or
// almanac's token.

import { describe, it, expect } from 'vitest';
import {
  loadApi, callDoGet, bodyRow, BODY_MEASUREMENT_ORDER, type CellValue,
} from './apps-script-sandbox';

const scale = (grpid: string, overrides: Record<string, CellValue> = {}) => bodyRow({
  grpid, date: '2026-09-24', time: '06:41', measured_at_utc: '2026-09-24T06:41:12-06:00',
  kind: 'scale', device_model: 'Body+', weight_kg: '81.234', fat_ratio_pct: '18.5',
  pulse_bpm: '61', attrib: '0', source: 'withings', raw_ref: 'drive-' + grpid,
  synced_at: '2026-09-24T13:25:32.000Z', ...overrides,
});

const bp = (grpid: string, overrides: Record<string, CellValue> = {}) => bodyRow({
  grpid, date: '2026-09-24', time: '19:02', measured_at_utc: '2026-09-24T19:02:00-06:00',
  kind: 'bp', device_model: 'BPM Connect', systolic_mmhg: '121', diastolic_mmhg: '78',
  pulse_bpm: '64', attrib: '5', source: 'withings', raw_ref: 'drive-' + grpid,
  synced_at: '2026-09-24T13:25:32.000Z', ...overrides,
});

function read(
  bodyMeasurements: CellValue[][] | undefined, params: Record<string, string> = {}, key?: string,
) {
  const api = loadApi(bodyMeasurements ? { bodyMeasurements } : {});
  return callDoGet<any>(api.sandbox, {
    action: 'getBodyMeasurements', ...params, ...(key !== undefined ? { key } : {}),
  });
}

describe('AC1: getBodyMeasurements filters by local date and kind', () => {
  const rows = () => [
    scale('1002', { date: '2026-09-25', measured_at_utc: '2026-09-25T06:41:12-06:00' }),
    scale('1000', { date: '2026-09-22', measured_at_utc: '2026-09-22T06:41:12-06:00' }),
    bp('1001', { date: '2026-09-22', measured_at_utc: '2026-09-22T19:02:00-06:00' }),
  ];

  it('returns all 20 fields, oldest first by measured_at_utc, with no sheetRow', () => {
    const res = read(rows());
    expect(res.success).toBe(true);
    expect(res.data.map((m: any) => m.grpid)).toEqual(['1000', '1001', '1002']);
    for (const m of res.data) {
      expect(Object.keys(m)).toEqual(BODY_MEASUREMENT_ORDER);
      expect(m).not.toHaveProperty('sheetRow');
    }
  });

  it("keeps a blank cell as '' and never 0", () => {
    const res = read(rows(), { kind: 'bp' });
    expect(res.data).toHaveLength(1);
    const m = res.data[0];
    expect(m.systolic_mmhg).toBe('121');
    expect(m.weight_kg).toBe('');
  });

  it('filters inclusively on from and to, each optional', () => {
    expect(read(rows(), { from: '2026-09-23' }).data.map((m: any) => m.grpid)).toEqual(['1002']);
    expect(read(rows(), { to: '2026-09-24' }).data.map((m: any) => m.grpid)).toEqual(['1000', '1001']);
    expect(read(rows(), { from: '2026-09-23', to: '2026-09-24' }).data).toEqual([]);
  });

  it('filters by kind', () => {
    expect(read(rows(), { kind: 'scale' }).data.map((m: any) => m.grpid)).toEqual(['1000', '1002']);
    expect(read(rows(), { kind: 'bp' }).data.map((m: any) => m.grpid)).toEqual(['1001']);
  });

  it('sorts by measured_at_utc as an instant, not sheet order (a backfill scrambles order)', () => {
    const scrambled = [scale('B', { date: '2026-09-20', measured_at_utc: '2026-09-20T08:00:00-06:00' }),
      scale('A', { date: '2026-09-19', measured_at_utc: '2026-09-19T08:00:00-06:00' })];
    expect(read(scrambled).data.map((m: any) => m.grpid)).toEqual(['A', 'B']);
  });

  it('refuses a kind other than scale/bp, naming the valid values', () => {
    const res = read(rows(), { kind: 'thermometer' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/kind must be one of scale, bp/);
  });

  it('refuses a malformed date', () => {
    const res = read(rows(), { from: '09/22/2026' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid from/);
  });

  it('succeeds with [] when the BodyMeasurements tab does not exist', () => {
    const res = read(undefined, { from: '2026-09-01', to: '2026-09-30' });
    expect(res).toEqual({ success: true, data: [] });
  });

  it('refuses a missing or wrong key', () => {
    expect(read(rows(), {}, 'wrong')).toEqual({ success: false, error: 'Invalid or missing API key' });
  });
});

describe('AC2: almanac token can call it, and nothing can write through it', () => {
  it('is on the token read allow-list', () => {
    const { sandbox } = loadApi();
    expect(sandbox.TOKEN_READ_ACTIONS).toContain('getBodyMeasurements');
  });

  it('upsertBodyMeasurements stays off the token read allow-list', () => {
    const { sandbox } = loadApi();
    expect(sandbox.TOKEN_READ_ACTIONS).not.toContain('upsertBodyMeasurements');
  });
});
