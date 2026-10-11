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
  remapQueuedOrders,
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

// ── #392: a saved set is keyed by its row, and the queue follows a move ──

describe('row keys (#392 AC5)', () => {
  it('keys a set with a row by workout and row; one with no row keeps the old key', () => {
    enqueueSet(makeSet({ sheetRow: 7, exercise_order: 2 }));
    enqueueSet(makeSet({ sheetRow: -1, exercise_order: 2, set_number: 3 }));
    expect(readQueue().map((e) => e.key)).toEqual(['w1|row:7', 'w1|ex1|2|3']);
  });

  it("a duplicate's two copies sharing exercise, order and set number keep separate entries", () => {
    enqueueSet(makeSet({ sheetRow: 2, section: 'primary', weight: '95' }));
    enqueueSet(makeSet({ sheetRow: 3, section: 'SS1', weight: '135' }));
    expect(readQueue().map((e) => [e.payload.sheetRow, e.payload.weight])).toEqual([[2, '95'], [3, '135']]);
  });

  it('a second save of the same row replaces its entry, even one stored under the old key', () => {
    localStorage.setItem('gw_sync_queue', JSON.stringify([{ key: 'w1|ex1|1|1', payload: makeSet({ sheetRow: 4, weight: '90' }) }]));
    enqueueSet(makeSet({ sheetRow: 4, exercise_order: 2, weight: '95' }));
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ key: 'w1|row:4', payload: { weight: '95', exercise_order: 2 } });
  });

  it('a row shift re-keys the entries it moves', () => {
    enqueueSet(makeSet({ sheetRow: 5 }));
    shiftQueueAfterDelete(3);
    expect(readQueue().map((e) => [e.key, e.payload.sheetRow])).toEqual([['w1|row:4', 4]]);
  });

  it('entries stored under the old key still flush, once each', async () => {
    vi.mocked(workoutsApi.updateSet).mockResolvedValue(undefined);
    localStorage.setItem('gw_sync_queue', JSON.stringify([
      { key: 'w1|ex1|1|1', payload: makeSet({ sheetRow: 4 }) },
      { key: 'w1|ex1|1|2', payload: makeSet({ sheetRow: 5, set_number: 2 }) },
    ]));
    const result = await flushQueue('tok');
    expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(vi.mocked(workoutsApi.updateSet).mock.calls.map((c) => c[0])).toEqual([4, 5]);
  });
});

describe('remapQueuedOrders (#392 AC5)', () => {
  const byRow = (...rows: [number, string, number, number][]) =>
    new Map(rows.map(([row, exercise_id, set_number, exercise_order]) => [row, { exercise_id, set_number, exercise_order }]));

  it("gives an entry with a row the order of the set holding that row, when it is the entry's own", () => {
    enqueueSet(makeSet({ sheetRow: 2, exercise_order: 1 }));
    enqueueSet(makeSet({ sheetRow: 3, exercise_order: 2, exercise_id: 'ex2' }));
    remapQueuedOrders('w1', { byRow: byRow([2, 'ex1', 1, 2], [3, 'ex1', 1, 1]), moves: [] });
    // Row 3 is held by another exercise's set: left alone.
    expect(readQueue().map((e) => [e.payload.sheetRow, e.payload.exercise_order])).toEqual([[2, 2], [3, 2]]);
  });

  it('swaps the orders of entries with no row in one pass, keeping both', () => {
    enqueueSet(makeSet({ exercise_order: 1, weight: 'A' }));
    enqueueSet(makeSet({ exercise_order: 2, weight: 'B' }));
    remapQueuedOrders('w1', {
      byRow: new Map(),
      moves: [{ exercise_id: 'ex1', from: 1, to: 2 }, { exercise_id: 'ex1', from: 2, to: 1 }],
    });
    expect(readQueue().map((e) => [e.key, e.payload.weight])).toEqual([['w1|ex1|2|1', 'A'], ['w1|ex1|1|1', 'B']]);
  });

  it("leaves other workouts' entries alone", () => {
    enqueueSet(makeSet({ workout_id: 'w2', exercise_order: 1 }));
    enqueueSet(makeSet({ workout_id: 'w2', exercise_order: 1, set_number: 2, sheetRow: 9 }));
    remapQueuedOrders('w1', { byRow: byRow([9, 'ex1', 2, 5]), moves: [{ exercise_id: 'ex1', from: 1, to: 2 }] });
    expect(readQueue().map((e) => e.payload.exercise_order)).toEqual([1, 1]);
  });

  it('an entry re-keyed while it is being flushed is still removed once it lands', async () => {
    let release!: () => void;
    vi.mocked(workoutsApi.appendSet).mockImplementation(() => new Promise<void>((r) => { release = r; }));
    vi.mocked(workoutsApi.fetchSets).mockResolvedValue([]);
    enqueueSet(makeSet({ exercise_order: 1 }));
    const flushing = flushQueue('tok');
    await Promise.resolve();
    remapQueuedOrders('w1', { byRow: new Map(), moves: [{ exercise_id: 'ex1', from: 1, to: 2 }] });
    release();
    await flushing;
    expect(readQueue()).toHaveLength(0); // never appended a second time
  });
});

describe('flushQueue updates the in-memory set by its row (#392 AC5)', () => {
  it("replaces the active set at the payload's row, never a twin at the same exercise, order and set number", async () => {
    vi.mocked(workoutsApi.updateSet).mockResolvedValue(undefined);
    store.activeWorkoutId.value = 'w1' as never;
    const twinA = { ...makeSet({ sheetRow: 2, section: 'primary', weight: '95' }), effort: '' as const };
    const twinB = { ...makeSet({ sheetRow: 3, section: 'SS1', weight: '' }), effort: '' as const };
    store.activeWorkoutSets.value = [twinA, twinB] as never;
    enqueueSet(makeSet({ sheetRow: 3, section: 'SS1', weight: '135' }));
    await flushQueue('tok');
    expect((store.activeWorkoutSets.value as { sheetRow: number; weight: string }[]).map((s) => [s.sheetRow, s.weight]))
      .toEqual([[2, '95'], [3, '135']]);
    store.activeWorkoutId.value = null as never;
  });
});
