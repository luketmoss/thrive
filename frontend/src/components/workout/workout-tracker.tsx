import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { activeWorkoutSets, activeWarmupExercises, isEditMode, workouts, pendingSyncCount, isSyncing, showToast } from '../../state/store';
import { saveSet, removeSet, finishWorkout, deleteWorkout, saveWorkoutEdits, exitEditMode } from '../../state/actions';
import { flushQueue } from '../../api/sync-queue';
import { useAuth } from '../../auth/auth-context';
import { navigate, goBack } from '../../router/router';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { FinishWorkoutModal } from './finish-modal';
import { ExerciseRow } from './exercise-row';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { ExerciseWithRow, Effort, SetWithRow } from '../../api/types';
import { applyQuickFillWeight, applyQuickFillReps, applyQuickFillEffort } from './quick-fill';
import { applyCopyDown } from './copy-down';
import { isWarmupExercise } from './warmup';
import { applyChangeSection, applyMoveUp, applyMoveDown } from './section-management';
import { buildExerciseList, mergeWarmups } from './build-exercise-list';
import { collectEditedSets } from './edited-sets';
import { workoutToEditInputs, editInputsToPatch } from '../shared/edit-patch';
import { EffortToggle } from '../shared/effort-toggle';
import { newRowKey, useReorderFocus } from '../shared/reorder-focus';
import type { MoveDirection } from '../shared/reorder-focus';
import { shiftTrackerRows } from './row-shift';

/**
 * What removing sets from exercise `ex` does to `list`: the list after, and
 * the sets it takes off (whose rows the tracker deletes in log mode).
 */
type Removal = (
  list: TrackerExercise[],
  ex: TrackerExercise,
) => { exercises: TrackerExercise[]; removedSets: TrackerSet[] };

interface Props {
  workoutId: string;
  workoutName: string;
}

