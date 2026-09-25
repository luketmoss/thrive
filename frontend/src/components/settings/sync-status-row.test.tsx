// #157 AC3/AC4 — what the Settings "Last synced" row renders in each state.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/preact';
import { h } from 'preact';

const loadSyncLog = vi.fn();
vi.mock('../../state/actions', () => ({ loadSyncLog: (t: string) => loadSyncLog(t) }));

import { SyncStatusRow } from './sync-status-row';
import { syncLog } from '../../state/store';
import type { SyncLogEntryWithRow } from '../../api/sync-log-api';

const NOW = new Date('2026-09-24T18:40:11.000Z');
const HOUR = 3600_000;

function run(hoursAgo: number, status = 'ok'): SyncLogEntryWithRow {
  const started = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  return {
    run_id: `r${hoursAgo}`, started_at: started, finished_at: started, window_start: '2026-09-14',
    window_end: '2026-09-25', n_seen: '3', n_new: '0', n_updated: '0', n_enriched: '0',
    n_fit_fetched: '0', n_errors: status === 'ok' ? '0' : '1', status,
    error_detail: status === 'ok' ? '' : 'CorosGrantDeadError: SECRET-DETAIL',
    notes: 'Unmatched strength session NOTE-TEXT', sheetRow: 2,
  };
}

function statusText(): string {
  return screen.getByRole('status').textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  loadSyncLog.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  syncLog.value = { state: 'idle' };
});

describe('AC3: the Last synced row', () => {
  it('reads SyncLog when it mounts with a token', () => {
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(loadSyncLog).toHaveBeenCalledWith('tok');
  });

  it('says Checking… while loading', () => {
    syncLog.value = { state: 'loading' };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(screen.getByText('Last synced')).toBeTruthy();
    expect(statusText()).toBe('Checking…');
  });

  it('shows the age of a fresh ok run, with no status words', () => {
    syncLog.value = { state: 'loaded', entries: [run(30), run(2.5)] };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toMatch(/^2 h ago · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(document.querySelector('.sync-tone-danger, .sync-tone-warning')).toBeNull();
  });

  it('handles an empty log and a failed read in words', () => {
    syncLog.value = { state: 'loaded', entries: [] };
    const { unmount } = render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toBe('No sync runs recorded yet');
    unmount();
    syncLog.value = { state: 'error' };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toBe("Couldn't read the sync log");
  });

  it('re-renders the age on a one-minute tick', () => {
    syncLog.value = { state: 'loaded', entries: [run(40 / 60)] };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toMatch(/^40 min ago/);
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(statusText()).toMatch(/^42 min ago/);
  });
});

describe('AC4: stale and failed are distinguishable, in words', () => {
  it('says the sync may have stopped past 16 h, in danger tone', () => {
    syncLog.value = { state: 'loaded', entries: [run(19.6)] };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toContain('19 h ago');
    const words = document.querySelector('.sync-status-words')!;
    expect(words.textContent).toBe('Sync may have stopped');
    expect(words.classList.contains('sync-tone-danger')).toBe(true);
  });

  it('says the last run failed, and when the last good one was', () => {
    syncLog.value = { state: 'loaded', entries: [run(10.2, 'ok'), run(1.2, 'failed')] };
    render(h(SyncStatusRow, { token: 'tok' }));
    const words = document.querySelector('.sync-status-words')!;
    expect(words.textContent).toBe('Last run failed');
    expect(words.classList.contains('sync-tone-danger')).toBe(true);
    expect(statusText()).toContain('Last successful run 10 h ago');
  });

  it('says a partial run finished with errors, in warning tone', () => {
    syncLog.value = { state: 'loaded', entries: [run(3, 'partial'), run(8, 'ok')] };
    render(h(SyncStatusRow, { token: 'tok' }));
    const words = document.querySelector('.sync-status-words')!;
    expect(words.textContent).toBe('Last run finished with errors');
    expect(words.classList.contains('sync-tone-warning')).toBe(true);
  });

  it('says there is no successful run when the log has none', () => {
    syncLog.value = { state: 'loaded', entries: [run(1, 'failed')] };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(statusText()).toContain('No successful run in the log');
  });

  it('never displays error_detail or notes', () => {
    syncLog.value = { state: 'loaded', entries: [run(20, 'failed')] };
    render(h(SyncStatusRow, { token: 'tok' }));
    expect(document.body.textContent).not.toContain('SECRET-DETAIL');
    expect(document.body.textContent).not.toContain('CorosGrantDeadError');
    expect(document.body.textContent).not.toContain('NOTE-TEXT');
  });
});
