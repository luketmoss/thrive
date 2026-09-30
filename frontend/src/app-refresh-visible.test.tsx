// #249 AC1 (focus), AC3 — the app-level guard for the visibility refresh.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';

const run = vi.fn();
vi.mock('./auth/auth-provider', () => ({
  AuthProvider: ({ children }: { children: ComponentChildren }) => children,
}));
vi.mock('./auth/auth-context', () => ({
  useAuth: () => ({ token: 'tok', user: null, isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));
vi.mock('./state/actions', async (orig) => ({
  ...(await orig<object>()),
  loadInitialData: vi.fn(),
  workoutsRefresh: { run: (t: string) => run(t), markStarted: vi.fn() },
}));

const { App } = await import('./app');
const { loading, pendingSyncCount, isSyncing, workouts } = await import('./state/store');

function visible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  run.mockReset();
  loading.value = false;
  pendingSyncCount.value = 0;
  isSyncing.value = false;
  go('#/activities');
});
afterEach(() => cleanup());

describe('refresh on visible (#249)', () => {
  it('refreshes with the token on a normal screen', () => {
    render(<App />);
    visible();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('tok');
  });

  it.each(['#/workout/new', '#/workout/new?plan=2026-09-24', '#/history/abc/edit'])(
    'holds while on %s, and runs once when the user leaves',
    (hash) => {
      go(hash);
      render(<App />);
      visible();
      visible();
      expect(run).not.toHaveBeenCalled();
      go('#/activities');
      expect(run).toHaveBeenCalledTimes(1);
      go('#/exercises');
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it('holds on an active workout route', () => {
    go('#/workout/abc');
    render(<App />);
    visible();
    expect(run).not.toHaveBeenCalled();
  });

  it('holds while the offline queue has entries, then runs once when it empties', () => {
    pendingSyncCount.value = 2;
    render(<App />);
    visible();
    visible();
    expect(run).not.toHaveBeenCalled();
    act(() => {
      pendingSyncCount.value = 0;
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('holds while the queue is flushing', () => {
    isSyncing.value = true;
    render(<App />);
    visible();
    expect(run).not.toHaveBeenCalled();
    act(() => {
      isSyncing.value = false;
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing on lift when nothing was held', () => {
    render(<App />);
    go('#/workout/new');
    go('#/activities');
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps focus on the same card when a workout is inserted above it', () => {
    const base = { type: 'weight', date: '2026-09-20', sheetRow: 2 };
    workouts.value = [
      { ...base, id: 'a', name: 'Alpha' },
      { ...base, id: 'b', name: 'Beta', sheetRow: 3 },
    ] as never;
    const { container } = render(<App />);
    const beta = () =>
      Array.from(container.querySelectorAll<HTMLElement>('.workout-card')).find((c) =>
        c.textContent?.includes('Beta'),
      )!;
    const target = beta();
    target.focus();
    expect(document.activeElement).toBe(target);
    act(() => {
      workouts.value = [{ ...base, id: 'new', name: 'Gamma', date: '2026-09-21' }, ...workouts.value] as never;
    });
    expect(container.textContent).toContain('Gamma');
    expect(beta()).toBe(target);
    expect(document.activeElement).toBe(target);
  });
});
