// Offline sync queue — stores failed set saves to localStorage and flushes on reconnect.

import type { WorkoutSet } from './types';
import { appendSet, updateSet, fetchSets } from './workouts-api';
import { pendingSyncCount, isSyncing, activeWorkoutId, activeWorkoutSets, sets } from '../state/store';

const STORAGE_KEY = 'gw_sync_queue';

export interface SyncEntry {
  key: string;
  payload: WorkoutSet & { sheetRow: number };
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
}

function compositeKey(s: WorkoutSet): string {
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
  const idx = queue.findIndex(e => e.key === key);
  if (idx >= 0) {
    queue[idx] = { key, payload };
  } else {
    queue.push({ key, payload });
  }
  writeQueue(queue);
}

/** Remove a single entry by composite key. */
export function dequeueByKey(key: string): void {
  writeQueue(readQueue().filter(e => e.key !== key));
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

  for (const entry of queue) {
    try {
      const { payload } = entry;

      if (payload.sheetRow > 0) {
        // Update existing sheet row (AC4: PUT to prevent duplicate append)
        await updateSet(payload.sheetRow, payload, token);
        const updated: WorkoutSet & { sheetRow: number } = { ...payload };
        // Only the active workout's own set belongs in activeWorkoutSets (#374).
        if (payload.workout_id === activeWorkoutId.value) {
          activeWorkoutSets.value = activeWorkoutSets.value.map(s =>
            s.workout_id === payload.workout_id &&
            s.exercise_id === payload.exercise_id &&
            s.exercise_order === payload.exercise_order &&
            s.set_number === payload.set_number
              ? { ...updated }
              : s,
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

      dequeueByKey(entry.key);
      synced++;
    } catch {
      failed++;
      break; // stop on first failure; remaining sets stay queued
    }
  }

  isSyncing.value = false;
  return { synced, failed, remaining: readQueue().length };
}
