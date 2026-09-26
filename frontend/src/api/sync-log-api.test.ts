// #157 AC3 — the SPA's read of SyncLog. The row mapping mirrors
// SYNC_LOG_FIELDS in apps-script/src/types.js (CLAUDE.md: change both
// together), and this test is what notices when only one side changed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sheetsGet = vi.fn();
// A plain (synchronous) mock class, not `vi.importActual`'s real one: an
// async mock factory races the first test in the file (a vitest quirk), so
// SheetsApiError.mockRejectedValue would sometimes reach the assertion
// unconverted. This mirrors the real class exactly, so `instanceof` still
// works. Declared inside the (hoisted) factory — a top-level const here
// would be hoisted past too, per vi.mock's own rule.
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
    sheetsGet: (...args: unknown[]) => sheetsGet(...args),
    withReauth: (token: string, fn: (t: string) => unknown) => fn(token),
  };
});
vi.mock('./demo-data', () => ({ isDemo: () => false, demoSyncLog: vi.fn(), demoWithingsSyncLog: vi.fn() }));

import { SheetsApiError as MockSheetsApiError } from './sheets';
import { SyncLogNotSetUpError } from './sync-log-errors';
import { SYNC_LOG_FIELDS, rowToSyncLog, fetchSyncLog, fetchWithingsSyncLog } from './sync-log-api';

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

// #200, #210: WithingsSyncLog reuses SyncLog's A:N layout and mapping, on its own tab.
describe('fetchWithingsSyncLog', () => {
  beforeEach(() => sheetsGet.mockReset());

  it('reads WithingsSyncLog A2:N with the token and drops rows without a run_id', async () => {
    sheetsGet.mockResolvedValue([
      ['withings-1-1', '2026-09-24T12:17:04.000Z', '', '', '', '3', '0', '0', '0', '0', '0', 'ok', '', ''],
      [],
    ]);
    const rows = await fetchWithingsSyncLog('tok');
    expect(sheetsGet).toHaveBeenCalledWith('WithingsSyncLog!A2:N', 'tok');
    expect(rows.map((r) => [r.run_id, r.sheetRow])).toEqual([['withings-1-1', 2]]);
  });

  it('throws SyncLogNotSetUpError when the tab does not exist yet (AC3)', async () => {
    // *Once, not a standing mockRejectedValue: chained with the tests above and
    // below in one describe, a persistent rejection here was seen to leak into
    // a later assertion's rejection under Vitest's mock-reset timing.
    sheetsGet.mockRejectedValueOnce(
      new MockSheetsApiError(400, '{"error":{"code":400,"message":"Unable to parse range: WithingsSyncLog!A2:N"}}'),
    );
    await expect(fetchWithingsSyncLog('tok')).rejects.toThrow(SyncLogNotSetUpError);
  });

  it('leaves any other failure as-is, not as SyncLogNotSetUpError', async () => {
    sheetsGet.mockRejectedValueOnce(new MockSheetsApiError(500, 'Internal error'));
    let caught: unknown;
    try {
      await fetchWithingsSyncLog('tok');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MockSheetsApiError);
    expect(caught).not.toBeInstanceOf(SyncLogNotSetUpError);
  });
});
