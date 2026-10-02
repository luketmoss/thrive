// #315 AC1, AC3, AC4, AC5, AC6 — the Sync now button and the two vendor lines.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';

const loadSyncLog = vi.fn();
const loadWithingsSyncLog = vi.fn();
const loadSyncRequests = vi.fn();
const requestSyncNow = vi.fn();
const invalidate = vi.fn();
vi.mock('../../state/actions', () => ({
  loadSyncLog: (t: string) => loadSyncLog(t),
  loadWithingsSyncLog: (t: string) => loadWithingsSyncLog(t),
  loadSyncRequests: (t: string) => loadSyncRequests(t),
  requestSyncNow: (...a: unknown[]) => requestSyncNow(...a),
  healthRefresh: { invalidate: () => invalidate() },
}));
let demo = false;
vi.mock('../../api/demo-data', async () => {
  const actual = await vi.importActual<typeof import('../../api/demo-data')>('../../api/demo-data');
  return { ...actual, isDemo: () => demo };
});

import { useSyncNow, SyncNowButton, POLL_MS } from './sync-now';
import { syncRequests, syncAsk, demoSyncPressedAt, syncLog, withingsSyncLog } from '../../state/store';
import { rowToSyncRequest } from '../../api/sync-requests-api';

const NOW = new Date('2026-10-02T13:12:00.000Z');

function Harness({ token = 'tok' }: { token?: string | null }) {
  const sync = useSyncNow(token, 'me@example.com');
  return (
    <div>
      <SyncNowButton sync={sync} />
      <p data-testid="coros">{sync.lines.coros?.text ?? ''}</p>
      <p data-testid="withings">{sync.lines.withings?.text ?? ''}</p>
    </div>
  );
}

function row(vendor: string, status: string, extra: Partial<Record<string, string>> = {}) {
  const r = rowToSyncRequest([`sr_${vendor}`, vendor, NOW.toISOString(), '', status], 2);
  return Object.assign(r, extra);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  demo = false;
  for (const f of [loadSyncLog, loadWithingsSyncLog, loadSyncRequests, requestSyncNow, invalidate]) f.mockReset();
  syncRequests.value = [];
  syncAsk.value = 'idle';
  demoSyncPressedAt.value = null;
  syncLog.value = { state: 'loaded', entries: [] };
  withingsSyncLog.value = { state: 'loaded', entries: [] };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Sync now (real)', () => {
  it('a press asks for both vendors', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(requestSyncNow).toHaveBeenCalledWith('tok', 'me@example.com', ['coros', 'withings']);
  });

  it('a vendor with an open request is left out, and with both open the press is a no-op', () => {
    syncRequests.value = [row('coros', 'requested')];
    render(<Harness />);
    expect(screen.getByTestId('coros').textContent).toContain('Waiting for it to start');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(requestSyncNow).toHaveBeenLastCalledWith('tok', 'me@example.com', ['withings']);

    cleanup();
    requestSyncNow.mockReset();
    syncRequests.value = [row('coros', 'requested'), row('withings', 'started', { workflow_run_id: '5', dispatched_at: NOW.toISOString() })];
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Sync under way' });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(requestSyncNow).not.toHaveBeenCalled();
  });

  it('polls the sheet only while a request is open, and stops at a final state (and frees Day)', async () => {
    render(<Harness />);
    await act(() => { vi.advanceTimersByTime(POLL_MS * 3); });
    expect(loadSyncRequests).toHaveBeenCalledTimes(1); // the one read on opening

    cleanup();
    loadSyncRequests.mockReset();
    syncRequests.value = [row('coros', 'started', { workflow_run_id: '5', dispatched_at: NOW.toISOString() })];
    render(<Harness />);
    expect(loadSyncRequests).toHaveBeenCalledTimes(1);
    await act(() => { vi.advanceTimersByTime(POLL_MS * 2); });
    expect(loadSyncRequests).toHaveBeenCalledTimes(3);
    expect(loadSyncLog).toHaveBeenCalledTimes(2);
    expect(loadWithingsSyncLog).toHaveBeenCalledTimes(2);

    await act(() => { syncRequests.value = [row('coros', 'done', { detail: 'Finished: ok' })]; });
    expect(invalidate).toHaveBeenCalledTimes(1);
    await act(() => { vi.advanceTimersByTime(POLL_MS * 3); });
    expect(loadSyncRequests).toHaveBeenCalledTimes(3); // no more
  });

  it('does not poll while the page is hidden', async () => {
    syncRequests.value = [row('coros', 'requested')];
    render(<Harness />);
    loadSyncLog.mockReset();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(() => { vi.advanceTimersByTime(POLL_MS * 2); });
    expect(loadSyncLog).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('says so in words when the append failed, and the button works again', () => {
    syncAsk.value = 'failed';
    render(<Harness />);
    expect(screen.getByTestId('coros').textContent).toContain("Couldn't ask for a sync");
    expect(screen.getByTestId('withings').textContent).toContain("Couldn't ask for a sync");
    expect(screen.getByRole('button', { name: 'Sync now' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('shows Asking while the append is in flight', () => {
    syncAsk.value = 'asking';
    render(<Harness />);
    expect(screen.getByTestId('coros').textContent).toBe('Asking for a sync…');
    expect(screen.getByRole('button', { name: 'Asking…' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Sync now (demo)', () => {
  it('walks through its states on a fake clock and reads nothing from the sheet', async () => {
    demo = true;
    demoSyncPressedAt.value = Date.now();
    render(<Harness token={null} />);
    expect(screen.getByTestId('coros').textContent).toContain('Waiting for it to start');
    await act(() => { vi.advanceTimersByTime(1500); }); // ~1.5 fake minutes
    expect(screen.getByTestId('coros').textContent).toContain('Started');
    await act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('coros').textContent).toMatch(/^Finished .*: ok$/);
    expect(loadSyncRequests).not.toHaveBeenCalled();
    expect(loadSyncLog).not.toHaveBeenCalled();
  });
});
