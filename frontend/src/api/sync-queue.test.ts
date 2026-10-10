import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@preact/signals';

// Mock store signals before importing sync-queue
vi.mock('../state/store', () => ({
  pendingSyncCount: signal(0),
  isSyncing: signal(false),
  activeWorkoutId: signal(null),
  activeWorkoutSets: signal([]),
  sets: signal([]),
}));

// Mock workouts-api
vi.mock('./workouts-api', () => ({
  appendSet: vi.fn(),
  updateSet: vi.fn(),
  fetchSets: vi.fn(),
}));

import {
  readQueue,
  enqueueSet,
  dequeueByKey,
  clearQueue,
  initPendingCount,
  flushQueue,
  shiftQueueAfterDelete,
  dropQueuedAppend,
} from './sync-queue';
import type { WorkoutSet } from './types';
import * as store from '../state/store';
import * as workoutsApi from './workouts-api';

const makeSet = (overrides?: Partial<WorkoutSet & { sheetRow: number }>): WorkoutSet & { sheetRow: number } => ({
  workout_id: 'w1',
  exercise_id: 'ex1',
  exercise_name: 'Bench Press',
  section: 'primary',
  exercise_order: 1,
  set_number: 1,
  planned_reps: '8',
  weight: '100',
  reps: '8',
  effort: 'Medium',
  sheetRow: -1,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  store.pendingSyncCount.value = 0;
  store.isSyncing.value = false;
  store.activeWorkoutSets.value = [];
  store.sets.value = [];
});

// ── AC1 helpers: readQueue / enqueueSet / dequeueByKey / clearQueue ──

describe('readQueue', () => {
  it('returns empty array when localStorage is empty', () => {
    expect(readQueue()).toEqual([]);
  });

  it('returns empty array when stored JSON is corrupt', () => {
    localStorage.setItem('gw_sync_queue', 'not-json');
    expect(readQueue()).toEqual([]);
  });

  it('returns entries previously written by enqueueSet', () => {
    const s = makeSet();
    enqueueSet(s);
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].payload).toMatchObject({ workout_id: 'w1', set_number: 1 });
  });
});

describe('enqueueSet', () => {
  it('adds an entry with the correct composite key', () => {
    const s = makeSet({ exercise_order: 2, set_number: 3 });
    enqueueSet(s);
    const q = readQueue();
    expect(q[0].key).toBe('w1|ex1|2|3');
  });

  it('updates pendingSyncCount signal', () => {
    enqueueSet(makeSet());
    expect(store.pendingSyncCount.value).toBe(1);
    enqueueSet(makeSet({ set_number: 2 }));
    expect(store.pendingSyncCount.value).toBe(2);
  });

  it('deduplicates: updating same composite key replaces payload in-place', () => {
    enqueueSet(makeSet({ weight: '100' }));
    enqueueSet(makeSet({ weight: '110' })); // same key
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].payload.weight).toBe('110');
  });

  it('preserves sheetRow in the stored payload', () => {
    enqueueSet(makeSet({ sheetRow: 42 }));
    expect(readQueue()[0].payload.sheetRow).toBe(42);
  });
});

describe('dequeueByKey', () => {
  it('removes the entry matching the key', () => {
    enqueueSet(makeSet({ set_number: 1 }));
    enqueueSet(makeSet({ set_number: 2 }));
    dequeueByKey('w1|ex1|1|1');
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].key).toBe('w1|ex1|1|2');
    expect(store.pendingSyncCount.value).toBe(1);
  });

  it('is a no-op if key not found', () => {
    enqueueSet(makeSet());
    dequeueByKey('w1|ex1|9|9');
    expect(readQueue()).toHaveLength(1);
  });
});

describe('clearQueue', () => {
  it('removes all entries and resets count to 0', () => {
    enqueueSet(makeSet({ set_number: 1 }));
    enqueueSet(makeSet({ set_number: 2 }));
    clearQueue();
    expect(readQueue()).toHaveLength(0);
    expect(store.pendingSyncCount.value).toBe(0);
  });
});

describe('initPendingCount', () => {
  it('seeds pendingSyncCount from localStorage on startup', () => {
    enqueueSet(makeSet({ set_number: 1 }));
    enqueueSet(makeSet({ set_number: 2 }));
    store.pendingSyncCount.value = 0; // reset signal
    initPendingCount();
    expect(store.pendingSyncCount.value).toBe(2);
  });
});

// ── AC3 / AC4: flushQueue ────────────────────────────────────────────

