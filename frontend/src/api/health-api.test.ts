// #236 — the SPA's read of DailyHealth, BodyMeasurements and DailySummary.
// The field lists mirror apps-script/src/types.js (CLAUDE.md: change both
// together), and the first block here is what notices when only one side did.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sheetsGet = vi.fn();
const withReauth = vi.fn((token: string, fn: (t: string) => unknown) => fn(token));
// A plain mock class, as sync-log-api.test.ts explains: an async factory races
// the first test. It mirrors the real one, so `instanceof` still works.
vi.mock('./sheets', () => {
  class MockSheetsApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(`Sheets API ${status}: ${message}`);
      this.status = status;
      this.name = 'SheetsApiError';
    }
  }
  return {
    SheetsApiError: MockSheetsApiError,
    isMissingTabError: (err: unknown) =>
      err instanceof MockSheetsApiError && err.status === 400 && /unable to parse range/i.test(err.message),
    sheetsGet: (...args: unknown[]) => sheetsGet(...args),
    withReauth: (token: string, fn: (t: string) => unknown) => withReauth(token, fn),
  };
});
vi.mock('./demo-data', () => ({
  isDemo: () => false,
  demoDailyHealth: vi.fn(),
  demoBodyMeasurements: vi.fn(),
  demoDailySummary: vi.fn(),
}));

import { SheetsApiError as MockSheetsApiError } from './sheets';
import {
  DAILY_HEALTH_FIELDS,
  BODY_MEASUREMENT_FIELDS,
  DAILY_SUMMARY_FIELDS,
  columnLetter,
  readRange,
  rowToDailyHealth,
  rowToBodyMeasurement,
  rowToDailySummary,
  fetchDailyHealth,
  fetchBodyMeasurements,
  fetchDailySummary,
  selectDailyRange,
  selectBodyMeasurementRange,
  type BodyMeasurementRow,
} from './health-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesJs = readFileSync(resolve(__dirname, '../../../apps-script/src/types.js'), 'utf-8');

