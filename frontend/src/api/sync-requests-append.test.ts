// #315 AC1 — the SPA's append (A:E only, one call) and the read.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sheetsGet = vi.fn();
const sheetsAppend = vi.fn();
let demo = false;
vi.mock('./sheets', () => ({
  sheetsGet: (...a: unknown[]) => sheetsGet(...a),
  sheetsAppend: (...a: unknown[]) => sheetsAppend(...a),
  withReauth: (token: string, fn: (t: string) => unknown) => fn(token),
}));
vi.mock('./demo-data', async () => {
  const actual = await vi.importActual<typeof import('./demo-data')>('./demo-data');
  return { ...actual, isDemo: () => demo };
});

import { appendSyncRequests, fetchSyncRequests, newSyncRequestId } from './sync-requests-api';

beforeEach(() => {
  demo = false;
  sheetsGet.mockReset();
  sheetsAppend.mockReset();
  sheetsAppend.mockResolvedValue(undefined);
});

describe('appendSyncRequests', () => {
  it('ids are sr_ + 8 hex', () => expect(newSyncRequestId()).toMatch(/^sr_[0-9a-f]{8}$/));

  it('appends one A:E row per vendor in a single call, status requested, never F:I', async () => {
    const now = new Date('2026-10-02T13:12:00.000Z');
    await appendSyncRequests(['coros', 'withings'], 'me@example.com', 'tok', now);
    expect(sheetsAppend).toHaveBeenCalledTimes(1);
    const [range, values, token] = sheetsAppend.mock.calls[0];
    expect(range).toBe('SyncRequests!A:E');
    expect(token).toBe('tok');
    expect(values).toHaveLength(2);
    expect(values[0]).toEqual([expect.stringMatching(/^sr_[0-9a-f]{8}$/), 'coros', '2026-10-02T13:12:00.000Z', 'me@example.com', 'requested']);
    expect(values[1][1]).toBe('withings');
    expect(values[0][0]).not.toBe(values[1][0]);
  });

  it('writes nothing for no vendors, or in demo mode', async () => {
    await appendSyncRequests([], 'a', 't');
    demo = true;
    await appendSyncRequests(['coros'], 'a', 't');
    expect(sheetsAppend).not.toHaveBeenCalled();
  });

  it('a failing append rejects', async () => {
    sheetsAppend.mockRejectedValue(new Error('offline'));
    await expect(appendSyncRequests(['coros'], '', 't')).rejects.toThrow('offline');
  });
});

describe('fetchSyncRequests', () => {
  it('reads A2:I with sheet rows from 2, dropping rows without an id', async () => {
    sheetsGet.mockResolvedValue([['sr_1', 'coros', '2026-10-02T13:12:00.000Z', '', 'requested'], [], ['sr_2', 'withings']]);
    const rows = await fetchSyncRequests('tok');
    expect(sheetsGet).toHaveBeenCalledWith('SyncRequests!A2:I', 'tok');
    expect(rows.map((r) => [r.request_id, r.sheetRow])).toEqual([['sr_1', 2], ['sr_2', 4]]);
  });

  it('demo mode has no sheet rows and makes no call', async () => {
    demo = true;
    expect(await fetchSyncRequests('tok')).toEqual([]);
    expect(sheetsGet).not.toHaveBeenCalled();
  });
});
