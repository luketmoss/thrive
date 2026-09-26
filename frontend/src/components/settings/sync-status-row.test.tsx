// #157 AC3/AC4, #210 AC1-AC3 — what the Settings "last synced" rows render in
// each state, for COROS and Withings independently.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/preact';
import { h } from 'preact';

const loadSyncLog = vi.fn();
const loadWithingsSyncLog = vi.fn();
vi.mock('../../state/actions', () => ({
  loadSyncLog: (t: string) => loadSyncLog(t),
  loadWithingsSyncLog: (t: string) => loadWithingsSyncLog(t),
}));

import { CorosSyncStatusRow, WithingsSyncStatusRow } from './sync-status-row';
import { syncLog, withingsSyncLog } from '../../state/store';
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

function statusRegions(): HTMLElement[] {
  return screen.getAllByRole('status');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  loadSyncLog.mockReset();
  loadWithingsSyncLog.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  syncLog.value = { state: 'idle' };
  withingsSyncLog.value = { state: 'idle' };
});

describe('AC1: each row reads its own log and names itself', () => {
  it('reads SyncLog and WithingsSyncLog independently when each mounts with a token', () => {
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    expect(loadSyncLog).toHaveBeenCalledWith('tok');
    expect(loadWithingsSyncLog).toHaveBeenCalledWith('tok');
  });

  it('labels each row and names its status region by that label (aria-labelledby)', () => {
    syncLog.value = { state: 'loaded', entries: [run(2)] };
    withingsSyncLog.value = { state: 'loaded', entries: [run(1)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));

    const corosLabel = screen.getByText('COROS last synced');
    const withingsLabel = screen.getByText('Withings last synced');
    const [corosStatus, withingsStatus] = statusRegions();

    expect(corosStatus.getAttribute('aria-labelledby')).toBe(corosLabel.id);
    expect(withingsStatus.getAttribute('aria-labelledby')).toBe(withingsLabel.id);
    expect(corosLabel.id).not.toBe(withingsLabel.id);
    expect(corosStatus.textContent).toContain('2 h ago');
    expect(withingsStatus.textContent).toContain('1 h ago');
  });

  it('says Checking… while loading, independently per row', () => {
    syncLog.value = { state: 'loading' };
    withingsSyncLog.value = { state: 'idle' };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const [corosStatus, withingsStatus] = statusRegions();
    expect(corosStatus.textContent).toBe('Checking…');
    expect(withingsStatus.textContent).toBe('Checking…');
  });

  it('shows the age of a fresh ok run, with no status words', () => {
    syncLog.value = { state: 'loaded', entries: [run(30), run(2.5)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    expect(statusRegions()[0].textContent).toMatch(/^2 h ago · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(document.querySelector('.sync-tone-danger, .sync-tone-warning')).toBeNull();
  });

  it('handles an empty log and a failed read in words, per row', () => {
    syncLog.value = { state: 'loaded', entries: [] };
    withingsSyncLog.value = { state: 'error' };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const [corosStatus, withingsStatus] = statusRegions();
    expect(corosStatus.textContent).toBe('No sync runs recorded yet');
    expect(withingsStatus.textContent).toBe("Couldn't read the sync log");
  });

  it('re-renders the age on a one-minute tick', () => {
    syncLog.value = { state: 'loaded', entries: [run(40 / 60)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    expect(statusRegions()[0].textContent).toMatch(/^40 min ago/);
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(statusRegions()[0].textContent).toMatch(/^42 min ago/);
  });
});

describe('AC2: neither sync can mask the other', () => {
  it('COROS stale (20 h) + Withings fresh ok (1 h): only the COROS row carries the words', () => {
    syncLog.value = { state: 'loaded', entries: [run(20)] };
    withingsSyncLog.value = { state: 'loaded', entries: [run(1)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const [corosStatus, withingsStatus] = statusRegions();

    expect(corosStatus.textContent).toContain('Sync may have stopped');
    expect(corosStatus.querySelector('.sync-tone-danger')).toBeTruthy();

    expect(withingsStatus.textContent).toContain('1 h ago');
    expect(withingsStatus.textContent).not.toContain('Sync may have stopped');
    expect(withingsStatus.querySelector('.sync-tone-warning, .sync-tone-danger')).toBeNull();
  });

  it('Withings stale (15 h, past its 14 h threshold) + COROS fresh ok (1 h): the reverse', () => {
    syncLog.value = { state: 'loaded', entries: [run(1)] };
    withingsSyncLog.value = { state: 'loaded', entries: [run(15)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const [corosStatus, withingsStatus] = statusRegions();

    expect(withingsStatus.textContent).toContain('Sync may have stopped');
    expect(withingsStatus.querySelector('.sync-tone-danger')).toBeTruthy();

    expect(corosStatus.textContent).toContain('1 h ago');
    expect(corosStatus.textContent).not.toContain('Sync may have stopped');
    expect(corosStatus.querySelector('.sync-tone-warning, .sync-tone-danger')).toBeNull();
  });

  it('15 h is fresh for COROS (16 h threshold) but stale for Withings (14 h threshold)', () => {
    syncLog.value = { state: 'loaded', entries: [run(15)] };
    withingsSyncLog.value = { state: 'loaded', entries: [run(15)] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const [corosStatus, withingsStatus] = statusRegions();
    expect(corosStatus.textContent).not.toContain('Sync may have stopped');
    expect(withingsStatus.textContent).toContain('Sync may have stopped');
  });

  it('says the last run failed, and when the last good one was', () => {
    syncLog.value = { state: 'loaded', entries: [run(10.2, 'ok'), run(1.2, 'failed')] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    const status = statusRegions()[0];
    const words = status.querySelector('.sync-status-words')!;
    expect(words.textContent).toBe('Last run failed');
    expect(words.classList.contains('sync-tone-danger')).toBe(true);
    expect(status.textContent).toContain('Last successful run 10 h ago');
  });

  it('says a partial run finished with errors, in warning tone', () => {
    syncLog.value = { state: 'loaded', entries: [run(3, 'partial'), run(8, 'ok')] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    const words = statusRegions()[0].querySelector('.sync-status-words')!;
    expect(words.textContent).toBe('Last run finished with errors');
    expect(words.classList.contains('sync-tone-warning')).toBe(true);
  });

  it('says there is no successful run when the log has none', () => {
    syncLog.value = { state: 'loaded', entries: [run(1, 'failed')] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    expect(statusRegions()[0].textContent).toContain('No successful run in the log');
  });

  it('never displays error_detail or notes', () => {
    syncLog.value = { state: 'loaded', entries: [run(20, 'failed')] };
    render(h(CorosSyncStatusRow, { token: 'tok' }));
    expect(document.body.textContent).not.toContain('SECRET-DETAIL');
    expect(document.body.textContent).not.toContain('CorosGrantDeadError');
    expect(document.body.textContent).not.toContain('NOTE-TEXT');
  });
});

describe('AC3: a missing Withings tab reads as "not set up", not as an error', () => {
  it('shows "Not set up yet" in neutral text, not the warning tone', () => {
    withingsSyncLog.value = { state: 'not-set-up' };
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const status = statusRegions()[0];
    expect(status.textContent).toBe('Not set up yet');
    expect(status.querySelector('.sync-tone-warning, .sync-tone-danger')).toBeNull();
  });

  it('still shows the warning tone for any other read failure', () => {
    withingsSyncLog.value = { state: 'error' };
    render(h(WithingsSyncStatusRow, { token: 'tok' }));
    const status = statusRegions()[0];
    expect(status.textContent).toBe("Couldn't read the sync log");
    expect(status.querySelector('.sync-tone-warning')).toBeTruthy();
  });
});
