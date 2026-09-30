// #249 AC1, AC3, AC4, AC5 — refreshWorkouts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effect } from '@preact/signals';

const fetchWorkouts = vi.fn();
const fetchSets = vi.fn();
const isDemo = vi.fn(() => false);
vi.mock('../api/workouts-api', async (orig) => ({
  ...(await orig<object>()),
  fetchWorkouts: (t: string) => fetchWorkouts(t),
  fetchSets: (t: string) => fetchSets(t),
}));
vi.mock('../api/demo-data', async (orig) => ({ ...(await orig<object>()), isDemo: () => isDemo() }));

import { refreshWorkouts } from './actions';
import { workouts, sets, loading, exercises, activeWorkoutId } from './store';
import { ReauthFailedError } from '../auth/reauth';

const w = (id: string) => ({ id, sheetRow: 2 }) as never;
const s = (id: string) => ({ workout_id: id, sheetRow: 2 }) as never;
const first = () => `${(workouts.value[0] as { id: string }).id}/${(sets.value[0] as { workout_id: string }).workout_id}`;

beforeEach(() => {
  fetchWorkouts.mockReset();
  fetchSets.mockReset();
  isDemo.mockReturnValue(false);
  loading.value = false;
  workouts.value = [w('old')];
  sets.value = [s('old')];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('refreshWorkouts', () => {
  it('replaces workouts and sets together in one batch, without a spinner', async () => {
    fetchWorkouts.mockResolvedValue([w('new')]);
    fetchSets.mockResolvedValue([s('new')]);
    const seen: string[] = [];
    const loadingSeen: boolean[] = [];
    const stop = effect(() => {
      seen.push(first());
      loadingSeen.push(loading.value);
    });
    exercises.value = [];
    activeWorkoutId.value = 'keep';
    await refreshWorkouts('tok');
    stop();
    expect(fetchWorkouts).toHaveBeenCalledWith('tok');
    expect(fetchSets).toHaveBeenCalledWith('tok');
    expect(seen).toEqual(['old/old', 'new/new']); // never new workouts with old sets
    expect(loadingSeen.every((l) => l === false)).toBe(true);
    expect(activeWorkoutId.value).toBe('keep');
  });

  it('is all-or-nothing when either read fails, and only warns', async () => {
    const before = workouts.value;
    fetchWorkouts.mockResolvedValue([w('new')]);
    fetchSets.mockRejectedValue(new Error('500'));
    await refreshWorkouts('tok');
    expect(workouts.value).toBe(before);
    expect(first()).toBe('old/old');
    expect(console.warn).toHaveBeenCalled();
    expect(loading.value).toBe(false);
  });

  it('adds nothing of its own on a failed re-auth', async () => {
    fetchWorkouts.mockRejectedValue(new ReauthFailedError());
    fetchSets.mockResolvedValue([]);
    await refreshWorkouts('tok');
    expect(console.warn).not.toHaveBeenCalled();
    expect(first()).toBe('old/old');
  });

  it('discards the result whole when workouts were replaced locally meanwhile', async () => {
    let done!: (v: unknown[]) => void;
    fetchWorkouts.mockReturnValue(new Promise((r) => (done = r)));
    fetchSets.mockResolvedValue([s('new')]);
    const p = refreshWorkouts('tok');
    const local = [w('local')];
    workouts.value = local;
    done([w('new')]);
    await p;
    expect(workouts.value).toBe(local);
    expect(first()).toBe('local/old');
  });

  it('discards the result whole when sets were replaced locally meanwhile', async () => {
    let done!: (v: unknown[]) => void;
    fetchSets.mockReturnValue(new Promise((r) => (done = r)));
    fetchWorkouts.mockResolvedValue([w('new')]);
    const p = refreshWorkouts('tok');
    const local = [s('local')];
    sets.value = local;
    done([s('new')]);
    await p;
    expect(sets.value).toBe(local);
    expect(first()).toBe('old/local');
  });

  it('does nothing in demo mode', async () => {
    isDemo.mockReturnValue(true);
    const before = workouts.value;
    await refreshWorkouts('tok');
    expect(fetchWorkouts).not.toHaveBeenCalled();
    expect(workouts.value).toBe(before);
  });

  it('does nothing while the initial load is still running', async () => {
    loading.value = true;
    await refreshWorkouts('tok');
    expect(fetchWorkouts).not.toHaveBeenCalled();
  });
});
