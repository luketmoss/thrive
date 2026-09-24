// #165 — upsertDailyHealth: DailyHealth rows written by date, through the key
// only, with every value stored as literal text.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadApi, callDoGet, healthRow, DAILY_HEALTH_ORDER, type CellValue,
} from './apps-script-sandbox';

const T1 = '2026-09-24T13:25:32.000Z';
const T2 = '2026-09-24T19:05:10.000Z';

/** Column name -> index, from the sandbox's mirror of the layout. */
const COL = Object.fromEntries(DAILY_HEALTH_ORDER.map((f, i) => [f, i])) as Record<string, number>;

function upsert(existing: CellValue[][], rows: unknown, syncedAt: string | undefined = T1, key?: string) {
  const api = loadApi({ dailyHealth: existing });
  const res = callDoGet<any>(api.sandbox, {
    action: 'upsertDailyHealth',
    payload: JSON.stringify({ rows, synced_at: syncedAt }),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res, health: api.healthRows! };
}

/** A parsed day as the sync sends it: every non-snapshot field present. */
const day = (date: string, extra: Record<string, string> = {}) => ({
  date, resting_hr: '57', hrv: '41', steps: '2617', calories: '412',
  sleep_total_s: '26100', sleep_deep_s: '3120', sleep_rem_s: '6180', sleep_light_s: '15720',
  sleep_awake_s: '1080', sleep_score: '84', training_load: '7',
  bed_time: '22:51', wake_time: '06:06', raw_ref: 'drive-file-1', ...extra,
});

describe('AC1: DAILY_HEALTH_FIELDS is the one layout', () => {
  it('lists the 18 fields in sync plan §5 order, plus bed and wake time at O and P', () => {
    const { sandbox } = loadApi();
    expect([...sandbox.DAILY_HEALTH_FIELDS]).toEqual([
      'date', 'resting_hr', 'hrv', 'steps', 'calories', 'sleep_total_s', 'sleep_deep_s',
      'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s', 'sleep_score', 'vo2max', 'recovery',
      'training_load', 'bed_time', 'wake_time', 'raw_ref', 'synced_at',
    ]);
    expect(sandbox.DAILY_HEALTH_COLUMN_COUNT).toBe(18);
  });

  // The migration writes the header the API then writes rows under. Two
  // copies of one list, so they are held together here.
  it('matches the headers the migration script creates', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(
      path.resolve(here, '..', '..', 'scripts', 'migrate-165-daily-health-tab.mjs'), 'utf8');
    const list = script.match(/const HEADERS = \[([\s\S]*?)\];/);
    expect(list, 'HEADERS array in the migration').not.toBeNull();
    const headers = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const { sandbox } = loadApi();
    expect(headers).toEqual([...sandbox.DAILY_HEALTH_FIELDS]);
  });
});

describe('AC4: upsert by date', () => {
  it('appends a date with no row, every value stored as text', () => {
    const { res, health } = upsert([], [day('2026-09-23')]);
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ appended: 1, updated: 0 });
    expect(health).toHaveLength(1);
    const row = health[0];
    // Strings, not a parsed Date, number or time: asText() escaped every one.
    expect(row[COL.date]).toBe('2026-09-23');
    expect(row[COL.steps]).toBe('2617');
    expect(row[COL.bed_time]).toBe('22:51');
    expect(row[COL.synced_at]).toBe(T1);
    for (const v of row) expect(typeof v).toBe('string');
  });

  it('writes an absent snapshot field blank on a new row, never 0', () => {
    const { health } = upsert([], [day('2026-09-23')]);
    expect(health[0][COL.vo2max]).toBe('');
    expect(health[0][COL.recovery]).toBe('');
  });

  it('updates an existing date in place', () => {
    const existing = [
      healthRow({ date: '2026-09-22', steps: '412' }),
      healthRow({ date: '2026-09-23', steps: '1000', synced_at: T1 }),
    ];
    const { res, health } = upsert(existing, [day('2026-09-23')], T2);
    expect(res.data).toMatchObject({ appended: 0, updated: 1 });
    expect(health).toHaveLength(2);
    expect(health[1][COL.steps]).toBe('2617');
    expect(health[1][COL.synced_at]).toBe(T2);
    expect(health[0][COL.steps]).toBe('412'); // the other date is untouched
  });

  it('leaves an omitted field alone, so an earlier snapshot survives', () => {
    const existing = [healthRow({ date: '2026-09-23', vo2max: '51', recovery: '87' })];
    const { health } = upsert(existing, [day('2026-09-23')]);
    expect(health[0][COL.vo2max]).toBe('51');
    expect(health[0][COL.recovery]).toBe('87');
  });

  it('writes a field sent as "" blank', () => {
    const existing = [healthRow({ date: '2026-09-23', steps: '2617', sleep_score: '84' })];
    const { health } = upsert(existing, [{ date: '2026-09-23', sleep_score: '' }]);
    expect(health[0][COL.sleep_score]).toBe('');
    expect(health[0][COL.steps]).toBe('2617');
  });

  it('re-running the same rows leaves one row per date, identical but for synced_at', () => {
    const rows = [day('2026-09-22'), day('2026-09-23', { vo2max: '51', recovery: '87' })];
    const first = upsert([], rows, T1);
    const after = JSON.parse(JSON.stringify(first.health));
    const second = upsert(after, rows, T2);

    expect(second.res.data).toMatchObject({ appended: 0, updated: 2 });
    expect(second.health).toHaveLength(2);
    const strip = (r: CellValue[]) => r.filter((_, i) => i !== COL.synced_at);
    expect(second.health.map(strip)).toEqual(first.health.map(strip));
    expect(second.health.map((r) => r[COL.synced_at])).toEqual([T2, T2]);
  });

  it('stamps every row with the one synced_at of the call', () => {
    const { health } = upsert([], [day('2026-09-21'), day('2026-09-22'), day('2026-09-23')]);
    expect(new Set(health.map((r) => r[COL.synced_at]))).toEqual(new Set([T1]));
  });

  // Sync plan §10, row-index drift: the index is read once, so a row that
  // moved before the write must not be overwritten with another day.
  it('re-reads column A before an update and refuses a row that no longer holds the date', () => {
    const existing = [healthRow({ date: '2026-09-22', steps: '412' }), healthRow({ date: '2026-09-23' })];
    const api = loadApi({ dailyHealth: existing });
    const sheet = api.sandbox.getSheet('DailyHealth');
    const realGetRange = sheet.getRange.bind(sheet);
    let drifted = false;
    // After the date index is read, another writer inserts a row at the top.
    sheet.getRange = (r: number, c: number, n: number, w: number) => {
      if (!drifted && w === 18) {
        drifted = true;
        existing.unshift(healthRow({ date: '2026-09-01' }));
      }
      return realGetRange(r, c, n, w);
    };
    const res = callDoGet<any>(api.sandbox, {
      action: 'upsertDailyHealth',
      payload: JSON.stringify({ rows: [day('2026-09-23')], synced_at: T1 }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expected to hold 2026-09-23/);
    expect(existing.map((r) => r[COL.date])).toEqual(['2026-09-01', '2026-09-22', '2026-09-23']);
    expect(existing[1][COL.steps]).toBe('412');
  });

  it('refuses a formula and stores it as text when escaped', () => {
    // A numeric field refuses anything that is not a number...
    const bad = upsert([], [{ date: '2026-09-23', steps: '=1+1' }]);
    expect(bad.res.success).toBe(false);
    expect(bad.health).toHaveLength(0);
    // ...and raw_ref, the one free-text field, is escaped rather than evaluated.
    const { health } = upsert([], [{ date: '2026-09-23', raw_ref: '=HYPERLINK("x")' }]);
    expect(health[0][COL.raw_ref]).toBe('=HYPERLINK("x")');
  });
});

