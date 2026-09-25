// #157 AC3 — the SPA's read of SyncLog. The row mapping mirrors
// SYNC_LOG_FIELDS in apps-script/src/types.js (CLAUDE.md: change both
// together), and this test is what notices when only one side changed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sheetsGet = vi.fn();
vi.mock('./sheets', () => ({
  sheetsGet: (...args: unknown[]) => sheetsGet(...args),
  withReauth: (token: string, fn: (t: string) => unknown) => fn(token),
}));
vi.mock('./demo-data', () => ({ isDemo: () => false, demoSyncLog: vi.fn() }));

import { SYNC_LOG_FIELDS, rowToSyncLog, fetchSyncLog } from './sync-log-api';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SyncLog row mapping', () => {
  it('matches SYNC_LOG_FIELDS in apps-script/src/types.js, in order', () => {
    const src = readFileSync(resolve(__dirname, '../../../apps-script/src/types.js'), 'utf-8');
    const block = src.match(/var SYNC_LOG_FIELDS = \[([\s\S]*?)\];/)?.[1];
    expect(block, 'SYNC_LOG_FIELDS not found in types.js').toBeTruthy();
    const names = Array.from(block!.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
    expect([...SYNC_LOG_FIELDS]).toEqual(names);
    expect(SYNC_LOG_FIELDS).toHaveLength(14); // A:N
  });

  it('maps a row by position and fills a short row with blanks', () => {
    const e = rowToSyncLog(['schedule-1-1', '2026-09-24T12:17:04.000Z', '2026-09-24T12:17:51.000Z'], 5);
    expect(e.run_id).toBe('schedule-1-1');
    expect(e.started_at).toBe('2026-09-24T12:17:04.000Z');
    expect(e.status).toBe('');
    expect(e.notes).toBe('');
    expect(e.sheetRow).toBe(5);
  });
});

describe('fetchSyncLog', () => {
  beforeEach(() => sheetsGet.mockReset());

  it('reads SyncLog A2:N with the token and drops rows without a run_id', async () => {
    sheetsGet.mockResolvedValue([
      ['schedule-1-1', '2026-09-24T12:17:04.000Z', '', '', '', '3', '0', '0', '0', '0', '0', 'ok', '', ''],
      [],
      ['', 'stray'],
      ['schedule-2-1', '2026-09-24T18:17:09.000Z', '', '', '', '2', '0', '0', '0', '0', '1', 'partial', 'x', ''],
    ]);
    const rows = await fetchSyncLog('tok');
    expect(sheetsGet).toHaveBeenCalledWith('SyncLog!A2:N', 'tok');
    expect(rows.map((r) => [r.run_id, r.sheetRow])).toEqual([['schedule-1-1', 2], ['schedule-2-1', 5]]);
  });
});
