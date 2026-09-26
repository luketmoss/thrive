// #198 AC1 — scripts/migrate-198-body-measurements-tab.mjs against a fake
// Sheets REST API. The real sheet is migrated by hand, after merge; this
// proves the plan, the dry run, the idempotent second run and the refusal.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BODY_MEASUREMENT_ORDER } from './apps-script-sandbox';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = pathToFileURL(
  path.resolve(here, '..', '..', 'scripts', 'migrate-198-body-measurements-tab.mjs')).href;

// A plain JS module with no types; imported by URL so tsc does not resolve it.
const load = async (): Promise<any> => import(/* @vite-ignore */ SCRIPT);

/** A spreadsheet of named tabs, each a grid of rows, behind Sheets' REST paths. */
function fakeSheets(tabs: Record<string, string[][]>) {
  const writes: string[] = [];
  async function api(p: string, init?: { method?: string; body?: string }) {
    const method = init?.method ?? 'GET';
    if (p === '?fields=sheets.properties') {
      return { sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) };
    }
    if (p === ':batchUpdate' && method === 'POST') {
      writes.push('batchUpdate');
      for (const r of JSON.parse(init!.body!).requests) tabs[r.addSheet.properties.title] = [];
      return {};
    }
    const m = p.match(/^\/values\/([^?]+)(\?.*)?$/);
    if (m) {
      const range = decodeURIComponent(m[1]);
      const [tab] = range.split('!');
      if (method === 'PUT') {
        writes.push(`PUT ${range}`);
        tabs[tab][0] = JSON.parse(init!.body!).values[0];
        return {};
      }
      const header = tabs[tab]?.[0];
      return header ? { values: [header] } : {};
    }
    throw new Error(`unexpected Sheets call ${method} ${p}`);
  }
  return { tabs, writes, api };
}

async function run(tabs: Record<string, string[][]>, dryRun = false) {
  const { migrate } = await load();
  const sheets = fakeSheets(tabs);
  const out: string[] = [];
  const err: string[] = [];
  const code = await migrate({
    api: sheets.api, dryRun, log: (l: string) => out.push(l), error: (l: string) => err.push(l),
  });
  return { ...sheets, code, out: out.join('\n'), err: err.join('\n') };
}

describe('AC1: the migration creates the tab', () => {
  it('holds HEADERS equal to BODY_MEASUREMENT_FIELDS', async () => {
    const { HEADERS, TAB } = await load();
    expect(TAB).toBe('BodyMeasurements');
    expect(HEADERS).toEqual(BODY_MEASUREMENT_ORDER);
  });

  it('--dry-run plans the tab and writes nothing', async () => {
    const r = await run({ DailyHealth: [['date']] }, true);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.tabs.BodyMeasurements).toBeUndefined();
    expect(r.out).toMatch(/plan   create tab "BodyMeasurements"/);
    expect(r.out).toMatch(/--dry-run: nothing written/);
  });

  it('creates the tab with exactly the A1:T1 header', async () => {
    const r = await run({ DailyHealth: [['date']] });
    expect(r.code).toBe(0);
    expect(r.writes).toEqual(['batchUpdate', 'PUT BodyMeasurements!A1:T1']);
    expect(r.tabs.BodyMeasurements).toEqual([BODY_MEASUREMENT_ORDER]);
  });

  it('a second run finds the expected header and writes nothing', async () => {
    const first = await run({});
    const second = await run(first.tabs);
    expect(second.code).toBe(0);
    expect(second.writes).toEqual([]);
    expect(second.out).toMatch(/already applied/);
  });

  it('refuses, never rewrites, a tab with any other header', async () => {
    const other = [...BODY_MEASUREMENT_ORDER.slice(0, 19), 'weight_lb'];
    const r = await run({ BodyMeasurements: [other] });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.tabs.BodyMeasurements).toEqual([other]);
    expect(r.err).toMatch(/REFUSING/);
  });

  it('refuses an existing tab with an empty header', async () => {
    const r = await run({ BodyMeasurements: [] });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
  });
});