describe('AC4: validation rejects the batch before any write', () => {
  const cases: [string, unknown, RegExp][] = [
    ['an unknown field', [{ date: '2026-09-23', stepz: '1' }], /unknown field "stepz"/],
    ['a missing date', [{ steps: '1' }], /date is required/],
    ['a malformed date', [{ date: '23 Sept' }], /Expected YYYY-MM-DD/],
    ['a duration left unconverted', [{ date: '2026-09-23', sleep_total_s: '7h 15min' }], /sleep_total_s must be a number/],
    ['a clock time in the wrong shape', [{ date: '2026-09-23', bed_time: '10:51 PM' }], /bed_time must be local HH:mm/],
    ['a per-row synced_at', [{ date: '2026-09-23', synced_at: T2 }], /synced_at is set once per call/],
    ['the same date twice', [{ date: '2026-09-23' }, { date: '2026-09-23' }], /appears twice/],
  ];
  for (const [name, rows, error] of cases) {
    it(`refuses ${name}`, () => {
      const { res, health } = upsert([healthRow({ date: '2026-09-20', steps: '1' })], [day('2026-09-22'), ...(rows as object[])]);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(error);
      expect(health).toHaveLength(1); // the valid row before it was not written either
    });
  }

  it('requires rows and synced_at', () => {
    expect(upsert([], undefined).res.error).toMatch(/payload.rows field required/);
    expect(upsert([], [], '').res.error).toMatch(/payload.synced_at field required/);
  });
});

describe('AC4: only through the key', () => {
  it('refuses a call with no key', () => {
    const { res, health } = upsert([], [day('2026-09-23')], T1, '');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Invalid or missing API key');
    expect(health).toHaveLength(0);
  });

  it('refuses a call with the wrong key', () => {
    const { res, health } = upsert([], [day('2026-09-23')], T1, 'not-the-key');
    expect(res.error).toBe('Invalid or missing API key');
    expect(health).toHaveLength(0);
  });

  // No token path exists yet (#144). When one lands, this action stays off it.
  it('is not on any token read allow-list', () => {
    const main = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.js'), 'utf8');
    const allowList = main.match(/(?:READ|TOKEN)_[A-Z_]*ACTIONS\s*=\s*\[([\s\S]*?)\]/);
    if (allowList) expect(allowList[1]).not.toMatch(/upsertDailyHealth/);
  });
});

describe('AC5: the rollup reads what the upsert wrote', () => {
  it('gives a health-only date a summary row with the new values and blank activity columns', () => {
    const api = loadApi({ dailyHealth: [] });
    const up = callDoGet<any>(api.sandbox, {
      action: 'upsertDailyHealth',
      payload: JSON.stringify({ rows: [day('2026-09-23')], synced_at: T1 }),
    });
    expect(up.success).toBe(true);
    const rebuilt = callDoGet<any>(api.sandbox, {
      action: 'rebuildDailySummary',
      payload: JSON.stringify({ from: '2026-09-14', to: '2026-09-24', computed_at: T1 }),
    });
    expect(rebuilt.success).toBe(true);
    expect(api.summaryRows).toHaveLength(1);
    const s = api.summaryRows[0];
    // DailySummary M-Q: steps, resting_hr, hrv, sleep_total_s, training_load.
    expect(s.slice(12, 17)).toEqual(['2617', '57', '41', '26100', '7']);
    expect(s[1]).toBe(''); // activity_count
  });
});
