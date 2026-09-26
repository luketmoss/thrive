// #200 — WithingsSyncLog: the Withings sync's run log, SyncLog's A:N layout in
// its own tab, selected by `log: 'withings'` on appendSyncLog/getSyncLog.
// Absent, both actions are exactly #156's: SyncLog alone (sync-log.test.ts
// runs unchanged). And scripts/migrate-200-withings-sync-log-tab.mjs against
// a fake Sheets REST API: the real sheet is migrated by hand, after merge.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, type CellValue } from './apps-script-sandbox';

const FIELDS = [
  'run_id', 'started_at', 'finished_at', 'window_start', 'window_end',
  'n_seen', 'n_new', 'n_updated', 'n_enriched', 'n_fit_fetched', 'n_errors',
  'status', 'error_detail', 'notes',
];

/** A Withings run as withings-run.mjs sends it. */
const run = (extra: Record<string, unknown> = {}) => ({
  run_id: 'schedule-37000000001-1',
  started_at: '2026-09-24T13:41:04.512Z',
  finished_at: '2026-09-24T13:41:21.020Z',
  window_start: '2026-08-25',
  window_end: '2026-09-25',
  n_seen: 3, n_new: 1, n_updated: 2, n_enriched: 0, n_fit_fetched: 0, n_errors: 0,
  status: 'ok',
  error_detail: '',
  notes: 'Skipped 1 unattributed Withings group(s): grpid 2 (attrib 1)',
  ...extra,
});

const stored = (overrides: Record<string, string>): CellValue[] => {
  const r = run(overrides) as Record<string, unknown>;
  return FIELDS.map((f) => String(r[f] ?? ''));
};

const appendTo = (sandbox: any, body: Record<string, unknown>) =>
  callDoGet<any>(sandbox, { action: 'appendSyncLog', payload: JSON.stringify(body) });

