// Offline sync queue — stores failed set saves to localStorage and flushes on reconnect.

import type { WorkoutSet } from './types';
import { appendSet, updateSet, fetchSets } from './workouts-api';
import { pendingSyncCount, isSyncing, activeWorkoutId, activeWorkoutSets, sets } from '../state/store';

const STORAGE_KEY = 'gw_sync_queue';

export interface SyncEntry {
  key: string;
  payload: WorkoutSet & { sheetRow: number };
  /**
   * The entry's own identity, kept when its key changes (a move or a row
   * shift re-keys it while a flush may be sending it), so the flush removes
   * exactly the entry it sent (#392). Absent on entries queued before.
   */
  id?: string;
}

const newEntryId = (): string =>
  `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * An entry's key. A set with a sheet row is keyed by workout and row (#392):
 * after a move, a duplicate's two copies can share exercise, order and set
 * number, and must never replace each other's entry. A set with no row keeps
 * the exercise / order / set number key. Entries stored under the old key
 * still flush once each: the flush dequeues by the key it read.
 */
function compositeKey(s: WorkoutSet & { sheetRow?: number }): string {
  if (s.sheetRow !== undefined && s.sheetRow > 0) return `${s.workout_id}|row:${s.sheetRow}`;
  return `${s.workout_id}|${s.exercise_id}|${s.exercise_order}|${s.set_number}`;
}

export function readQueue(): SyncEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SyncEntry[];
  } catch {
    return [];
  }
}

function writeQueue(entries: SyncEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  pendingSyncCount.value = entries.length;
}

/** Add or update a set in the queue. Deduplicates by composite key. */
export function enqueueSet(payload: WorkoutSet & { sheetRow: number }): void {
  const key = compositeKey(payload);
  const queue = readQueue();
  // A set with a row replaces the entry aimed at that row, whatever key it
  // was stored under (one queued before #392 carries the old key).
  const idx = queue.findIndex(e => e.key === key ||
    (payload.sheetRow > 0 && e.payload.workout_id === payload.workout_id && e.payload.sheetRow === payload.sheetRow));
  if (idx >= 0) {
    queue[idx] = { key, payload, id: queue[idx].id ?? newEntryId() };
  } else {
    queue.push({ key, payload, id: newEntryId() });
  }
  writeQueue(queue);
}

/** Remove a single entry by composite key. */
export function dequeueByKey(key: string): void {
  writeQueue(readQueue().filter(e => e.key !== key));
}

/**
 * Follow a Sets row delete that landed (#394): the entry aimed at `row` was
 * for the removed set and is dropped, and every entry aimed below it, from any
 * workout, gets one less, as the sheet's rows did. Appends (no row) are kept.
 */
export function shiftQueueAfterDelete(row: number): void {
  const queue = readQueue();
  if (!queue.some(e => e.payload.sheetRow >= row)) return;
  writeQueue(queue
    .filter(e => e.payload.sheetRow !== row)
    .map(e => {
      if (!(e.payload.sheetRow > row)) return e;
      const payload = { ...e.payload, sheetRow: e.payload.sheetRow - 1 };
      return { ...e, key: compositeKey(payload), payload };
    }));
}

/** Where a set of the moved or re-sectioned workout now sits, for `remapQueuedOrders`. */
export interface QueuedOrderMap {
  /**
   * Sets with a row: the row's set (exercise and set number, to check) and its
   * exercise's order, and section when given, now.
   */
  byRow: Map<number, { exercise_id: string; set_number: number; exercise_order: number; section?: string }>;
  /** Sets with no row: each exercise whose order a move changed, from and to. */
  moves: { exercise_id: string; from: number; to: number }[];
  /**
   * Sets with no row: each exercise whose section changed (#395), at the order
   * it has after the change.
   */
  sections?: { exercise_id: string; exercise_order: number; section: string }[];
}

/**
 * Give a workout's queued entries the order (#392 AC5) and section (#395 AC3)
 * their exercise has now, so a later flush never writes back the order from
 * before a move or the section from before a change: an entry holds a whole
 * row. An entry aimed at a row takes the values of the set holding that row,
 * when that set is the entry's own (same exercise and set number). An entry
 * with no row is mapped by the move and by the section change: every change
 * is applied at once, so a swap of two orders swaps their entries rather than
 * merging them. Other workouts' entries are untouched. Never carries a row
 * key: entries hold sets only.
 */
export function remapQueuedOrders(workoutId: string, map: QueuedOrderMap): void {
  const queue = readQueue();
  let changed = false;
  const next = queue.map(e => {
    const p = e.payload;
    if (p.workout_id !== workoutId) return e;
    let order: number | undefined;
    let section: string | undefined;
    if (p.sheetRow > 0) {
      const at = map.byRow.get(p.sheetRow);
      if (at && at.exercise_id === p.exercise_id && at.set_number === p.set_number) {
        order = at.exercise_order;
        section = at.section;
      }
    } else {
      order = map.moves.find(m => m.exercise_id === p.exercise_id && m.from === p.exercise_order)?.to;
      const orderNow = order ?? p.exercise_order;
      section = map.sections?.find(s => s.exercise_id === p.exercise_id && s.exercise_order === orderNow)?.section;
    }
    const newOrder = order ?? p.exercise_order;
    const newSection = section ?? p.section;
    if (newOrder === p.exercise_order && newSection === p.section) return e;
    changed = true;
    const payload = { ...p, exercise_order: newOrder, section: newSection };
    return { ...e, key: compositeKey(payload), payload };
  });
  if (changed) writeQueue(next);
}

/**
 * Drop the queued append for a set with no row that was removed (#394). Only
 * an entry with no row matches: one aimed at a row belongs to another set
 * that happens to share the key (a duplicate's twin, a moved exercise).
 */
export function dropQueuedAppend(set: WorkoutSet): void {
  const key = compositeKey(set);
  const queue = readQueue();
  if (!queue.some(e => e.key === key && !(e.payload.sheetRow > 0))) return;
  writeQueue(queue.filter(e => !(e.key === key && !(e.payload.sheetRow > 0))));
}

/** Remove all queued entries. */
export function clearQueue(): void {
  writeQueue([]);
}

/** Seed pendingSyncCount from localStorage on app startup. */
export function initPendingCount(): void {
  pendingSyncCount.value = readQueue().length;
}

/**
 * Flush the queue sequentially. Stops on first failure and leaves remaining
 * entries in the queue. Updates isSyncing signal while running.
 */
export async function flushQueue(token: string): Promise<FlushResult> {
  const queue = readQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, remaining: 0 };

  isSyncing.value = true;
  let synced = 0;
  let failed = 0;

  for (const queued of queue) {
    // The entry as it is now, not as it was read: a move may have given it a
    // new order since the flush began (#392). Gone meanwhile: nothing to send.
    const entry = readQueue().find(e => (queued.id ? e.id === queued.id : e.key === queued.key));
    if (!entry) continue;
    try {
      const { payload } = entry;

      if (payload.sheetRow > 0) {
        // Update existing sheet row (AC4: PUT to prevent duplicate append)
        await updateSet(payload.sheetRow, payload, token);
        const updated: WorkoutSet & { sheetRow: number } = { ...payload };
        // Only the active workout's own set belongs in activeWorkoutSets (#374).
        if (payload.workout_id === activeWorkoutId.value) {
          // By its row, never by exercise, order and set number (#392).
          activeWorkoutSets.value = activeWorkoutSets.value.map(s =>
            s.sheetRow === payload.sheetRow ? { ...updated } : s,
          );
        }
        sets.value = sets.value.map(s =>
          s.sheetRow === payload.sheetRow ? { ...updated } : s,
        );
      } else {
        // Append new row and re-fetch to get sheetRow
        await appendSet(payload, token);
        const allSets = await fetchSets(token);
        sets.value = allSets;
        // Re-derive the ACTIVE workout's rows (fresh sheetRows), never the
        // queued set's: it may be from an earlier workout (#374).
        const activeId = activeWorkoutId.value;
        if (activeId) {
          activeWorkoutSets.value = allSets.filter(s => s.workout_id === activeId);
        }
      }

      // By its id when it has one: a move may have re-keyed it meanwhile.
      if (entry.id) writeQueue(readQueue().filter(e => e.id !== entry.id));
      else dequeueByKey(entry.key);
      synced++;
    } catch {
      failed++;
      break; // stop on first failure; remaining sets stay queued
    }
  }

  isSyncing.value = false;
  return { synced, failed, remaining: readQueue().length };
}
