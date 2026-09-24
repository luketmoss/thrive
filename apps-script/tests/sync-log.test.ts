// #156 — SyncLog: one row per sync run, appended through the key only, read
// newest first; and the script lock around the sync's writes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, type CellValue } from './apps-script-sandbox';

const FIELDS = [
  'run_id', 'started_at', 'finished_at', 'window_start', 'window_end',
  'n_seen', 'n_new', 'n_updated', 'n_enriched', 'n_fit_fetched', 'n_errors',
  'status', 'error_detail',
];

/** A run as the sync sends it. */
const run = (extra: Record<string, unknown> = {}) => ({
  run_id: 'schedule-36024934026-1',
  started_at: '2026-09-24T09:17:04.512Z',
  finished_at: '2026-09-24T09:17:41.020Z',
  window_start: '2026-09-14',
  window_end: '2026-09-25',
  n_seen: 2, n_new: 1, n_updated: 0, n_enriched: 0, n_fit_fetched: 0, n_errors: 0,
  status: 'ok',
  error_detail: '',
  ...extra,
});

/** A stored SyncLog row, as a fixture. */
const stored = (overrides: Record<string, string>): CellValue[] => {
  const r = run(overrides) as Record<string, unknown>;
  return FIELDS.map((f) => String(r[f] ?? ''));
};

function append(existing: CellValue[][], row: unknown, key?: string) {
  const api = loadApi({ syncLog: existing });
  const res = callDoGet<any>(api.sandbox, {
    action: 'appendSyncLog',
    payload: JSON.stringify(row === undefined ? {} : { row }),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res, log: api.syncLogRows! };
}

describe('AC1: SYNC_LOG_FIELDS is the one layout', () => {
  it('lists sync plan §5’s 13 fields in order', () => {
    const { sandbox } = loadApi();
    expect([...sandbox.SYNC_LOG_FIELDS]).toEqual(FIELDS);
    expect(sandbox.SYNC_LOG_COLUMN_COUNT).toBe(13);
  });

  it('matches the headers the migration script creates', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(
      path.resolve(here, '..', '..', 'scripts', 'migrate-156-sync-log-tab.mjs'), 'utf8');
    const list = script.match(/const HEADERS = \[([\s\S]*?)\];/);
    expect(list, 'HEADERS array in the migration').not.toBeNull();
    const headers = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const { sandbox } = loadApi();
    expect(headers).toEqual([...sandbox.SYNC_LOG_FIELDS]);
  });
});

describe('AC1: appendSyncLog', () => {
  it('appends one row, every value stored as text in field order', () => {
    const { res, log } = append([], run());
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ status: 'appended', run_id: 'schedule-36024934026-1', sheetRow: 2 });
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual([
      'schedule-36024934026-1', '2026-09-24T09:17:04.512Z', '2026-09-24T09:17:41.020Z',
      '2026-09-14', '2026-09-25', '2', '1', '0', '0', '0', '0', 'ok', '',
    ]);
    // Strings, not a parsed date or number: asText() escaped every one.
    for (const v of log[0]) expect(typeof v).toBe('string');
  });

  it('stores an error_detail beginning with "=" as text, never a formula', () => {
    const { log } = append([], run({ status: 'failed', n_errors: 1, error_detail: '=HYPERLINK("x")' }));
    expect(log[0][12]).toBe('=HYPERLINK("x")');
  });

  it('does not append a run_id that is already there', () => {
    const existing = [stored({})];
    const { res, log } = append(existing, run());
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ status: 'exists', sheetRow: 2 });
    expect(log).toHaveLength(1);
  });

  it.each([
    ['a missing run_id', { run_id: '' }, /run_id is required/],
    ['a started_at that is not an instant', { started_at: '2026-09-24' }, /started_at must be an ISO 8601 instant/],
    ['a finished_at that is not an instant', { finished_at: 'yesterday' }, /finished_at must be/],
    ['a window date that is not YYYY-MM-DD', { window_start: '14/09/2026' }, /window_start/],
    ['a negative count', { n_errors: -1 }, /n_errors must be a non-negative integer/],
    ['a fractional count', { n_seen: 1.5 }, /n_seen must be a non-negative integer/],
    ['a blank count', { n_fit_fetched: '' }, /n_fit_fetched must be a non-negative integer/],
    ['an unknown status', { status: 'error' }, /status must be one of ok, partial, failed/],
    ['an unknown field', { n_health: 3 }, /unknown field "n_health"/],
  ])('refuses %s and writes nothing', (_name, extra, message) => {
    const { res, log } = append([], run(extra));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(message);
    expect(log).toHaveLength(0);
  });

  it('requires payload.row', () => {
    const { res } = append([], undefined);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/payload\.row field required/);
  });

  it('accepts only the API key', () => {
    const { res, log } = append([], run(), 'wrong-key');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid or missing API key/);
    expect(log).toHaveLength(0);
  });

  it('fails loudly when the tab does not exist yet', () => {
    const api = loadApi();
    const res = callDoGet<any>(api.sandbox, {
      action: 'appendSyncLog', payload: JSON.stringify({ row: run() }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/SyncLog/);
  });
});