describe('AC2: appendSyncLog with log "withings"', () => {
  it('appends to WithingsSyncLog and never to SyncLog', () => {
    const api = loadApi({ syncLog: [], withingsSyncLog: [] });
    const res = appendTo(api.sandbox, { row: run(), log: 'withings' });
    expect(res.success, res.error).toBe(true);
    expect(res.data).toMatchObject({ status: 'appended', run_id: 'schedule-37000000001-1', sheetRow: 2 });
    expect(api.syncLogRows).toHaveLength(0);
    expect(api.withingsSyncLogRows).toEqual([[
      'schedule-37000000001-1', '2026-09-24T13:41:04.512Z', '2026-09-24T13:41:21.020Z',
      '2026-08-25', '2026-09-25', '3', '1', '2', '0', '0', '0', 'ok', '',
      'Skipped 1 unattributed Withings group(s): grpid 2 (attrib 1)',
    ]]);
  });

  it('without log, still appends to SyncLog alone', () => {
    const api = loadApi({ syncLog: [], withingsSyncLog: [] });
    expect(appendTo(api.sandbox, { row: run() }).success).toBe(true);
    expect(api.syncLogRows).toHaveLength(1);
    expect(api.withingsSyncLogRows).toHaveLength(0);
  });

  it('does not append a run_id already in WithingsSyncLog', () => {
    const api = loadApi({ syncLog: [], withingsSyncLog: [stored({})] });
    const res = appendTo(api.sandbox, { row: run(), log: 'withings' });
    expect(res.data).toMatchObject({ status: 'exists', sheetRow: 2 });
    expect(api.withingsSyncLogRows).toHaveLength(1);
  });

  it('the run_id guard is per tab: the same id in SyncLog does not block it', () => {
    const api = loadApi({ syncLog: [stored({})], withingsSyncLog: [] });
    expect(appendTo(api.sandbox, { row: run(), log: 'withings' }).data.status).toBe('appended');
    expect(api.withingsSyncLogRows).toHaveLength(1);
    expect(api.syncLogRows).toHaveLength(1);
  });

  it('validates the row exactly as SyncLog does, zero counts included', () => {
    const api = loadApi({ withingsSyncLog: [] });
    const res = appendTo(api.sandbox, { row: run({ status: 'error' }), log: 'withings' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/status must be one of ok, partial, failed/);
    expect(api.withingsSyncLogRows).toHaveLength(0);
  });

  it('refuses an unknown log, writing nothing anywhere', () => {
    const api = loadApi({ syncLog: [], withingsSyncLog: [] });
    const res = appendTo(api.sandbox, { row: run(), log: 'garmin' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/log must be "withings" or absent/);
    expect(api.syncLogRows).toHaveLength(0);
    expect(api.withingsSyncLogRows).toHaveLength(0);
  });

  it('fails loudly, naming the tab, before the migration has run', () => {
    const api = loadApi({ syncLog: [] });
    const res = appendTo(api.sandbox, { row: run(), log: 'withings' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/WithingsSyncLog/);
    expect(api.syncLogRows).toHaveLength(0);
  });

  it('holds the script lock, and accepts only the API key', () => {
    const api = loadApi({ withingsSyncLog: [] });
    appendTo(api.sandbox, { row: run(), log: 'withings' });
    expect(api.lock).toEqual({ acquired: 1, held: false });
    const refused = callDoGet<any>(api.sandbox, {
      action: 'appendSyncLog', key: 'wrong', payload: JSON.stringify({ row: run({ run_id: 'x' }), log: 'withings' }),
    });
    expect(refused.success).toBe(false);
    expect(api.withingsSyncLogRows).toHaveLength(1);
  });
});

describe('AC3: getSyncLog reads one tab only', () => {
  const coros = () => [stored({ run_id: 'schedule-1-1', started_at: '2026-09-24T00:17:00.000Z' })];
  const withings = () => [
    stored({ run_id: 'schedule-8-1', started_at: '2026-09-24T07:41:00.000Z' }),
    stored({ run_id: 'schedule-9-1', started_at: '2026-09-24T13:41:00.000Z', status: 'partial' }),
  ];

  it('without log, a fresher WithingsSyncLog row never shows in SyncLog’s answer', () => {
    const { sandbox } = loadApi({ syncLog: coros(), withingsSyncLog: withings() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', limit: '1' });
    expect(res.data.map((r) => r.run_id)).toEqual(['schedule-1-1']);
  });

  it('without log, an empty SyncLog answers [] whatever WithingsSyncLog holds', () => {
    const { sandbox } = loadApi({ syncLog: [], withingsSyncLog: withings() });
    expect(callDoGet<any[]>(sandbox, { action: 'getSyncLog' }).data).toEqual([]);
  });

  it('log=withings reads WithingsSyncLog newest first, and never SyncLog', () => {
    const { sandbox } = loadApi({ syncLog: coros(), withingsSyncLog: withings() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', log: 'withings' });
    expect(res.success, res.error).toBe(true);
    expect(res.data.map((r) => r.run_id)).toEqual(['schedule-9-1', 'schedule-8-1']);
    expect(res.data[0]).toMatchObject({ status: 'partial', n_enriched: '0', notes: expect.stringContaining('grpid 2') });
  });

  it('log=withings on a missing tab fails, so the watchdog reads it as unreadable', () => {
    const { sandbox } = loadApi({ syncLog: coros() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', log: 'withings' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/WithingsSyncLog/);
  });

  it('refuses an unknown log', () => {
    const { sandbox } = loadApi({ syncLog: coros() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', log: 'SyncLog' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/log must be "withings" or absent/);
  });

  it('stays a token read, for either tab', () => {
    const { sandbox } = loadApi();
    expect(sandbox.isTokenReadAction('getSyncLog')).toBe(true);
    expect(sandbox.isTokenReadAction('appendSyncLog')).toBe(false);
  });
});

// --- AC5: the migration --------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(here, '..', '..', 'scripts', 'migrate-200-withings-sync-log-tab.mjs');
// A plain JS module with no types; imported by URL so tsc does not resolve it.
const load = async (): Promise<any> => import(/* @vite-ignore */ pathToFileURL(SCRIPT_PATH).href);

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

async function migrate(tabs: Record<string, string[][]>, dryRun = false) {
  const mod = await load();
  const sheets = fakeSheets(tabs);
  const out: string[] = [];
  const err: string[] = [];
  const code = await mod.migrate({
    api: sheets.api, dryRun, log: (l: string) => out.push(l), error: (l: string) => err.push(l),
  });
  return { ...sheets, code, out: out.join('\n'), err: err.join('\n') };
}

describe('AC5: migrate-200 creates WithingsSyncLog with SyncLog’s header', () => {
  it('HEADERS is SYNC_LOG_FIELDS, the same list the SyncLog migration wrote', async () => {
    const { HEADERS, TAB } = await load();
    const { sandbox } = loadApi();
    expect(TAB).toBe('WithingsSyncLog');
    expect(HEADERS).toEqual([...sandbox.SYNC_LOG_FIELDS]);
    // And as literally written in the script, the way sync-log.test.ts reads #155's.
    const list = readFileSync(SCRIPT_PATH, 'utf8').match(/const HEADERS = \[([\s\S]*?)\];/);
    expect([...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(FIELDS);
  });

  it('--dry-run plans the tab and writes nothing', async () => {
    const r = await migrate({ SyncLog: [FIELDS] }, true);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.tabs.WithingsSyncLog).toBeUndefined();
    expect(r.out).toMatch(/plan   create tab "WithingsSyncLog"/);
    expect(r.out).toMatch(/--dry-run: nothing written/);
  });

  it('creates the tab with exactly the A1:N1 header, leaving SyncLog alone', async () => {
    const r = await migrate({ SyncLog: [[...FIELDS]] });
    expect(r.code).toBe(0);
    expect(r.writes).toEqual(['batchUpdate', 'PUT WithingsSyncLog!A1:N1']);
    expect(r.tabs.WithingsSyncLog).toEqual([FIELDS]);
    expect(r.tabs.SyncLog).toEqual([FIELDS]);
  });

  it('a second run finds the expected header and writes nothing', async () => {
    const first = await migrate({});
    const second = await migrate(first.tabs);
    expect(second.code).toBe(0);
    expect(second.writes).toEqual([]);
    expect(second.out).toMatch(/already applied/);
  });

  it('refuses, never rewrites, a tab with any other header', async () => {
    const other = [...FIELDS.slice(0, 13), 'source'];
    const r = await migrate({ WithingsSyncLog: [other] });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.tabs.WithingsSyncLog).toEqual([other]);
    expect(r.err).toMatch(/REFUSING/);
  });

  it('refuses an existing tab with an empty header', async () => {
    const r = await migrate({ WithingsSyncLog: [] });
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
  });
});