describe('flushQueue', () => {
  it('returns {synced:0, failed:0, remaining:0} when queue is empty', async () => {
    const result = await flushQueue('tok');
    expect(result).toEqual({ synced: 0, failed: 0, remaining: 0 });
  });

  it('calls updateSet (PUT) when sheetRow > 0 (AC4 dedup)', async () => {
    vi.mocked(workoutsApi.updateSet).mockResolvedValue(undefined);
    const s = makeSet({ sheetRow: 5 });
    enqueueSet(s);
    const result = await flushQueue('tok');
    expect(workoutsApi.updateSet).toHaveBeenCalledWith(5, expect.objectContaining({ sheetRow: 5 }), 'tok');
    expect(workoutsApi.appendSet).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('calls appendSet (POST) when sheetRow is -1 (new row)', async () => {
    vi.mocked(workoutsApi.appendSet).mockResolvedValue(undefined);
    vi.mocked(workoutsApi.fetchSets).mockResolvedValue([
      { ...makeSet({ sheetRow: 10 }) },
    ]);
    store.activeWorkoutSets.value = [];
    enqueueSet(makeSet({ sheetRow: -1 }));
    const result = await flushQueue('tok');
    expect(workoutsApi.appendSet).toHaveBeenCalled();
    expect(workoutsApi.fetchSets).toHaveBeenCalled();
    expect(result.synced).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('sets isSyncing to true during flush and false after (AC5)', async () => {
    const syncingStates: boolean[] = [];
    vi.mocked(workoutsApi.updateSet).mockImplementation(async () => {
      syncingStates.push(store.isSyncing.value);
    });
    enqueueSet(makeSet({ sheetRow: 5 }));
    const resultPromise = flushQueue('tok');
    await resultPromise;
    expect(syncingStates).toContain(true);
    expect(store.isSyncing.value).toBe(false);
  });

  it('stops on first failure and leaves remaining sets in queue (AC3 partial)', async () => {
    vi.mocked(workoutsApi.updateSet)
      .mockResolvedValueOnce(undefined) // first set succeeds
      .mockRejectedValueOnce(new TypeError('Network error')); // second set fails
    enqueueSet(makeSet({ set_number: 1, sheetRow: 5 }));
    enqueueSet(makeSet({ set_number: 2, sheetRow: 6 }));
    const result = await flushQueue('tok');
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(readQueue()).toHaveLength(1);
    expect(readQueue()[0].payload.set_number).toBe(2);
  });

  it('clears the queue and resets isSyncing on complete success (AC3)', async () => {
    vi.mocked(workoutsApi.updateSet).mockResolvedValue(undefined);
    enqueueSet(makeSet({ set_number: 1, sheetRow: 5 }));
    enqueueSet(makeSet({ set_number: 2, sheetRow: 6 }));
    await flushQueue('tok');
    expect(readQueue()).toHaveLength(0);
    expect(store.pendingSyncCount.value).toBe(0);
    expect(store.isSyncing.value).toBe(false);
  });
});

// ── #394: the queue follows a Sets row delete ──

describe('shiftQueueAfterDelete (#394)', () => {
  it('drops the entry aimed at the deleted row and gives every entry below it one less, from any workout', () => {
    enqueueSet(makeSet({ set_number: 1, sheetRow: 3 }));
    enqueueSet(makeSet({ set_number: 2, sheetRow: 4 }));
    enqueueSet(makeSet({ workout_id: 'w2', sheetRow: 9 }));
    enqueueSet(makeSet({ set_number: 3, sheetRow: -1 }));
    enqueueSet(makeSet({ set_number: 4, sheetRow: 2 }));
    shiftQueueAfterDelete(3);
    expect(readQueue().map((e) => [e.payload.workout_id, e.payload.set_number, e.payload.sheetRow])).toEqual([
      ['w1', 2, 3],
      ['w2', 1, 8],
      ['w1', 3, -1],
      ['w1', 4, 2],
    ]);
    expect(store.pendingSyncCount.value).toBe(4);
  });

  it('leaves a queue with nothing at or below the row as it was', () => {
    enqueueSet(makeSet({ sheetRow: 2 }));
    shiftQueueAfterDelete(5);
    expect(readQueue().map((e) => e.payload.sheetRow)).toEqual([2]);
  });
});

describe('dropQueuedAppend (#394)', () => {
  it('drops the removed set\'s queued append', () => {
    enqueueSet(makeSet({ set_number: 2, sheetRow: -1 }));
    enqueueSet(makeSet({ set_number: 1, sheetRow: 2 }));
    dropQueuedAppend(makeSet({ set_number: 2 }));
    expect(readQueue().map((e) => e.payload.set_number)).toEqual([1]);
  });

  it('never drops an entry aimed at a row, even under the same key (a twin or a moved exercise)', () => {
    enqueueSet(makeSet({ set_number: 1, sheetRow: 5 }));
    dropQueuedAppend(makeSet({ set_number: 1 }));
    expect(readQueue().map((e) => e.payload.sheetRow)).toEqual([5]);
  });
});
