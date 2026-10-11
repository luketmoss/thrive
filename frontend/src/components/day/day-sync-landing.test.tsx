// #409 AC3 — a landed sync refreshes the Day view, under the same hold as app.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/preact';

const healthRun = vi.fn(async (_t: string) => {});
const logsRun = vi.fn(async (_t: string) => {});
const logsInvalidate = vi.fn();
const workoutsRun = vi.fn(async (_t: string) => {});
const workoutsInvalidate = vi.fn();
const requestSyncNow = vi.fn();
vi.mock('../../state/actions', () => ({
  healthRefresh: { run: (t: string) => healthRun(t), invalidate: vi.fn(), markStarted: vi.fn() },
  journalRefresh: { run: vi.fn(async () => {}), markStarted: vi.fn() },
  syncLogsRefresh: { run: (t: string) => logsRun(t), invalidate: () => logsInvalidate() },
  workoutsRefresh: { run: (t: string) => workoutsRun(t), invalidate: () => workoutsInvalidate() },
  loadJournal: vi.fn(async () => {}),
  loadHealth: vi.fn(async () => {}),
  loadSyncLog: vi.fn(async () => {}),
  loadWithingsSyncLog: vi.fn(async () => {}),
  loadSyncRequests: vi.fn(async () => {}),
  requestSyncNow: (...a: unknown[]) => requestSyncNow(...a),
}));

const { DayScreen } = await import('./day-screen');
const { AuthContext } = await import('../../auth/auth-context');
const { replaceRoute } = await import('../../router/router');
const { syncRequests, syncAsk, demoSyncPressedAt, syncLog, withingsSyncLog, pendingSyncCount } = await import('../../state/store');
const { workoutsRefreshPending } = await import('../../state/refresh-hold');
const { rowToSyncRequest } = await import('../../api/sync-requests-api');

function row(vendor: string, status: string, extra: Partial<Record<string, string>> = {}) {
  return Object.assign(rowToSyncRequest([`sr_${vendor}`, vendor, new Date().toISOString(), '', status], 2), extra);
}

function mount() {
  act(() => { window.history.replaceState(null, '', '#/'); replaceRoute('#/'); });
  return render(
    <AuthContext.Provider value={{ token: 'tok', user: { email: 'me@example.com' } as never, isAuthenticated: true, login: () => {}, logout: () => {} }}>
      <DayScreen />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  for (const f of [healthRun, logsRun, logsInvalidate, workoutsRun, workoutsInvalidate, requestSyncNow]) f.mockClear();
  syncRequests.value = [];
  syncAsk.value = 'idle';
  demoSyncPressedAt.value = null;
  syncLog.value = { state: 'loaded', entries: [] };
  withingsSyncLog.value = { state: 'loaded', entries: [] };
  pendingSyncCount.value = 0;
  workoutsRefreshPending.value = false;
});
afterEach(() => cleanup());

describe('Day screen: the sync line (#409)', () => {
  it('sits in the header block under the sun line, above the week strip', () => {
    const { container } = mount();
    const header = container.querySelector('header.day-header')!;
    const line = header.querySelector('.day-sync')!;
    expect(line.previousElementSibling).toBe(header.querySelector('.day-sun'));
    expect(header.nextElementSibling).toBe(container.querySelector('.week-strip'));
    expect(logsRun).toHaveBeenCalledWith('tok'); // logs read on show
  });

  it('a Sync now press starts the shared flow', () => {
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: 'Sync now' }));
    expect(requestSyncNow).toHaveBeenCalledWith('tok', 'me@example.com', ['coros', 'withings']);
  });

  it('a request closing re-reads health, the sync logs and Workouts/Sets', async () => {
    syncRequests.value = [row('coros', 'started', { workflow_run_id: '5', dispatched_at: new Date().toISOString() })];
    mount();
    healthRun.mockClear(); logsRun.mockClear(); workoutsRun.mockClear();
    await act(() => { syncRequests.value = [row('coros', 'done', { detail: 'Finished: ok' })]; });
    expect(healthRun).toHaveBeenCalledWith('tok');
    expect(logsInvalidate).toHaveBeenCalled();
    expect(logsRun).toHaveBeenCalledWith('tok');
    expect(workoutsInvalidate).toHaveBeenCalled();
    expect(workoutsRun).toHaveBeenCalledWith('tok');
  });

  it('holds the Workouts/Sets refresh while the save queue is busy and flags it for when the hold lifts', async () => {
    pendingSyncCount.value = 2;
    syncRequests.value = [row('coros', 'started', { workflow_run_id: '5', dispatched_at: new Date().toISOString() })];
    mount();
    workoutsRun.mockClear();
    await act(() => { syncRequests.value = [row('coros', 'done', { detail: 'Finished: ok' })]; });
    expect(healthRun).toHaveBeenCalled(); // health is not held
    expect(workoutsRun).not.toHaveBeenCalled();
    expect(workoutsRefreshPending.value).toBe(true); // app.tsx's effect runs it once on lift
  });

  it('does not refresh on an ask that failed (nothing landed)', async () => {
    mount();
    workoutsRun.mockClear();
    await act(() => { syncAsk.value = 'failed'; });
    expect(workoutsRun).not.toHaveBeenCalled();
  });
});
