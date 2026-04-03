import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { activeWorkoutSets, activeWarmupExercises, isEditMode, workouts, pendingSyncCount, isSyncing, showToast } from '../../state/store';
import { saveSet, removeSet, finishWorkout, deleteWorkout, saveWorkoutEdits, exitEditMode } from '../../state/actions';
import { flushQueue } from '../../api/sync-queue';
import type { EditSetData } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
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

interface Props {
  workoutId: string;
  workoutName: string;
}

export function WorkoutTracker({ workoutId, workoutName }: Props) {
  const { token } = useAuth();
  const editMode = isEditMode.value;
  const workout = workouts.value.find((w) => w.id === workoutId);

  const [exerciseList, setExerciseList] = useState<TrackerExercise[]>([]);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState(editMode ? (workout?.notes || '') : '');
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const saveTimers = useRef<Map<string, number>>(new Map());
  const finishBtnRef = useRef<HTMLButtonElement>(null);

  // Edit mode metadata
  const [editDate, setEditDate] = useState(workout?.date || '');
  const [editName, setEditName] = useState(workout?.name || '');
  const [editDuration, setEditDuration] = useState(workout?.duration_min || '');

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
    setExerciseList(mergeWarmups(tracked, activeWarmupExercises.value));
  }, []);

  // Debounced save for a specific set (disabled in edit mode)
  const debouncedSave = useCallback((exerciseOrder: number, exerciseId: string, set: TrackerSet) => {
    if (!token || editMode) return;
    // Only save if there's meaningful data
    if (!set.weight && !set.reps) return;

    const key = `${exerciseId}__${exerciseOrder}__${set.set_number}`;
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);

    const timer = window.setTimeout(async () => {
      saveTimers.current.delete(key);

      const ex = exerciseList.find(
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
          notes: set.notes,
        }, token);

        // Mark as saved
        setExerciseList((prev) =>
          prev.map((e) =>
            e.exercise_id === exerciseId && e.exercise_order === exerciseOrder
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
    }, 1000);

    saveTimers.current.set(key, timer);
  }, [token, workoutId, exerciseList, editMode]);

  const handleUpdateSet = (
    exerciseId: string,
    exerciseOrder: number,
    setNumber: number,
    updates: Partial<TrackerSet>,
  ) => {
    setExerciseList((prev) => {
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
    setExerciseList((prev) => {
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
    setExerciseList((prev) => {
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
    setExerciseList((prev) => {
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

  const handleCopyDown = async (exerciseId: string, exerciseOrder: number, lastTimeSets: SetWithRow[]) => {
    const ex = exerciseList.find(
      (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
    );
    if (!ex) return;

    // AC3: Confirmation when removing sets
    if (lastTimeSets.length < ex.sets.length) {
      const ok = confirm(`Replace ${ex.sets.length} sets with ${lastTimeSets.length} from last time?`);
      if (!ok) return;
    }

    const { exercises: updated, removedSets } = applyCopyDown(
      exerciseList, exerciseId, exerciseOrder, lastTimeSets,
    );

    // In edit mode, don't delete from API — just update local state
    if (!editMode && token) {
      const savedRemoved = removedSets
        .filter((s) => s.sheetRow > 0)
        .sort((a, b) => b.sheetRow - a.sheetRow);
      for (const s of savedRemoved) {
        try {
          await removeSet({
            workout_id: workoutId,
            exercise_id: exerciseId,
            exercise_name: ex.exercise_name,
            section: ex.section,
            exercise_order: exerciseOrder,
            set_number: s.set_number,
            planned_reps: s.planned_reps,
            weight: s.weight,
            reps: s.reps,
            effort: s.effort,
            notes: s.notes,
            sheetRow: s.sheetRow,
          }, token);
        } catch {
          return; // Error toast shown by action
        }
      }
    }

    setExerciseList(updated);

    // Trigger auto-save for all copied sets (no-op in edit mode)
    if (!editMode) {
      const updatedEx = updated.find(
        (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
      );
      if (updatedEx) {
        for (const s of updatedEx.sets) {
          if (s.weight || s.reps) {
            setTimeout(() => debouncedSave(exerciseOrder, exerciseId, s), 0);
          }
        }
      }
    }
  };

  const handleAddSet = (exerciseId: string, exerciseOrder: number) => {
    setExerciseList((prev) =>
      prev.map((ex) => {
        if (ex.exercise_id !== exerciseId || ex.exercise_order !== exerciseOrder) return ex;
        const maxSetNum = ex.sets.reduce((max, s) => Math.max(max, s.set_number), 0);
        const newSet: TrackerSet = {
          set_number: maxSetNum + 1,
          planned_reps: ex.sets[0]?.planned_reps || '',
          weight: ex.quickFillWeight || '',
          reps: '',
          effort: '',
          notes: '',
          saved: false,
          sheetRow: -1,
        };
        return { ...ex, sets: [...ex.sets, newSet] };
      }),
    );
  };

  const handleRemoveSet = async (exerciseId: string, exerciseOrder: number, setNumber: number) => {
    if (!token) return;

    // In edit mode, just remove from local state — deletion happens on save
    if (!editMode) {
      const ex = exerciseList.find(
        (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
      );
      const set = ex?.sets.find((s) => s.set_number === setNumber);

      if (set && set.sheetRow > 0) {
        try {
          await removeSet({
            workout_id: workoutId,
            exercise_id: exerciseId,
            exercise_name: ex!.exercise_name,
            section: ex!.section,
            exercise_order: exerciseOrder,
            set_number: setNumber,
            planned_reps: set.planned_reps,
            weight: set.weight,
            reps: set.reps,
            effort: set.effort,
            notes: set.notes,
            sheetRow: set.sheetRow,
          }, token);
        } catch {
          return; // Error toast shown by action
        }
      }
    }

    setExerciseList((prev) =>
      prev.map((e) => {
        if (e.exercise_id !== exerciseId || e.exercise_order !== exerciseOrder) return e;
        return { ...e, sets: e.sets.filter((s) => s.set_number !== setNumber) };
      }),
    );
  };

  const handleChangeSection = async (exerciseId: string, exerciseOrder: number, newSection: string) => {
    if (!token) return;
    const { exercises: updated, removedSets } = applyChangeSection(exerciseList, exerciseId, exerciseOrder, newSection);

    // In edit mode, don't delete from API
    if (!editMode) {
      const savedRemoved = removedSets
        .filter((s) => s.sheetRow > 0)
        .sort((a, b) => b.sheetRow - a.sheetRow);
      for (const s of savedRemoved) {
        const ex = exerciseList.find(
          (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
        );
        try {
          await removeSet({
            workout_id: workoutId,
            exercise_id: exerciseId,
            exercise_name: ex?.exercise_name ?? '',
            section: ex?.section ?? '',
            exercise_order: exerciseOrder,
            set_number: s.set_number,
            planned_reps: s.planned_reps,
            weight: s.weight,
            reps: s.reps,
            effort: s.effort,
            notes: s.notes,
            sheetRow: s.sheetRow,
          }, token);
        } catch {
          return; // Error toast shown by action
        }
      }
    }

    setExerciseList(updated);
  };

  const handleMoveUp = (exerciseId: string, exerciseOrder: number) => {
    setExerciseList((prev) => {
      const next = applyMoveUp(prev, exerciseId, exerciseOrder);
      const sorted = [...next].sort((a, b) => a.exercise_order - b.exercise_order);
      const movedEx = next.find(
        (e) => e.exercise_id === exerciseId,
      );
      if (movedEx) {
        const newPos = sorted.findIndex(
          (e) => e.exercise_id === movedEx.exercise_id && e.exercise_order === movedEx.exercise_order,
        ) + 1;
        setReorderAnnouncement(
          `${movedEx.exercise_name} moved to position ${newPos} of ${sorted.length}`,
        );
      }
      return next;
    });
  };

  const handleMoveDown = (exerciseId: string, exerciseOrder: number) => {
    setExerciseList((prev) => {
      const next = applyMoveDown(prev, exerciseId, exerciseOrder);
      const sorted = [...next].sort((a, b) => a.exercise_order - b.exercise_order);
      const movedEx = next.find(
        (e) => e.exercise_id === exerciseId,
      );
      if (movedEx) {
        const newPos = sorted.findIndex(
          (e) => e.exercise_id === movedEx.exercise_id && e.exercise_order === movedEx.exercise_order,
        ) + 1;
        setReorderAnnouncement(
          `${movedEx.exercise_name} moved to position ${newPos} of ${sorted.length}`,
        );
      }
      return next;
    });
  };

  const handleRemoveExercise = async (exerciseId: string, exerciseOrder: number) => {
    if (!token) return;
    const ex = exerciseList.find(
      (e) => e.exercise_id === exerciseId && e.exercise_order === exerciseOrder,
    );
    if (!ex) return;

    if (!confirm(`Remove ${ex.exercise_name}? Logged sets will be deleted.`)) return;

    // In edit mode, just remove locally — deletion happens on save
    if (!editMode) {
      const savedSets = ex.sets
        .filter((s) => s.sheetRow > 0)
        .sort((a, b) => b.sheetRow - a.sheetRow);
      for (const s of savedSets) {
        try {
          await removeSet({
            workout_id: workoutId,
            exercise_id: exerciseId,
            exercise_name: ex.exercise_name,
            section: ex.section,
            exercise_order: exerciseOrder,
            set_number: s.set_number,
            planned_reps: s.planned_reps,
            weight: s.weight,
            reps: s.reps,
            effort: s.effort,
            notes: s.notes,
            sheetRow: s.sheetRow,
          }, token);
        } catch {
          return; // Error toast shown by action
        }
      }
    }

    setExerciseList((prev) =>
      prev.filter((e) => !(e.exercise_id === exerciseId && e.exercise_order === exerciseOrder)),
    );
  };

  const handleAddExercise = (ex: ExerciseWithRow) => {
    const maxOrder = exerciseList.reduce((max, e) => Math.max(max, e.exercise_order), 0);
    const newExercise: TrackerExercise = {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      exercise_order: maxOrder + 1,
      sets: [{
        set_number: 1,
        planned_reps: '',
        weight: '',
        reps: '',
        effort: '',
        notes: '',
        saved: false,
        sheetRow: -1,
      }],
      quickFillWeight: '',
      quickFillReps: '',
      quickFillEffort: '',
    };
    setExerciseList((prev) => [...prev, newExercise]);
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
      // Collect all sets from exercise list (skip warmup)
      const editedSets: EditSetData[] = [];
      for (const ex of exerciseList) {
        if (isWarmupExercise(ex)) continue;
        for (const set of ex.sets) {
          editedSets.push({
            exercise_id: ex.exercise_id,
            exercise_name: ex.exercise_name,
            section: ex.section,
            exercise_order: ex.exercise_order,
            set_number: set.set_number,
            planned_reps: set.planned_reps,
            weight: set.weight,
            reps: set.reps,
            effort: set.effort,
            notes: set.notes,
            sheetRow: set.sheetRow,
          });
        }
      }

      await saveWorkoutEdits(
        workoutId,
        { date: editDate, name: editName.trim(), notes: notes.trim(), duration_min: editDuration },
        editedSets,
        token,
      );
      navigate(`/history/${workoutId}`);
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

      // Save any unsaved sets with data (skip warmup exercises — they are list-only)
      for (const ex of exerciseList) {
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
              notes: set.notes,
            }, token);
          }
        }
      }

      await finishWorkout(workoutId, notes, token);
      navigate('/');
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
      navigate(`/history/${workoutId}`);
      return;
    }

    if (!confirm('Discard this workout? All logged sets will be deleted.')) return;
    setFinishing(true);
    try {
      await deleteWorkout(workoutId, token);
      navigate('/');
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
            ref={finishBtnRef}
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
            <label class="form-label">Name</label>
            <input
              class="form-input"
              type="text"
              value={editName}
              onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label">Date</label>
            <input
              class="form-input"
              type="date"
              value={editDate}
              onInput={(e) => setEditDate((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label">Duration (minutes)</label>
            <input
              class="form-input"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={editDuration}
              onInput={(e) => setEditDuration((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea
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
          onFinish={handleFinish}
          onCancel={() => {
            setShowFinishForm(false);
            finishBtnRef.current?.focus();
          }}
          finishing={finishing}
        />
      )}

      {/* aria-live region for reorder announcements */}
      <div
        role="status"
        aria-live="polite"
        class="sr-only"
      >
        {reorderAnnouncement}
      </div>

      <div class="tracker-exercise-list">
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
              key={`${ex.exercise_id}-${ex.exercise_order}`}
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
              onMoveUp={() => handleMoveUp(ex.exercise_id, ex.exercise_order)}
              onMoveDown={() => handleMoveDown(ex.exercise_id, ex.exercise_order)}
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
