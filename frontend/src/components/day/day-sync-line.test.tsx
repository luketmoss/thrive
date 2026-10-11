// #409 AC1, AC2, AC4, AC5, AC6 — the Day view's sync line.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/preact';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const loadSyncLog = vi.fn();
const loadWithingsSyncLog = vi.fn();
const loadSyncRequests = vi.fn();
const requestSyncNow = vi.fn();
vi.mock('../../state/actions', () => ({
  loadSyncLog: (t: string) => loadSyncLog(t),
  loadWithingsSyncLog: (t: string) => loadWithingsSyncLog(t),
  loadSyncRequests: (t: string) => loadSyncRequests(t),
  requestSyncNow: (...a: unknown[]) => requestSyncNow(...a),
  healthRefresh: { invalidate: vi.fn() },
}));
let demo = false;
vi.mock('../../api/demo-data', async () => {
  const actual = await vi.importActual<typeof import('../../api/demo-data')>('../../api/demo-data');
  return { ...actual, isDemo: () => demo };
});

import { DaySyncLine, dayRequestEntries, DAY_FINAL_FOR_MS } from './day-sync-line';
import { useSyncNow, POLL_MS } from '../settings/sync-now';
import { syncRequests, syncAsk, demoSyncPressedAt, syncLog, withingsSyncLog } from '../../state/store';
import { rowToSyncRequest } from '../../api/sync-requests-api';
import { rowToSyncLog } from '../../api/sync-log-api';

const NOW = new Date('2026-10-02T13:12:00.000Z');
const HOUR = 3_600_000;

function Line() {
  const sync = useSyncNow('tok', 'me@example.com');
  return <DaySyncLine sync={sync} />;
}

function DemoLine() {
  const sync = useSyncNow(null, '');
  return <DaySyncLine sync={sync} />;
}

function req(vendor: string, status: string, extra: Partial<Record<string, string>> = {}, at = NOW) {
  return Object.assign(rowToSyncRequest([`sr_${vendor}`, vendor, at.toISOString(), '', status], 2), extra);
}
function logRow(hoursAgo: number, status = 'ok') {
  const t = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  return rowToSyncLog(['r' + hoursAgo, t, t, '', '', 0, 0, 0, 0, 0, 0, status, '', ''], 2);
}
const btn = () => screen.getByRole('button', { name: /Sync now|Syncing…/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  demo = false;
  for (const f of [loadSyncLog, loadWithingsSyncLog, loadSyncRequests, requestSyncNow]) f.mockReset();
  syncRequests.value = [];
  syncAsk.value = 'idle';
  demoSyncPressedAt.value = null;
  syncLog.value = { state: 'loaded', entries: [logRow(2)] };
  withingsSyncLog.value = { state: 'loaded', entries: [logRow(5)] };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Day sync line: the age (AC1)', () => {
  it('reads the older vendor and ticks once a minute', async () => {
    const { container } = render(<Line />);
    expect(container.querySelector('.day-sync-age')!.textContent).toBe('Synced 5 h ago');
    await act(() => { vi.advanceTimersByTime(60_000 * 61); });
    expect(container.querySelector('.day-sync-age')!.textContent).toBe('Synced 6 h ago');
  });

  it('names a failed vendor in words, and shows Checking and the unreadable state', () => {
    syncLog.value = { state: 'loaded', entries: [logRow(1, 'failed')] };
    const { container } = render(<Line />);
    const note = container.querySelector('.day-sync-note')!;
    expect(note.textContent).toBe('COROS last run failed');
    expect(note.className).toContain('sync-tone-danger');

    act(() => { syncLog.value = { state: 'loading' }; });
    expect(container.querySelector('.day-sync-age')!.textContent).toBe('Checking…');
    act(() => { syncLog.value = { state: 'error' }; });
    expect(container.querySelector('.day-sync-age')!.textContent).toBe("Couldn't read sync status");
    expect(container.querySelector('.day-sync-age')!.className).toContain('sync-tone-warning');
  });
});

