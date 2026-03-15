import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { activeWorkoutSets, activeWarmupExercises } from '../../state/store';
import { saveSet, removeSet, finishWorkout, deleteWorkout } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { ExerciseRow } from './exercise-row';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { ExerciseWithRow, Effort, SetWithRow } from '../../api/types';
import { applyQuickFillWeight, applyQuickFillReps } from './quick-fill';
import { applyCopyDown } from './copy-down';
import { isWarmupExercise } from './warmup';
import { applyChangeSection, applyMoveUp, applyMoveDown } from './section-management';

interface Props {
  workoutId: string;
  workoutName: string;
}

/** Build TrackerExercise list from flat set rows. */
function buildExerciseList(setRows: typeof activeWorkoutSets.value): TrackerExercise[] {
  const map = new Map<string, TrackerExercise>();

  for (const s of setRows) {
    // Key by exercise_id + exercise_order to distinguish same exercise in different sections
    const key = `${s.exercise_id}__${s.exercise_order}`;
    let ex = map.get(key);
    if (!ex) {
      ex = {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
        quickFillWeight: '',
        quickFillReps: '',
      };
      map.set(key, ex);
    }
    ex.sets.push({
      set_number: s.set_number,
      planned_reps: s.planned_reps,
      weight: s.weight,
      reps: s.reps,
      effort: s.effort as Effort | '',
      notes: s.notes,
      saved: s.sheetRow > 0,
      sheetRow: s.sheetRow,
    });
  }

  // Sort exercises by order, sets by set_number
  const list = Array.from(map.values()).sort((a, b) => a.exercise_order - b.exercise_order);
  for (const ex of list) {
    ex.sets.sort((a, b) => a.set_number - b.set_number);
  }
  return list;
}

export function WorkoutTracker({ workoutId, workoutName }: Props) {
  const { token } = useAuth();
  const [exerciseList, setExerciseList] = useState<TrackerExercise[]>([]);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState('');
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const saveTimers = useRef<Map<string, number>>(new Map());

  // Initialize from signal, merging warmup exercises (list-only, no sets)
  useEffect(() => {
    const tracked = buildExerciseList(activeWorkoutSets.value);
    const warmups: TrackerExercise[] = activeWarmupExercises.value.map((w) => ({
      exercise_id: w.exercise_id,
      exercise_name: w.exercise_name,
      section: 'warmup',
      exercise_order: w.exercise_order,
      sets: [],
      quickFillWeight: '',
      quickFillReps: '',
    }));
    const merged = [...warmups, ...tracked].sort((a, b) => a.exercise_order - b.exercise_order);
    setExerciseList(merged);
  }, []);

  // Debounced save for a specific set
  const debouncedSave = useCallback((exerciseOrder: number, exerciseId: string, set: TrackerSet) => {
    if (!token) return;
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
  }, [token, workoutId, exerciseList]);

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

      // Schedule save for the updated set
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
      // Schedule save for filled sets that have reps
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

    // Delete removed saved sets from API (bottom-to-top)
    if (token) {
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

    // Trigger auto-save for all copied sets
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

    // Delete saved sets bottom-to-top when converting to warmup
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

    // Delete saved sets bottom-to-top
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
        <h2 class="workout-tracker-title">{workoutName}</h2>
        <button
          class="btn btn-primary"
          onClick={() => setShowFinishForm(!showFinishForm)}
          disabled={finishing}
        >
          Finish
        </button>
      </div>

      {showFinishForm && (
        <div class="finish-form">
          <div class="form-group">
            <label class="form-label">Workout Notes (optional)</label>
            <textarea
              class="form-textarea"
              placeholder="How did it go?"
              rows={3}
              value={notes}
              onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            />
          </div>
          <div class="finish-form-actions">
            <button
              class="btn btn-primary"
              onClick={handleFinish}
              disabled={finishing}
              style={{ flex: 1 }}
            >
              {finishing ? 'Saving...' : 'Save & Finish'}
            </button>
            <button
              class="btn btn-secondary"
              onClick={() => setShowFinishForm(false)}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
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
        Discard Workout
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
