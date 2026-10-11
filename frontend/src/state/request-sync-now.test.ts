// #410 AC1, AC3 — requestSyncNow: append first, the button back to idle as
// before, then the dispatch call, then one re-read when it settles. Any failure
// of the call is silent on screen and one console.warn in the log.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const appendSyncRequests = vi.fn();
const fetchSyncRequests = vi.fn();
const requestSync = vi.fn();
let demo = false;

vi.mock('../api/sync-requests-api', async () => {
  const actual = await vi.importActual<typeof import('../api/sync-requests-api')>('../api/sync-requests-api');
  return {
    ...actual,
    appendSyncRequests: (...a: unknown[]) => appendSyncRequests(...a),
    fetchSyncRequests: (...a: unknown[]) => fetchSyncRequests(...a),
  };
});
vi.mock('../api/thrive-api', () => ({ requestSync: (...a: unknown[]) => requestSync(...a) }));
vi.mock('../api/demo-data', async () => {
  const actual = await vi.importActual<typeof import('../api/demo-data')>('../api/demo-data');
  return { ...actual, isDemo: () => demo };
});

import { requestSyncNow } from './actions';
import { syncAsk, demoSyncPressedAt, syncRequests } from './store';

const TOKEN = 'ya29.SPA-token';
const ROWS = [
  ['sr_0000c0c0', 'coros', '2026-10-02T19:00:00.000Z', 'me@example.com', 'requested'],
  ['sr_0000a1a1', 'withings', '2026-10-02T19:00:00.000Z', 'me@example.com', 'requested'],
];

let events: string[];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  demo = false;
  events = [];
  syncAsk.value = 'idle';
  syncRequests.value = [];
  demoSyncPressedAt.value = null;
  appendSyncRequests.mockReset().mockImplementation(async () => { events.push(`append:${syncAsk.value}`); return ROWS; });
  fetchSyncRequests.mockReset().mockImplementation(async () => { events.push('read'); return []; });
  requestSync.mockReset().mockImplementation(async () => { events.push(`call:${syncAsk.value}`); return { ok: true }; });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requestSyncNow (#410)', () => {
  it('appends while asking, returns to idle, calls with the appended ids, and re-reads when it settles', async () => {
    await requestSyncNow(TOKEN, 'me@example.com', ['coros', 'withings']);
    expect(appendSyncRequests).toHaveBeenCalledWith(['coros', 'withings'], 'me@example.com', TOKEN);
    expect(requestSync).toHaveBeenCalledWith(['sr_0000c0c0', 'sr_0000a1a1'], TOKEN);
    // The button is idle before the call is made; the last read follows it.
    expect(events).toEqual(['append:asking', 'call:idle', 'read', 'read']);
    expect(syncAsk.value).toBe('idle');
    expect(warn).not.toHaveBeenCalled();
  });

  it('re-reads after the call settles, not before', async () => {
    let settle!: (v: unknown) => void;
    requestSync.mockImplementation(() => new Promise((r) => { settle = r; }));
    const pending = requestSyncNow(TOKEN, '', ['coros']);
    await vi.waitFor(() => expect(fetchSyncRequests).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSyncRequests).toHaveBeenCalledTimes(1);
    settle({ ok: true });
    await pending;
    expect(fetchSyncRequests).toHaveBeenCalledTimes(2);
  });

  it.each(['token_forbidden', 'token_invalid', 'network', 'timeout', 'http_500', 'not_found', 'failed'])(
    'a failed call (%s) is silent on screen: idle, re-read, one warning naming the kind, no token',
    async (kind) => {
      requestSync.mockResolvedValue({ ok: false, kind });
      await requestSyncNow(TOKEN, 'me@example.com', ['coros']);
      expect(syncAsk.value).toBe('idle');
      expect(fetchSyncRequests).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(kind);
      expect(line).not.toContain(TOKEN);
    });

  it('with no API URL nothing was called, so it reads once, as before, and warns once', async () => {
    requestSync.mockResolvedValue({ ok: false, kind: 'no_api_url' });
    await requestSyncNow(TOKEN, '', ['coros']);
    expect(fetchSyncRequests).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('no_api_url');
    expect(syncAsk.value).toBe('idle');
  });

  it('a failed append shows failed as before, and makes no call', async () => {
    appendSyncRequests.mockRejectedValue(new Error('offline'));
    await requestSyncNow(TOKEN, '', ['coros']);
    expect(syncAsk.value).toBe('failed');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('demo mode makes no call and starts the simulated flow, as before', async () => {
    demo = true;
    await requestSyncNow(TOKEN, '', ['coros']);
    expect(requestSync).not.toHaveBeenCalled();
    expect(appendSyncRequests).not.toHaveBeenCalled();
    expect(syncAsk.value).toBe('idle');
    expect(demoSyncPressedAt.value).toEqual(expect.any(Number));
  });
});