describe('Day sync line: Sync now (AC2)', () => {
  it('calls the shared press for the vendors with no open request', () => {
    render(<Line />);
    fireEvent.click(btn());
    expect(requestSyncNow).toHaveBeenCalledWith('tok', 'me@example.com', ['coros', 'withings']);
  });

  it('is aria-disabled and reads Syncing… while both are open or asking, and a press does nothing', () => {
    syncRequests.value = [req('coros', 'requested'), req('withings', 'requested')];
    render(<Line />);
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().textContent).toBe('Syncing…');
    fireEvent.click(btn());
    expect(requestSyncNow).not.toHaveBeenCalled();

    cleanup();
    syncRequests.value = [];
    syncAsk.value = 'asking';
    const { container } = render(<Line />);
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('.day-sync-requests')!.textContent).toBe('Asking for a sync…');
  });

  it('shows each vendor line verbatim with its name, or one when identical, in full', () => {
    const cooldown = 'Not started: a COROS sync started a few minutes ago. Ask again after 6:42 PM.';
    syncRequests.value = [req('coros', 'skipped', { detail: cooldown }), req('withings', 'requested')];
    const { container } = render(<Line />);
    const rows = [...container.querySelectorAll('.day-sync-request')].map((e) => e.textContent);
    expect(rows[0]).toBe(`COROS: ${cooldown}`);
    expect(rows[1]).toMatch(/^Withings: Requested .*\. Waiting for it to start\.$/);

    cleanup();
    syncRequests.value = [req('coros', 'skipped', { detail: cooldown }), req('withings', 'skipped', { detail: cooldown })];
    const again = render(<Line />);
    expect([...again.container.querySelectorAll('.day-sync-request')].map((e) => e.textContent)).toEqual([cooldown]);
  });

  it('keeps a final message for 10 minutes, then only the age remains', async () => {
    const at = new Date(NOW.getTime() - 9 * 60_000);
    syncRequests.value = [req('coros', 'done', { detail: 'Finished.', finished_at: at.toISOString() }, at)];
    const { container } = render(<Line />);
    expect(container.querySelectorAll('.day-sync-request')).toHaveLength(1);
    await act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(container.querySelectorAll('.day-sync-request')).toHaveLength(0);
    expect(container.querySelector('.day-sync-age')!.textContent).toMatch(/^Synced /);
  });

  it('shows a failed ask in the line in words, never as a toast', () => {
    syncAsk.value = 'failed';
    const { container } = render(<Line />);
    expect(container.querySelector('.day-sync-requests')!.textContent).toContain("Couldn't ask for a sync");
    expect(container.querySelector('.day-sync-request')!.className).toContain('sync-tone-danger');
  });

  it('renders every closed state through the same code Settings uses', () => {
    for (const status of ['done', 'failed', 'skipped', 'expired', 'not_reported', 'cancelled']) {
      cleanup();
      syncRequests.value = [req('coros', status, { finished_at: NOW.toISOString() })];
      const { container } = render(<Line />);
      expect(container.querySelector('.day-sync-request')!.textContent!.length).toBeGreaterThan('COROS: '.length);
    }
  });
});

describe('dayRequestEntries', () => {
  it('keeps open lines and drops finals past the window; unknown time stays', () => {
    const open = { open: true, tone: 'neutral' as const, text: 'a' };
    const fin = { open: false, tone: 'neutral' as const, text: 'b' };
    expect(dayRequestEntries({ coros: open, withings: null }, 10 ** 12, () => 0)).toHaveLength(1);
    expect(dayRequestEntries({ coros: fin, withings: null }, DAY_FINAL_FOR_MS, () => 0)).toHaveLength(0);
    expect(dayRequestEntries({ coros: fin, withings: null }, DAY_FINAL_FOR_MS - 1, () => 0)).toHaveLength(1);
    expect(dayRequestEntries({ coros: fin, withings: null }, 10 ** 12, () => null)).toHaveLength(1);
  });
});

