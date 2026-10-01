// #231 AC2 — scripts/migrate-231-daily-health-stress.mjs against a fake Sheets
// REST API. Proves the plan, the dry run, the append-only write, the
// idempotent second run and the refusals.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadApi } from './apps-script-sandbox';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = pathToFileURL(
  path.resolve(here, '..', '..', 'scripts', 'migrate-231-daily-health-stress.mjs')).href;

// A plain JS module with no types; imported by URL so tsc does not resolve it.
const load = async (): Promise<any> => import(/* @vite-ignore */ SCRIPT);

const FIELDS: string[] = [...loadApi().sandbox.DAILY_HEALTH_FIELDS];
const A_TO_R = FIELDS.slice(0, 18);

interface Tab { rows: string[][]; columns: number }

/** A spreadsheet of named tabs, each a grid of rows and a column count, behind Sheets' REST paths. */
function fakeSheets(tabs: Record<string, Tab>) {
  const writes: string[] = [];
  const titles = Object.keys(tabs);
  async function api(p: string, init?: { method?: string; body?: string }) {
    const method = init?.method ?? 'GET';
    if (p === '?fields=sheets.properties') {
      return {
        sheets: titles.map((title, sheetId) => ({
          properties: { title, sheetId, gridProperties: { columnCount: tabs[title].columns } },
        })),
      };
    }
    if (p === ':batchUpdate' && method === 'POST') {
      for (const r of JSON.parse(init!.body!).requests) {
        const { sheetId, dimension, length } = r.appendDimension;
        expect(dimension).toBe('COLUMNS');
        tabs[titles[sheetId]].columns += length;
        writes.push(`appendDimension ${titles[sheetId]} +${length}`);
      }
      return {};
    }
    const m = p.match(/^\/values\/([^?]+)(\?.*)?$/);
    if (m) {
      const range = decodeURIComponent(m[1]);
      const [tab, cells] = range.split('!');
      if (method === 'PUT') {
        writes.push(`PUT ${range}`);
        expect(cells).toBe('S1');
        expect(tabs[tab].columns).toBeGreaterThanOrEqual(19); // a cell past the grid is an API error
        tabs[tab].rows[0][18] = JSON.parse(init!.body!).values[0][0];
        return {};
      }
      const header = tabs[tab]?.rows[0];
      return header && header.length ? { values: [header] } : {};
    }
    throw new Error(`unexpected Sheets call ${method} ${p}`);
  }
  return { tabs, writes, api };
}

async function run(tabs: Record<string, Tab>, dryRun = false) {
  const { migrate } = await load();
  const sheets = fakeSheets(tabs);
  const out: string[] = [];
  const err: string[] = [];
  const code = await migrate({
    api: sheets.api, dryRun, log: (l: string) => out.push(l), error: (l: string) => err.push(l),
  });
  return { ...sheets, code, out: out.join('\n'), err: err.join('\n') };
}

const dataRow = ['2026-09-23', '57', '41', '2617'];
const live = (columns = 18): Record<string, Tab> => ({
  DailyHealth: { rows: [[...A_TO_R], [...dataRow]], columns },
});

describe('#231 AC2: migrate-231 appends DailyHealth!S', () => {
  it('holds HEADERS equal to DAILY_HEALTH_FIELDS, with A:R unchanged', async () => {
    const { HEADERS, BEFORE, TAB } = await load();
    expect(TAB).toBe('DailyHealth');
    expect(HEADERS).toEqual(FIELDS);
    expect(BEFORE).toEqual(A_TO_R);
    expect(HEADERS[18]).toBe('stress_avg');
  });

  it('--dry-run plans the column and writes nothing', async () => {
    const r = await run(live(), true);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.tabs.DailyHealth.rows[0]).toEqual(A_TO_R);
    expect(r.out).toMatch(/plan   add 1 column\(s\) to the grid \(18 -> 19\)/);
    expect(r.out).toMatch(/plan   write S1: stress_avg/);
    expect(r.out).toMatch(/--dry-run: nothing written/);
  });

  it('widens an 18-column grid and writes S1 alone, leaving A:R and every data row as they were', async () => {
    const r = await run(live());
    expect(r.code).toBe(0);
    expect(r.writes).toEqual(['appendDimension DailyHealth +1', 'PUT DailyHealth!S1']);
    expect(r.tabs.DailyHealth.rows[0]).toEqual(FIELDS);
    expect(r.tabs.DailyHealth.rows[1]).toEqual(dataRow);
  });

  it('does not widen a grid that already has room', async () => {
    const r = await run(live(26));
    expect(r.writes).toEqual(['PUT DailyHealth!S1']);
    expect(r.tabs.DailyHealth.columns).toBe(26);
  });

  it('a second run finds A:S and writes nothing', async () => {
    const first = await run(live());
    const second = await run(first.tabs);
    expect(second.code).toBe(0);
    expect(second.writes).toEqual([]);
    expect(second.out).toMatch(/already applied/);
  });

  it('refuses, never rewrites, any other header', async () => {
    const other = [...A_TO_R.slice(0, 17), 'synced'];
    const r = await run({ DailyHealth: { rows: [other], columns: 18 } });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.tabs.DailyHealth.rows[0]).toEqual(other);
    expect(r.err).toMatch(/REFUSING/);
  });

  it('refuses an A:S header with something else in S', async () => {
    const r = await run({ DailyHealth: { rows: [[...A_TO_R, 'stress']], columns: 19 } });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
  });

  it('refuses an empty header, and a missing tab', async () => {
    expect((await run({ DailyHealth: { rows: [[]], columns: 18 } })).code).toBe(1);
    const missing = await run({ Workouts: { rows: [['id']], columns: 27 } });
    expect(missing.code).toBe(1);
    expect(missing.writes).toEqual([]);
    expect(missing.err).toMatch(/no "DailyHealth" tab/);
  });
});
