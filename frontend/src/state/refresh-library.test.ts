// #252 AC1, AC2, AC4, AC5 — refreshLibraryData and its throttle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effect } from '@preact/signals';

const fetchExercises = vi.fn();
const fetchTemplateRows = vi.fn();
const fetchLabels = vi.fn();
const appendLabels = vi.fn();
const isDemo = vi.fn(() => false);
vi.mock('../api/exercises-api', async (orig) => ({
  ...(await orig<object>()),
  fetchExercises: (t: string) => fetchExercises(t),
}));
vi.mock('../api/templates-api', async (orig) => ({
  ...(await orig<object>()),
  fetchTemplateRows: (t: string) => fetchTemplateRows(t),
}));
vi.mock('../api/labels-api', async (orig) => ({
  ...(await orig<object>()),
  fetchLabels: (t: string) => fetchLabels(t),
  appendLabels: (...a: unknown[]) => appendLabels(...a),
}));
vi.mock('../api/workouts-api', async (orig) => ({
  ...(await orig<object>()),
  fetchWorkouts: async () => [],
  fetchSets: async () => [],
}));
vi.mock('../api/demo-data', async (orig) => ({ ...(await orig<object>()), isDemo: () => isDemo() }));

import { refreshLibraryData, libraryRefresh, loadInitialData } from './actions';
import { exercises, templates, labels, loading, workouts, activeWorkoutId } from './store';
import { ReauthFailedError } from '../auth/reauth';

const ex = (id: string) => ({ id, name: id, sheetRow: 2 }) as never;
const lb = (id: string) => ({ id, name: id, sheetRow: 2 }) as never;
const row = (tid: string, exId: string) =>
  ({ template_id: tid, template_name: tid, order: 1, exercise_id: exId, exercise_name: exId, section: 'primary', sets: '3', reps: '8', sheetRow: 2 }) as never;
const snapshot = () =>
  `${(exercises.value[0] as { id: string }).id}/${(templates.value[0] as { id: string } | undefined)?.id}/${(labels.value[0] as { id: string }).id}`;

beforeEach(() => {
  for (const f of [fetchExercises, fetchTemplateRows, fetchLabels, appendLabels]) f.mockReset();
  isDemo.mockReturnValue(false);
  loading.value = false;
  exercises.value = [ex('old')];
  templates.value = [{ id: 'oldT' } as never];
  labels.value = [lb('old')];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('refreshLibraryData', () => {
  it('replaces all three together in one batch, without a spinner', async () => {
    fetchExercises.mockResolvedValue([ex('new')]);
    fetchTemplateRows.mockResolvedValue([row('newT', 'new')]);
    fetchLabels.mockResolvedValue([lb('new')]);
    const seen: string[] = [];
    const loadingSeen: boolean[] = [];
    const stop = effect(() => {
      seen.push(snapshot());
      loadingSeen.push(loading.value);
    });
    workouts.value = [];
    activeWorkoutId.value = 'keep';
    await refreshLibraryData('tok');
    stop();
    expect(fetchExercises).toHaveBeenCalledWith('tok');
    expect(fetchTemplateRows).toHaveBeenCalledWith('tok');
    expect(fetchLabels).toHaveBeenCalledWith('tok');
    expect(seen).toEqual(['old/oldT/old', 'new/newT/new']); // never a template ahead of its exercise
    expect(loadingSeen.every((l) => l === false)).toBe(true);
    expect(activeWorkoutId.value).toBe('keep');
  });

  it.each([
    ['exercises', () => fetchExercises],
    ['templates', () => fetchTemplateRows],
    ['labels', () => fetchLabels],
  ])('is all-or-nothing when the %s read fails, and only warns', async (_n, which) => {
    fetchExercises.mockResolvedValue([ex('new')]);
    fetchTemplateRows.mockResolvedValue([row('newT', 'new')]);
    fetchLabels.mockResolvedValue([lb('new')]);
    which().mockRejectedValue(new Error('500'));
    const before = [exercises.value, templates.value, labels.value];
    await refreshLibraryData('tok');
    expect([exercises.value, templates.value, labels.value]).toEqual(before);
    expect(exercises.value).toBe(before[0]);
    expect(console.warn).toHaveBeenCalled();
    expect(loading.value).toBe(false);
  });

  it('adds nothing of its own on a failed re-auth', async () => {
    fetchExercises.mockRejectedValue(new ReauthFailedError());
    fetchTemplateRows.mockResolvedValue([]);
    fetchLabels.mockResolvedValue([]);
    await refreshLibraryData('tok');
    expect(console.warn).not.toHaveBeenCalled();
    expect(snapshot()).toBe('old/oldT/old');
  });

  it.each(['exercises', 'templates', 'labels'] as const)(
    'discards the result whole when %s were replaced locally meanwhile',
    async (which) => {
      let done!: (v: unknown[]) => void;
      fetchExercises.mockReturnValue(which === 'exercises' ? new Promise((r) => (done = r)) : Promise.resolve([ex('new')]));
      fetchTemplateRows.mockReturnValue(which === 'templates' ? new Promise((r) => (done = r)) : Promise.resolve([]));
      fetchLabels.mockReturnValue(which === 'labels' ? new Promise((r) => (done = r)) : Promise.resolve([lb('new')]));
      const p = refreshLibraryData('tok');
      const local = [which === 'templates' ? ({ id: 'localT' } as never) : ex('local')];
      if (which === 'exercises') exercises.value = local;
      if (which === 'templates') templates.value = local;
      if (which === 'labels') labels.value = local;
      done([]);
      await p;
      expect(({ exercises, templates, labels })[which].value).toBe(local);
      if (which !== 'exercises') expect((exercises.value[0] as { id: string }).id).toBe('old');
    },
  );

  it('does nothing in demo mode', async () => {
    isDemo.mockReturnValue(true);
    const before = exercises.value;
    await refreshLibraryData('tok');
    expect(fetchExercises).not.toHaveBeenCalled();
    expect(exercises.value).toBe(before);
  });

  it('does nothing while the initial load is running', async () => {
    loading.value = true;
    await refreshLibraryData('tok');
    expect(fetchExercises).not.toHaveBeenCalled();
  });

  it('never runs the label bootstrap, even when Labels comes back empty', async () => {
    fetchExercises.mockResolvedValue([ex('new')]);
    fetchTemplateRows.mockResolvedValue([]);
    fetchLabels.mockResolvedValue([]);
    await refreshLibraryData('tok');
    expect(appendLabels).not.toHaveBeenCalled();
    expect(labels.value).toEqual([]);
  });
});

describe('libraryRefresh throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchExercises.mockResolvedValue([ex('new')]);
    fetchTemplateRows.mockResolvedValue([]);
    fetchLabels.mockResolvedValue([lb('new')]);
  });
  afterEach(() => vi.useRealTimers());

  it('drops a visible within 60 s of the initial load, and reads again after', async () => {
    await loadInitialData('tok');
    fetchExercises.mockClear();
    await libraryRefresh.run('tok');
    expect(fetchExercises).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    await libraryRefresh.run('tok');
    expect(fetchExercises).toHaveBeenCalledTimes(1);
    await libraryRefresh.run('tok'); // started under 60 s ago
    expect(fetchExercises).toHaveBeenCalledTimes(1);
  });
});