function fieldsIn(name: string): string[] {
  const block = typesJs.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`))?.[1];
  expect(block, `${name} not found in types.js`).toBeTruthy();
  return Array.from(block!.matchAll(/'([a-z0-9_]+)'/g), (m) => m[1]);
}

/** A row laid out from a field → value map, as the sheet would hold it. */
function rowOf(fields: readonly string[], values: Record<string, string>): string[] {
  return fields.map((f) => values[f] ?? '');
}

describe('AC1: each field list mirrors types.js', () => {
  it('DAILY_HEALTH_FIELDS matches, name for name and in order (A:R)', () => {
    expect([...DAILY_HEALTH_FIELDS]).toEqual(fieldsIn('DAILY_HEALTH_FIELDS'));
    expect(DAILY_HEALTH_FIELDS).toHaveLength(18);
  });

  it('BODY_MEASUREMENT_FIELDS matches, name for name and in order (A:T)', () => {
    expect([...BODY_MEASUREMENT_FIELDS]).toEqual(fieldsIn('BODY_MEASUREMENT_FIELDS'));
    expect(BODY_MEASUREMENT_FIELDS).toHaveLength(20);
  });

  it('DAILY_SUMMARY_FIELDS matches, name for name and in order (A:Y)', () => {
    expect([...DAILY_SUMMARY_FIELDS]).toEqual(fieldsIn('DAILY_SUMMARY_FIELDS'));
    expect(DAILY_SUMMARY_FIELDS).toHaveLength(25);
  });

  it('derives each read range from its list length', () => {
    expect(readRange('DailyHealth', DAILY_HEALTH_FIELDS)).toBe('DailyHealth!A2:R');
    expect(readRange('BodyMeasurements', BODY_MEASUREMENT_FIELDS)).toBe('BodyMeasurements!A2:T');
    expect(readRange('DailySummary', DAILY_SUMMARY_FIELDS)).toBe('DailySummary!A2:Y');
    // Appending a column is a one-line change: the range follows the list.
    expect(readRange('DailyHealth', [...DAILY_HEALTH_FIELDS, 'stress_avg'])).toBe('DailyHealth!A2:S');
  });

  it('names columns past Z', () => {
    expect([1, 26, 27, 52, 53].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA']);
  });

  it('reads a short row as blanks and ignores cells beyond the list', () => {
    const short = rowToDailyHealth(['2026-09-20', '52'], 7);
    expect(short.date).toBe('2026-09-20');
    expect(short.resting_hr).toBe('52');
    expect(short.hrv).toBe('');
    expect(short.synced_at).toBe('');
    expect(short.sheetRow).toBe(7);

    // A sheet that has gained a column the list does not name yet (#231's
    // stress_avg in DailyHealth!S) still reads correctly.
    const wide = rowToDailyHealth([...rowOf(DAILY_HEALTH_FIELDS, { date: '2026-09-20', synced_at: 'x' }), '31'], 2);
    expect(wide.synced_at).toBe('x');
    expect(Object.keys(wide)).toHaveLength(DAILY_HEALTH_FIELDS.length + 1); // + sheetRow
  });
});

describe('AC2: blank stays blank, 0 stays 0, nothing is converted', () => {
  it('keeps DailyHealth text as stored', () => {
    const h = rowToDailyHealth(rowOf(DAILY_HEALTH_FIELDS, { date: '2026-09-20', hrv: '', steps: '0' }), 2);
    expect(h.hrv).toBe('');
    expect(h.steps).toBe('0');
  });

  it('keeps BodyMeasurements in kg, with a blank fat ratio blank', () => {
    const m = rowToBodyMeasurement(
      rowOf(BODY_MEASUREMENT_FIELDS, { grpid: '1', date: '2026-09-20', kind: 'scale', weight_kg: '81.4', fat_ratio_pct: '' }),
      2,
    );
    expect(m.weight_kg).toBe('81.4');
    expect(m.fat_ratio_pct).toBe('');
  });

  it('passes DailySummary coverage columns through exactly', () => {
    const s = rowToDailySummary(
      rowOf(DAILY_SUMMARY_FIELDS, {
        date: '2026-09-20',
        total_distance_m: '0',
        cardio_activity_count: '2',
        distance_withdata: '1',
        total_moving_s: '',
        moving_withdata: '0',
      }),
      2,
    );
    expect(s.total_distance_m).toBe('0');
    expect(s.cardio_activity_count).toBe('2');
    expect(s.distance_withdata).toBe('1');
    expect(s.total_moving_s).toBe('');
    expect(s.moving_withdata).toBe('0');
  });

  it('trims cell text and turns non-strings into their text, nothing more', () => {
    const h = rowToDailyHealth([' 2026-09-20 ', 52, null, undefined, '  '], 2);
    expect(h.date).toBe('2026-09-20');
    expect(h.resting_hr).toBe('52');
    expect(h.hrv).toBe('');
    expect(h.steps).toBe('');
    expect(h.calories).toBe('');
  });
});

describe('AC3: ranges are selected in memory', () => {
  const day = (date: string, sheetRow: number) => ({ date, sheetRow });

  it('returns the inclusive range oldest first, whatever the sheet order', () => {
    const rows = [day('2026-09-22', 2), day('2026-09-19', 3), day('2026-09-24', 4), day('2026-09-20', 5), day('', 6)];
    expect(selectDailyRange(rows, '2026-09-20', '2026-09-22').map((r) => r.date)).toEqual(['2026-09-20', '2026-09-22']);
  });

  it('never synthesises a missing day', () => {
    const rows = [day('2026-09-20', 2), day('2026-09-23', 3)];
    expect(selectDailyRange(rows, '2026-09-19', '2026-09-24')).toHaveLength(2);
    expect(selectDailyRange(rows, '2026-09-21', '2026-09-22')).toEqual([]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [day('2026-09-22', 2), day('2026-09-20', 3)];
    selectDailyRange(rows, '2026-09-01', '2026-09-30');
    expect(rows.map((r) => r.date)).toEqual(['2026-09-22', '2026-09-20']);
  });

  function reading(grpid: string, date: string, measured: string): BodyMeasurementRow {
    return rowToBodyMeasurement(rowOf(BODY_MEASUREMENT_FIELDS, { grpid, date, measured_at_utc: measured, kind: 'scale' }), 2);
  }

  it('returns every reading in range oldest first by instant, a day\'s several kept apart', () => {
    const rows = [
      reading('3', '2026-09-21', '2026-09-21T19:20:00-06:00'),
      reading('1', '2026-09-21', '2026-09-21T06:40:00-06:00'),
      // Earlier as an instant than 06:40-06:00 even though its text sorts later.
      reading('2', '2026-09-21', '2026-09-21T11:30:00Z'),
      reading('4', '2026-09-19', '2026-09-19T06:40:00-06:00'),
      reading('', '2026-09-21', '2026-09-21T05:00:00-06:00'),
    ];
    expect(selectBodyMeasurementRange(rows, '2026-09-20', '2026-09-21').map((r) => r.grpid)).toEqual(['2', '1', '3']);
  });

  it('selects BodyMeasurements by local date, not by the instant\'s UTC date', () => {
    // 21:30 in Denver is the next day in UTC; the reading still belongs to the 21st.
    const rows = [reading('1', '2026-09-21', '2026-09-21T21:30:00-06:00')];
    expect(selectBodyMeasurementRange(rows, '2026-09-21', '2026-09-21')).toHaveLength(1);
    expect(selectBodyMeasurementRange(rows, '2026-09-22', '2026-09-22')).toHaveLength(0);
  });
});

describe('AC3/AC4: fetching each tab', () => {
  beforeEach(() => {
    sheetsGet.mockReset();
    withReauth.mockClear();
  });

  it('reads each tab once, whole, with the token, dropping rows without their key', async () => {
    sheetsGet.mockImplementation(async (range: string) => {
      if (range === 'DailyHealth!A2:R') return [['2026-09-20', '52'], [], ['', '60'], ['2026-09-19']];
      if (range === 'BodyMeasurements!A2:T') return [['g1', '2026-09-20'], ['', '2026-09-20']];
      if (range === 'DailySummary!A2:Y') return [['2026-09-20', '1'], ['']];
      throw new Error(`unexpected range ${range}`);
    });
    const [h, b, s] = await Promise.all([fetchDailyHealth('tok'), fetchBodyMeasurements('tok'), fetchDailySummary('tok')]);
    expect(sheetsGet).toHaveBeenCalledTimes(3);
    // Every read goes through withReauth, so a 401 re-auths like any other read.
    expect(withReauth).toHaveBeenCalledTimes(3);
    expect(sheetsGet).toHaveBeenCalledWith('DailyHealth!A2:R', 'tok');
    expect(h.map((r) => [r.date, r.sheetRow])).toEqual([['2026-09-20', 2], ['2026-09-19', 5]]);
    expect(b.map((r) => [r.grpid, r.sheetRow])).toEqual([['g1', 2]]);
    expect(s.map((r) => [r.date, r.sheetRow])).toEqual([['2026-09-20', 2]]);
  });

  it('reads a missing tab as empty', async () => {
    sheetsGet.mockRejectedValueOnce(
      new MockSheetsApiError(400, '{"error":{"code":400,"message":"Unable to parse range: BodyMeasurements!A2:T"}}'),
    );
    await expect(fetchBodyMeasurements('tok')).resolves.toEqual([]);
  });

  it('throws any other failure', async () => {
    sheetsGet.mockRejectedValueOnce(new MockSheetsApiError(403, 'forbidden'));
    await expect(fetchDailyHealth('tok')).rejects.toBeInstanceOf(MockSheetsApiError);
    sheetsGet.mockRejectedValueOnce(new MockSheetsApiError(400, 'Invalid value'));
    await expect(fetchDailySummary('tok')).rejects.toBeInstanceOf(MockSheetsApiError);
    sheetsGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchBodyMeasurements('tok')).rejects.toBeInstanceOf(TypeError);
  });
});