describe('Day sync line: one shared state, one poller (AC4)', () => {
  it('polls only while a request is open, 3 reads a poll, and stops on unmount', async () => {
    syncRequests.value = [req('coros', 'started', { workflow_run_id: '5', dispatched_at: NOW.toISOString() })];
    const { unmount } = render(<Line />);
    loadSyncRequests.mockClear(); loadSyncLog.mockClear(); loadWithingsSyncLog.mockClear();
    await act(() => { vi.advanceTimersByTime(POLL_MS * 2); });
    expect(loadSyncRequests).toHaveBeenCalledTimes(2);
    expect(loadSyncLog).toHaveBeenCalledTimes(2);
    expect(loadWithingsSyncLog).toHaveBeenCalledTimes(2);
    unmount();
    loadSyncRequests.mockClear();
    await act(() => { vi.advanceTimersByTime(POLL_MS * 3); });
    expect(loadSyncRequests).not.toHaveBeenCalled();
  });

  it('shares the request state across a remount, with one poll timer', async () => {
    syncRequests.value = [req('coros', 'requested')];
    const first = render(<Line />);
    first.unmount(); // navigated away mid-request
    const second = render(<Line />);
    expect(second.container.querySelector('.day-sync-request')!.textContent).toContain('Waiting for it to start');
    loadSyncRequests.mockClear();
    await act(() => { vi.advanceTimersByTime(POLL_MS); });
    expect(loadSyncRequests).toHaveBeenCalledTimes(1);
  });
});

describe('Day sync line: layout and accessibility (AC5)', () => {
  it('keeps the age out of the live region and the control in row 1, before the request rows', () => {
    syncRequests.value = [req('coros', 'requested'), req('withings', 'requested')];
    const { container } = render(<Line />);
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('.day-sync-age')).toBeNull();
    expect(region.contains(btn())).toBe(false);
    const row = container.querySelector('.day-sync-row')!;
    expect(row.contains(btn())).toBe(true);
    expect(row.contains(container.querySelector('.day-sync-age'))).toBe(true);
    expect(row.nextElementSibling).toBe(region);
  });

  it('has a text label beside an aria-hidden icon, and keeps focus when it becomes disabled', () => {
    const { container } = render(<Line />);
    expect(container.querySelector('.day-sync-btn svg')!.getAttribute('aria-hidden')).toBe('true');
    btn().focus();
    expect(document.activeElement).toBe(btn());
    act(() => { syncAsk.value = 'asking'; });
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(btn());
  });
});

describe('Day sync line CSS (AC5)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(dir, '../../global.css'), 'utf-8').replace(/\r\n/g, '\n');
  const css = raw.slice(raw.indexOf('/* ===== Day sync line (#409)')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`no rule for ${sel}`);
    return m[1];
  };

  it('is 44 px, a fixed minimum width so idle and busy match, and uses tokens only', () => {
    expect(rule('.day-sync-btn')).toMatch(/min-height:\s*44px/);
    expect(rule('.day-sync-btn')).toMatch(/min-width:\s*\d+px/);
    expect(rule('.day-sync-row')).toMatch(/min-height:\s*44px/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('stops the spinner under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.day-sync-busy \.day-sync-icon\s*\{\s*animation:\s*none/);
  });
});

describe('Day sync line: demo (AC6)', () => {
  it('walks the same states, reading and writing nothing', async () => {
    demo = true;
    demoSyncPressedAt.value = Date.now();
    const { container } = render(<DemoLine />);
    expect(container.querySelector('.day-sync-request')!.textContent).toContain('Waiting for it to start');
    await act(() => { vi.advanceTimersByTime(1500); });
    expect(container.querySelector('.day-sync-request')!.textContent).toContain('Started');
    await act(() => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('.day-sync-request')!.textContent).toMatch(/Finished .*: ok$/);
    expect(loadSyncRequests).not.toHaveBeenCalled();
    expect(loadSyncLog).not.toHaveBeenCalled();
  });
});