export function WorkoutTracker({ workoutId, workoutName }: Props) {
  /** The row payload for removing tracker set `s` of exercise `ex`. */
  const toSetWithRow = (ex: TrackerExercise, s: TrackerSet): SetWithRow => ({
    workout_id: workoutId,
    exercise_id: ex.exercise_id,
    exercise_name: ex.exercise_name,
    section: ex.section,
    exercise_order: ex.exercise_order,
    set_number: s.set_number,
    planned_reps: s.planned_reps,
    weight: s.weight,
    reps: s.reps,
    effort: s.effort,
    sheetRow: s.sheetRow,
  });

  const { token } = useAuth();
  const editMode = isEditMode.value;
  const workout = workouts.value.find((w) => w.id === workoutId);

  const [exerciseList, setExerciseListState] = useState<TrackerExercise[]>([]);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState(editMode ? (workout?.notes || '') : '');
  const [showFinishForm, setShowFinishForm] = useState(false);
  const reorder = useReorderFocus();
  const saveTimers = useRef<Map<string, number>>(new Map());

  // #394: the latest list, ahead of the render. Every change goes through
  // updateList, so a write that starts right after a row shift reads it here,
  // never a list from an earlier render.
  const listRef = useRef<TrackerExercise[]>([]);
  const updateList = useCallback((fn: (prev: TrackerExercise[]) => TrackerExercise[]) => {
    const next = fn(listRef.current);
    listRef.current = next;
    setExerciseListState(next);
  }, []);

  // #394: the tracker's writes to Sets rows (deletes and the debounced save)
  // go out one at a time, in the order asked for. Each step reads its set from
  // listRef when it starts. The returned promise is the step's own; the chain
  // itself never rejects.
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueWrite = useCallback(<T,>(step: () => Promise<T>): Promise<T> => {
    const run = writeChain.current.then(step);
    writeChain.current = run.catch(() => undefined);
    return run;
  }, []);
  // Remove set taps whose write has not finished: a repeat tap is ignored.
  const pendingRemovals = useRef<Set<string>>(new Set());

  // Edit mode metadata
  // Pre-filled values, fixed at mount: a save writes only what differs (#172).
  const [editInitial] = useState(() => workoutToEditInputs(workout));
  const [editDate, setEditDate] = useState(editInitial.date);
  const [editName, setEditName] = useState(editInitial.name);
  const [editDuration, setEditDuration] = useState(editInitial.duration);
  const [editEffort, setEditEffort] = useState<Effort | ''>(editInitial.effort);
  const [finishEffort, setFinishEffort] = useState<Effort | ''>('');

  // Auto-sync on reconnect (AC3)
  useEffect(() => {
    if (!token) return;
    const handleOnline = async () => {
      if (pendingSyncCount.value === 0) return;
      const result = await flushQueue(token);
      if (result.synced > 0 && result.remaining === 0) {
        showToast(`${result.synced} set${result.synced === 1 ? '' : 's'} saved`, 'success');
      } else if (result.failed > 0) {
        showToast('Some sets failed to sync — will retry on reconnect', 'error');
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [token]);

  // Initialize from signal, merging warmup exercises (list-only, no sets).
  // Warmups already present in activeWorkoutSets (as persisted set rows) are
  // skipped from activeWarmupExercises to avoid duplication.
  useEffect(() => {
    const tracked = buildExerciseList(activeWorkoutSets.value);
    updateList(() => mergeWarmups(tracked, activeWarmupExercises.value));
  }, []);

  // Debounced save for a specific set (disabled in edit mode)
  const debouncedSave = useCallback((exerciseOrder: number, exerciseId: string, set: TrackerSet) => {
    if (!token || editMode) return;
    // Only save if there's meaningful data
    if (!set.weight && !set.reps) return;

    const key = `${exerciseId}__${exerciseOrder}__${set.set_number}`;
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);

    const timer = window.setTimeout(() => {
      saveTimers.current.delete(key);

      // The write waits for any write ahead of it (a delete shifting rows),
      // then reads the set from the latest list (#394).
      void enqueueWrite(async () => {
        const ex = listRef.current.find(
          (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
        );
        if (!ex) return;

        const currentSet = ex.sets.find((s) => s.set_number === set.set_number);
        if (!currentSet) return;

        try {
          const result = await saveSet({
            workout_id: workoutId,
            exercise_id: exerciseId,
            exercise_name: ex.exercise_name,
            section: ex.section,
            exercise_order: exerciseOrder,
            set_number: set.set_number,
            planned_reps: set.planned_reps,
            weight: set.weight,
            reps: set.reps,
            effort: set.effort,
          }, token);

          // Mark as saved: the exercise found above, wherever it is now.
          updateList((prev) =>
            prev.map((e) =>
              e.rowKey === ex.rowKey
                ? {
                    ...e,
                    sets: e.sets.map((s) =>
                      s.set_number === set.set_number
                        ? { ...s, saved: true, sheetRow: result.sheetRow }
                        : s,
                    ),
                  }
                : e,
            ),
          );
        } catch {
          // Error toast shown by saveSet action
        }
      });
    }, 1000);

    saveTimers.current.set(key, timer);
  }, [token, workoutId, editMode]);

  const handleUpdateSet = (
    exerciseId: string,
    exerciseOrder: number,
    setNumber: number,
    updates: Partial<TrackerSet>,
  ) => {
    updateList((prev) => {
      const next = prev.map((ex) => {
        if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s) =>
            s.set_number === setNumber ? { ...s, ...updates, saved: false } : s,
          ),
        };
      });

      // Schedule save for the updated set (no-op in edit mode)
      const ex = next.find((e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder);
      const set = ex?.sets.find((s) => s.set_number === setNumber);
      if (set) {
        // Defer to avoid stale closure
        setTimeout(() => debouncedSave(exerciseOrder, exerciseId, set), 0);
      }

      return next;
    });
  };

  const handleQuickFillWeight = (exerciseId: string, exerciseOrder: number, weight: string) => {
    updateList((prev) => {
      const next = applyQuickFillWeight(prev, exerciseId, exerciseOrder, weight);
      // Schedule save for filled sets that have reps (no-op in edit mode)
      if (weight) {
        const ex = next.find((e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder);
        if (ex) {
          for (const s of ex.sets) {
            if (s.reps) {
              setTimeout(() => debouncedSave(exerciseOrder, exerciseId, s), 0);
            }
          }
        }
      }
      return next;
    });
  };

  const handleQuickFillReps = (exerciseId: string, exerciseOrder: number, reps: string) => {
    updateList((prev) => {
      const next = applyQuickFillReps(prev, exerciseId, exerciseOrder, reps);
      if (reps) {
        const ex = next.find((e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder);
        if (ex) {
          for (const s of ex.sets) {
            if (s.weight) {
              setTimeout(() => debouncedSave(exerciseOrder, exerciseId, s), 0);
            }
          }
        }
      }
      return next;
    });
  };

  const handleQuickFillEffort = (exerciseId: string, exerciseOrder: number, effort: Effort | '') => {
    updateList((prev) => {
      const next = applyQuickFillEffort(prev, exerciseId, exerciseOrder, effort);
      if (effort) {
        const ex = next.find((e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder);
        if (ex) {
          for (const s of ex.sets) {
            if (s.weight || s.reps) {
              setTimeout(() => debouncedSave(exerciseOrder, exerciseId, s), 0);
            }
          }
        }
      }
      return next;
    });
  };

  /**
   * Remove sets from one exercise in log mode (#394): Remove set, Copy-down
   * onto fewer sets, Change section to warmup, Remove exercise. Runs as one
   * tracker write. Each row is deleted bottom to top, reading the exercise
   * (by its row key) and its rows from the latest list before every delete,
   * and the whole list is shifted as soon as a delete lands. The removal is
   * then applied to the list as it is at that point, so anything typed, saved
   * or moved meanwhile is kept. A delete that fails stops it there: what was
   * deleted stays on screen without a row, unsaved, and nothing is applied.
   * Resolves true when the removal was applied.
   */
  const runRemoval = (rowKey: string, removal: Removal): Promise<boolean> =>
    enqueueWrite(async () => {
      if (!token) return false;
      const current = () => listRef.current.find((e) => e.rowKey === rowKey);
      const deleted = new Set<number>(); // set numbers whose row this run deleted

      for (;;) {
        const ex = current();
        if (!ex) return false; // already gone: a repeat tap deletes nothing
        const next = removal(listRef.current, ex).removedSets
          .filter((s) => s.sheetRow > 0)
          .sort((a, b) => b.sheetRow - a.sheetRow)[0];
        if (!next) break;
        try {
          await removeSet(toSetWithRow(ex, next), token);
        } catch {
          return false; // Error toast shown by action
        }
        deleted.add(next.set_number);
        updateList((prev) => shiftTrackerRows(prev, next.sheetRow));
      }

      const ex = current();
      if (!ex) return false;
      // Sets that never had a row: no request, only their queued append goes.
      for (const s of removal(listRef.current, ex).removedSets) {
        if (deleted.has(s.set_number)) continue;
        try {
          await removeSet(toSetWithRow(ex, s), token);
        } catch {
          // Nothing was requested; nothing to undo.
        }
      }

      const latest = current();
      if (!latest) return false;
      const { exercises, removedSets } = removal(listRef.current, latest);
      for (const s of removedSets) {
        const key = `${latest.exercise_id}__${latest.exercise_order}__${s.set_number}`;
        const timer = saveTimers.current.get(key);
        if (timer) {
          clearTimeout(timer);
          saveTimers.current.delete(key);
        }
      }
      updateList(() => exercises);
      return true;
    });

  /** A removal applied without any request: edit mode, or nothing to delete. */
  const applyRemoval = (rowKey: string, removal: Removal) => {
    updateList((prev) => {
      const ex = prev.find((e) => e.rowKey === rowKey);
      return ex ? removal(prev, ex).exercises : prev;
    });
  };

  const findExercise = (exerciseId: string, exerciseOrder: number) =>
    listRef.current.find(
      (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
    );

  const handleCopyDown = async (exerciseId: string, exerciseOrder: number, lastTimeSets: SetWithRow[]) => {
    const ex = findExercise(exerciseId, exerciseOrder);
    if (!ex?.rowKey) return;
    const rowKey = ex.rowKey;

    // AC3: Confirmation when removing sets
    if (lastTimeSets.length < ex.sets.length) {
      const ok = confirm(`Replace ${ex.sets.length} sets with ${lastTimeSets.length} from last time?`);
      if (!ok) return;
    }

    const removal: Removal = (list, e) =>
      applyCopyDown(list, e.exercise_id, e.exercise_order, lastTimeSets);

    // In edit mode, don't delete from API — just update local state
    if (editMode || !token || removal(listRef.current, ex).removedSets.length === 0) {
      applyRemoval(rowKey, removal);
    } else if (!(await runRemoval(rowKey, removal))) {
      return;
    }

    // Trigger auto-save for all copied sets (no-op in edit mode)
    if (!editMode) {
      const updatedEx = listRef.current.find((e) => e.rowKey === rowKey);
      if (updatedEx) {
        for (const s of updatedEx.sets) {
          if (s.weight || s.reps) {
            setTimeout(() => debouncedSave(updatedEx.exercise_order, updatedEx.exercise_id, s), 0);
          }
        }
      }
    }
  };

  const handleAddSet = (exerciseId: string, exerciseOrder: number) => {
    updateList((prev) =>
      prev.map((ex) => {
        if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;
        const maxSetNum = ex.sets.reduce((max, s) => Math.max(max, s.set_number), 0);
        const newSet: TrackerSet = {
          set_number: maxSetNum + 1,
          planned_reps: ex.sets[0]?.planned_reps || '',
          weight: ex.quickFillWeight || '',
          reps: '',
          effort: '',
          saved: false,
          sheetRow: -1,
        };
        return { ...ex, sets: [...ex.sets, newSet] };
      }),
    );
  };

  const handleRemoveSet = async (exerciseId: string, exerciseOrder: number, setNumber: number) => {
    if (!token) return;
    const ex = findExercise(exerciseId, exerciseOrder);
    if (!ex?.rowKey) return;

    const removal: Removal = (list, e) => ({
      exercises: list.map((x) =>
        x.rowKey === e.rowKey ? { ...x, sets: x.sets.filter((s) => s.set_number !== setNumber) } : x,
      ),
      removedSets: e.sets.filter((s) => s.set_number === setNumber),
    });

    // In edit mode, just remove from local state — deletion happens on save
    if (editMode) {
      applyRemoval(ex.rowKey, removal);
      return;
    }

    // A repeat tap while the first is still going does nothing (#394).
    const tap = `${ex.rowKey}|${setNumber}`;
    if (pendingRemovals.current.has(tap)) return;
    pendingRemovals.current.add(tap);
    try {
      await runRemoval(ex.rowKey, removal);
    } finally {
      pendingRemovals.current.delete(tap);
    }
  };

  const handleChangeSection = async (exerciseId: string, exerciseOrder: number, newSection: string) => {
    if (!token) return;
    const ex = findExercise(exerciseId, exerciseOrder);
    if (!ex?.rowKey) return;

    const removal: Removal = (list, e) =>
      applyChangeSection(list, e.exercise_id, e.exercise_order, newSection);

    // In edit mode, don't delete from API
    if (editMode || removal(listRef.current, ex).removedSets.length === 0) {
      applyRemoval(ex.rowKey, removal);
    } else {
      await runRemoval(ex.rowKey, removal);
    }
  };

  // #371: position and announcement come from the current list, outside the
  // state updater; a move from an end does nothing at all.
  const handleMove = (exerciseId: string, exerciseOrder: number, dir: MoveDirection) => {
    const sorted = [...listRef.current].sort((a, b) => a.exercise_order - b.exercise_order);
    const from = sorted.findIndex(
      (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
    );
    const to = dir === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= sorted.length) return;
    const moved = sorted[from];
    const apply = dir === 'up' ? applyMoveUp : applyMoveDown;
    updateList((prev) => apply(prev, exerciseId, exerciseOrder));
    reorder.moved(moved.rowKey ?? '', dir, moved.exercise_name, to + 1, sorted.length);
  };

  const handleRemoveExercise = async (exerciseId: string, exerciseOrder: number) => {
    if (!token) return;
    const ex = findExercise(exerciseId, exerciseOrder);
    if (!ex?.rowKey) return;

    if (!confirm(`Remove ${ex.exercise_name}? Logged sets will be deleted.`)) return;

    const removal: Removal = (list, e) => ({
      exercises: list.filter((x) => x.rowKey !== e.rowKey),
      removedSets: e.sets,
    });

    // In edit mode, just remove locally — deletion happens on save
    if (editMode) {
      applyRemoval(ex.rowKey, removal);
    } else {
      await runRemoval(ex.rowKey, removal);
    }
  };

  const handleAddExercise = (ex: ExerciseWithRow) => {
    const maxOrder = listRef.current.reduce((max, e) => Math.max(max, e.exercise_order), 0);
    const newExercise: TrackerExercise = {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      exercise_order: maxOrder + 1,
      rowKey: newRowKey(),
      sets: [{
        set_number: 1,
        planned_reps: '',
        weight: '',
        reps: '',
        effort: '',
        saved: false,
        sheetRow: -1,
      }],
      quickFillWeight: '',
      quickFillReps: '',
      quickFillEffort: '',
    };
    updateList((prev) => [...prev, newExercise]);
    setShowExercisePicker(false);
  };

  const flushPendingSaves = (): Promise<void> => {
    return new Promise((resolve) => {
      // Clear all pending timers — they'll fire immediately
      for (const [key, timer] of saveTimers.current) {
        clearTimeout(timer);
        saveTimers.current.delete(key);
      }
      // Give a moment for any in-flight saves
      setTimeout(resolve, 100);
    });
  };

  const handleSaveEdits = async () => {
    if (!token) return;
    setFinishing(true);
    try {
      // Every set, warmups included: a stored set left out is deleted (#177).
      const editedSets = collectEditedSets(listRef.current);

      await saveWorkoutEdits(
        workoutId,
        // Weight workouts have no cardio or venue inputs, so those fields are
        // left out and never written; nor is any input left untouched.
        editInputsToPatch(editInitial, {
          date: editDate, name: editName, duration: editDuration, notes, effort: editEffort,
        }),
        editedSets,
        token,
      );
      goBack('/activities');
    } catch {
      // Error toast shown by action
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = async () => {
    if (!token) return;
    setFinishing(true);
    try {
      await flushPendingSaves();

      // Save any unsaved sets with data (skip warmup exercises — they are
      // list-only). One more tracker write: it starts only once every write
      // ahead of it has finished, and reads the list as they left it (#394).
      await enqueueWrite(async () => {
        for (const ex of listRef.current) {
          if (isWarmupExercise(ex)) continue;
          for (const set of ex.sets) {
            if (!set.saved && (set.weight || set.reps)) {
              await saveSet({
                workout_id: workoutId,
                exercise_id: ex.exercise_id,
                exercise_name: ex.exercise_name,
                section: ex.section,
                exercise_order: ex.exercise_order,
                set_number: set.set_number,
                planned_reps: set.planned_reps,
                weight: set.weight,
                reps: set.reps,
                effort: set.effort,
              }, token);
            }
          }
        }
      });

      await finishWorkout(workoutId, notes, finishEffort, token);
      navigate('/activities');
    } catch {
      // Error toast shown by action
    } finally {
      setFinishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!token) return;

    if (editMode) {
      if (!confirm('Discard changes? Your edits will not be saved.')) return;
      exitEditMode();
      goBack('/activities');
      return;
    }

    if (!confirm('Discard this workout? All logged sets will be deleted.')) return;
    setFinishing(true);
    try {
      await deleteWorkout(workoutId, token);
      navigate('/activities');
    } catch {
      // Error toast shown by action
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div class="screen workout-tracker">
      <div class="workout-tracker-header">
        <h2 class="workout-tracker-title">
          {editMode ? `Edit: ${workoutName}` : workoutName}
        </h2>
        {editMode ? (
          <button
            class="btn btn-primary"
            onClick={handleSaveEdits}
            disabled={finishing}
          >
            {finishing ? 'Saving...' : 'Save Changes'}
          </button>
        ) : (
          <button
            class="btn btn-primary"
            onClick={() => {
              // AC7: Guard against finishing with unsynced sets
              const queuedCount = pendingSyncCount.value;
              if (queuedCount > 0) {
                const ok = confirm(
                  `You have ${queuedCount} unsynced set${queuedCount === 1 ? '' : 's'}. Finish anyway? Your sets will sync next time you open the app.`,
                );
                if (!ok) return;
              }
              setShowFinishForm(!showFinishForm);
            }}
            disabled={finishing}
          >
            Finish
          </button>
        )}
      </div>

      {/* Sync status bar (AC2) — hidden when queue is empty */}
      {pendingSyncCount.value > 0 && (
        <button
          class="sync-status-bar"
          onClick={async () => {
            if (isSyncing.value || !token) return;
            const result = await flushQueue(token);
            if (result.remaining === 0 && result.synced > 0) {
              showToast(`${result.synced} set${result.synced === 1 ? '' : 's'} saved`, 'success');
            } else if (result.failed > 0) {
              showToast('Some sets failed to sync — will retry on reconnect', 'error');
            }
          }}
          disabled={isSyncing.value}
          aria-live="polite"
          aria-label={`${pendingSyncCount.value} unsynced set${pendingSyncCount.value === 1 ? '' : 's'}, tap to sync now`}
        >
          {isSyncing.value
            ? 'Syncing…'
            : `${pendingSyncCount.value} unsynced — Sync now`}
        </button>
      )}

      {/* Edit mode metadata fields */}
      {editMode && (
        <div class="finish-form" style={{ marginBottom: 'var(--space-md)' }}>
          <div class="form-group">
            <label class="form-label" htmlFor="tracker-edit-name">Name</label>
            <input
              id="tracker-edit-name"
              class="form-input"
              type="text"
              value={editName}
              onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label" htmlFor="tracker-edit-date">Date</label>
            <input
              id="tracker-edit-date"
              class="form-input"
              type="date"
              value={editDate}
              onInput={(e) => setEditDate((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label" htmlFor="tracker-edit-duration">Duration (minutes)</label>
            <input
              id="tracker-edit-duration"
              class="form-input"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={editDuration}
              onInput={(e) => setEditDuration((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label">Session Effort (optional)</label>
            <EffortToggle
              value={editEffort}
              onChange={setEditEffort}
              size="session"
              label="Session effort"
            />
          </div>
          <div class="form-group">
            <label class="form-label" htmlFor="tracker-edit-notes">Notes</label>
            <textarea
              id="tracker-edit-notes"
              class="form-textarea"
              placeholder="How did it go?"
              rows={3}
              value={notes}
              onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            />
          </div>
        </div>
      )}

      {/* Finish modal (non-edit mode only) */}
      {!editMode && showFinishForm && (
        <FinishWorkoutModal
          notes={notes}
          onNotesChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          effort={finishEffort}
          onEffortChange={setFinishEffort}
          onFinish={handleFinish}
          onCancel={() => setShowFinishForm(false)}
          finishing={finishing}
        />
      )}

      {/* aria-live region for reorder announcements */}
      <div
        role="status"
        aria-live="polite"
        class="sr-only"
      >
        {reorder.announcement}
      </div>

      <div class="tracker-exercise-list" ref={reorder.listRef}>
        {exerciseList.length === 0 && (
          <div class="empty-state">
            <p>No exercises yet</p>
            <p>Add exercises to start tracking</p>
          </div>
        )}

        {(() => {
          const sorted = [...exerciseList].sort((a, b) => a.exercise_order - b.exercise_order);
          return sorted.map((ex, idx) => (
            <ExerciseRow
              key={ex.rowKey ?? `${ex.exercise_id}-${ex.exercise_order}`}
              exercise={ex}
              currentWorkoutId={workoutId}
              onUpdateSet={(setNum, updates) =>
                handleUpdateSet(ex.exercise_id, ex.exercise_order, setNum, updates)
              }
              onAddSet={() => handleAddSet(ex.exercise_id, ex.exercise_order)}
              onRemoveSet={(setNum) =>
                handleRemoveSet(ex.exercise_id, ex.exercise_order, setNum)
              }
              onQuickFillWeight={(weight) =>
                handleQuickFillWeight(ex.exercise_id, ex.exercise_order, weight)
              }
              onQuickFillReps={(reps) =>
                handleQuickFillReps(ex.exercise_id, ex.exercise_order, reps)
              }
              onQuickFillEffort={(effort) =>
                handleQuickFillEffort(ex.exercise_id, ex.exercise_order, effort)
              }
              onCopyDown={(lastTimeSets) =>
                handleCopyDown(ex.exercise_id, ex.exercise_order, lastTimeSets)
              }
              onChangeSection={(newSection) =>
                handleChangeSection(ex.exercise_id, ex.exercise_order, newSection)
              }
              onMoveUp={() => handleMove(ex.exercise_id, ex.exercise_order, 'up')}
              onMoveDown={() => handleMove(ex.exercise_id, ex.exercise_order, 'down')}
              onRemoveExercise={() => handleRemoveExercise(ex.exercise_id, ex.exercise_order)}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              totalExercises={sorted.length}
            />
          ));
        })()}
      </div>

      <button
        class="btn btn-secondary"
        style={{ width: '100%', marginTop: 'var(--space-md)' }}
        onClick={() => setShowExercisePicker(true)}
      >
        + Add Exercise
      </button>

      <button
        class="btn btn-danger"
        style={{ width: '100%', marginTop: 'var(--space-sm)' }}
        onClick={handleDiscard}
        disabled={finishing}
      >
        {editMode ? 'Discard Changes' : 'Discard Workout'}
      </button>

      {showExercisePicker && (
        <AddExerciseModal
          onSelect={handleAddExercise}
          onClose={() => setShowExercisePicker(false)}
        />
      )}
    </div>
  );
}
