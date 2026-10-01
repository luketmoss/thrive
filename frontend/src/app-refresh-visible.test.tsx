// #249 AC1 (focus), AC3 — the app-level guard for the visibility refresh.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';

const run = vi.fn();
const libRun = vi.fn();
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
  libraryRefresh: { run: (t: string) => libRun(t), markStarted: vi.fn() },
}));

const { App } = await import('./app');
const { loading, pendingSyncCount, isSyncing, workouts, exercises } = await import('./state/store');

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
  libRun.mockReset();
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

describe('library refresh on visible (#252)', () => {
  it('runs with the token on a normal screen, beside the workouts loader', () => {
    render(<App />);
    visible();
    expect(libRun).toHaveBeenCalledWith('tok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['#/templates/new', '#/templates/abc/edit'])(
    'holds on %s and runs once on lift, while workouts is not held',
    (hash) => {
      go(hash);
      render(<App />);
      visible();
      visible();
      expect(libRun).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(2); // the workouts loader has no template hold
      go('#/templates');
      expect(libRun).toHaveBeenCalledTimes(1);
      go('#/exercises');
      expect(libRun).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['#/workout/new', '#/history/abc/edit', '#/workout/abc'])('holds on %s', (hash) => {
    go(hash);
    render(<App />);
    visible();
    expect(libRun).not.toHaveBeenCalled();
  });

  it.each(['#/exercises', '#/settings/labels'])('is not held on %s', (hash) => {
    go(hash);
    render(<App />);
    visible();
    expect(libRun).toHaveBeenCalledTimes(1);
  });

  it('holds while the queue has entries, then runs once', () => {
    pendingSyncCount.value = 1;
    render(<App />);
    visible();
    visible();
    expect(libRun).not.toHaveBeenCalled();
    act(() => {
      pendingSyncCount.value = 0;
    });
    expect(libRun).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on the same row when an exercise is inserted above it', () => {
    exercises.value = [
      { id: 'e1', name: 'Squat', tags: '', notes: '', sheetRow: 2 },
      { id: 'e2', name: 'Press', tags: '', notes: '', sheetRow: 3 },
    ] as never;
    go('#/exercises');
    const { container } = render(<App />);
    const row = () =>
      Array.from(container.querySelectorAll<HTMLElement>('.exercise-list-item-header')).find((c) =>
        c.textContent?.includes('Press'),
      )!;
    const target = row();
    target.focus();
    expect(document.activeElement).toBe(target);
    act(() => {
      exercises.value = [{ id: 'e0', name: 'Deadlift', tags: '', notes: '', sheetRow: 4 }, ...exercises.value] as never;
    });
    expect(container.textContent).toContain('Deadlift');
    expect(row()).toBe(target);
    expect(document.activeElement).toBe(target);
  });
});