describe('AC1: getSyncLog', () => {
  const rows = () => [
    stored({ run_id: 'schedule-1-1', started_at: '2026-09-24T00:17:03.000Z' }),
    stored({ run_id: 'schedule-3-1', started_at: '2026-09-24T13:17:09.000Z', status: 'partial' }),
    stored({ run_id: 'schedule-2-1', started_at: '2026-09-24T09:17:05.000Z' }),
  ];

  it('returns rows newest first by started_at, not by position', () => {
    const { sandbox } = loadApi({ syncLog: rows() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog' });
    expect(res.success).toBe(true);
    expect(res.data.map((r) => r.run_id)).toEqual(['schedule-3-1', 'schedule-2-1', 'schedule-1-1']);
    expect(res.data[0]).toMatchObject({ status: 'partial', n_seen: '2', window_end: '2026-09-25' });
  });

  it('honours limit', () => {
    const { sandbox } = loadApi({ syncLog: rows() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', limit: '1' });
    expect(res.data.map((r) => r.run_id)).toEqual(['schedule-3-1']);
  });

  it('answers [] for an empty tab', () => {
    const { sandbox } = loadApi({ syncLog: [] });
    expect(callDoGet<any[]>(sandbox, { action: 'getSyncLog' }).data).toEqual([]);
  });

  it.each(['0', '101', '2.5', 'ten'])('refuses limit=%s', (limit) => {
    const { sandbox } = loadApi({ syncLog: rows() });
    const res = callDoGet<any[]>(sandbox, { action: 'getSyncLog', limit });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/limit must be a whole number from 1 to 100/);
  });
});

describe('AC3: the sync’s writes hold the script lock', () => {
  it('takes and releases the lock for appendSyncLog', () => {
    const { lock, res } = append([], run());
    expect(res.success).toBe(true);
    expect(lock).toEqual({ acquired: 1, held: false });
  });

  it('releases the lock when the write throws', () => {
    const { lock, res } = append([], run({ status: 'nope' }));
    expect(res.success).toBe(false);
    expect(lock).toEqual({ acquired: 1, held: false });
  });

  it('takes the lock for upsertDailyHealth and upsertSyncedWorkout', () => {
    const api = loadApi({ dailyHealth: [] });
    callDoGet<any>(api.sandbox, {
      action: 'upsertDailyHealth',
      payload: JSON.stringify({ rows: [{ date: '2026-09-23', steps: '10' }], synced_at: '2026-09-24T09:17:04.512Z' }),
    });
    const synced = callDoGet<any>(api.sandbox, {
      action: 'upsertSyncedWorkout',
      payload: JSON.stringify({
        source: 'coros', source_activity_id: '1', last_written: null, raw_ref: 'r',
        synced_at: '2026-09-24T09:17:04.512Z',
        incoming: { date: '2026-09-23', type: 'hike', name: 'Hike' },
      }),
    });
    expect(synced.success).toBe(true);
    expect(api.lock).toEqual({ acquired: 2, held: false });
  });

  it('fails a write, writing nothing, when another caller holds the lock', () => {
    const api = loadApi({ syncLog: [] });
    api.lock.held = true;
    const res = callDoGet<any>(api.sandbox, {
      action: 'appendSyncLog', payload: JSON.stringify({ row: run() }),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Lock timeout/);
    expect(api.syncLogRows).toHaveLength(0);
  });

  it('does not lock reads', () => {
    const api = loadApi({ syncLog: [] });
    callDoGet<any>(api.sandbox, { action: 'getSyncLog' });
    expect(api.lock.acquired).toBe(0);
  });
});
