// #158 (#147) — getDailyHealth: DailyHealth rows for a date range, every
// column, blanks kept blank, read through the key only.

import { describe, it, expect } from 'vitest';
import {
  loadApi, callDoGet, healthRow, DAILY_HEALTH_ORDER, type CellValue,
} from './apps-script-sandbox';

const full = (date: string) => healthRow({
  date, resting_hr: '57', hrv: '41', steps: '2617', calories: '412',
  sleep_total_s: '26100', sleep_deep_s: '3120', sleep_rem_s: '6180', sleep_light_s: '15720',
  sleep_awake_s: '1080', sleep_score: '84', vo2max: '48', recovery: '92', training_load: '7',
  bed_time: '22:51', wake_time: '06:06', raw_ref: 'drive-file-1', synced_at: '2026-09-24T13:25:32.000Z',
});

function read(dailyHealth: CellValue[][] | undefined, params: Record<string, string> = {}, key?: string) {
  const api = loadApi(dailyHealth ? { dailyHealth } : {});
  return callDoGet<any>(api.sandbox, {
    action: 'getDailyHealth', ...params, ...(key !== undefined ? { key } : {}),
  });
}

describe('AC1: getDailyHealth returns every column for a date range', () => {
  const rows = () => [
    full('2026-09-22'),
    // A day the watch sent steps for and nothing else: blanks stay blank.
    healthRow({ date: '2026-09-20', steps: '8400', synced_at: '2026-09-21T13:00:00.000Z' }),
    full('2026-09-23'),
  ];

  it('returns all 18 fields, oldest first, with no sheetRow', () => {
    const res = read(rows());
    expect(res.success).toBe(true);
    expect(res.data.map((h: any) => h.date)).toEqual(['2026-09-20', '2026-09-22', '2026-09-23']);
    for (const h of res.data) {
      expect(Object.keys(h)).toEqual(DAILY_HEALTH_ORDER);
      expect(h).not.toHaveProperty('sheetRow');
    }
    expect(res.data[1]).toMatchObject({
      resting_hr: '57', hrv: '41', sleep_total_s: '26100', sleep_score: '84',
      vo2max: '48', recovery: '92', bed_time: '22:51', wake_time: '06:06', raw_ref: 'drive-file-1',
    });
  });

  it("keeps a blank cell as '' and never 0", () => {
    const res = read(rows(), { from: '2026-09-20', to: '2026-09-20' });
    expect(res.data).toHaveLength(1);
    const day = res.data[0];
    expect(day.steps).toBe('8400');
    for (const f of DAILY_HEALTH_ORDER) {
      if (['date', 'steps', 'synced_at'].includes(f)) continue;
      expect(day[f], f).toBe('');
    }
  });

  it('filters inclusively on from and to, each optional', () => {
    expect(read(rows(), { from: '2026-09-22' }).data.map((h: any) => h.date))
      .toEqual(['2026-09-22', '2026-09-23']);
    expect(read(rows(), { to: '2026-09-22' }).data.map((h: any) => h.date))
      .toEqual(['2026-09-20', '2026-09-22']);
    expect(read(rows(), { from: '2026-09-21', to: '2026-09-21' }).data).toEqual([]);
  });

  it('skips a row with no date rather than returning it', () => {
    const res = read([...rows(), healthRow({ steps: '10' })]);
    expect(res.data).toHaveLength(3);
  });

  it('reads the tab once for the whole range', () => {
    const api = loadApi({ dailyHealth: rows() });
    const real = api.sandbox.getSpreadsheet;
    let ranges = 0;
    api.sandbox.getSpreadsheet = () => ({
      getSheetByName: (name: string) => {
        const sheet = real().getSheetByName(name);
        if (!sheet || name !== 'DailyHealth') return sheet;
        return new Proxy(sheet, {
          get(target: any, prop) {
            if (prop === 'getRange') {
              return (...args: unknown[]) => { ranges += 1; return target.getRange(...args); };
            }
            return target[prop];
          },
        });
      },
    });
    const res = callDoGet<any>(api.sandbox, { action: 'getDailyHealth', from: '2026-09-20', to: '2026-09-23' });
    expect(res.data).toHaveLength(3);
    expect(ranges).toBe(1);
  });
});

describe('AC1: edges', () => {
  it('succeeds with [] when the DailyHealth tab does not exist', () => {
    const res = read(undefined, { from: '2026-09-01', to: '2026-09-30' });
    expect(res).toEqual({ success: true, data: [] });
  });

  it('refuses a malformed date', () => {
    const res = read([full('2026-09-22')], { from: '09/22/2026' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid from/);
  });

  it('refuses a missing or wrong key', () => {
    expect(read([full('2026-09-22')], {}, 'wrong')).toEqual({ success: false, error: 'Invalid or missing API key' });
  });

  it('leaves the rollup reading the same rows by date', () => {
    const api = loadApi({ dailyHealth: [full('2026-09-22')] });
    const byDate = api.sandbox.getDailyHealth();
    expect(Object.keys(byDate)).toEqual(['2026-09-22']);
    expect(byDate['2026-09-22'].hrv).toBe('41');
  });
});
