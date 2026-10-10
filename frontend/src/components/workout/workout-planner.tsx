import { useState, useRef } from 'preact/hooks';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { ExerciseCompactCard } from '../shared/exercise-compact-card';
import { newRowKey, swapAt, useReorderFocus, type MoveDirection } from '../shared/reorder-focus';
import { SectionPicker } from '../shared/section-picker';
import type { ExerciseWithRow } from '../../api/types';
import { toLocalDateStr } from '../activities/activities-helpers';
import { estimateMinutesToSeconds, secondsToMinutesInput } from '../../api/duration';

export interface PlannerExercise {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
  /**
   * Set only by the planned-workout editor (#350), and never changed after
   * open: the Reps value the entry was pre-filled with, and the stored
   * `planned_reps` of the rows it was built from, in set order. The planner
   * passes both through untouched.
   */
  initial_reps?: string;
  stored_planned_reps?: string[];
  /**
   * Set only by the planned-workout editor (#380), warmups included, and
   * never changed after open: the stored `exercise_order` this entry was
   * built from, so its weight, reps and effort follow it on save. The
   * planner passes it through untouched.
   */
  source_order?: number;
}

interface Props {
  initialName?: string;
  initialExercises?: PlannerExercise[];
  /** Scheduled date (YYYY-MM-DD). Defaults to today for new plans. */
  initialDate?: string;
  /**
   * The plan's estimate as stored, in seconds (#145). Blank for a new plan:
   * there is no template default, so nothing is pre-filled.
   */
  initialEstimatedSeconds?: string;
  /** `estimatedSeconds` is seconds for `Workouts!AA`, or '' when left blank. */
  onSave: (name: string, exercises: PlannerExercise[], date: string, estimatedSeconds: string) => Promise<void>;
  onDiscard: () => void;
  saving: boolean;
}

export function WorkoutPlanner({ initialName = '', initialExercises = [], initialDate, initialEstimatedSeconds = '', onSave, onDiscard, saving }: Props) {
  const startName = initialName || 'Custom Workout';
  const startDate = initialDate || toLocalDateStr(new Date());
  const startEstimate = secondsToMinutesInput(initialEstimatedSeconds);
  const [name, setName] = useState(startName);
  const [date, setDate] = useState(startDate);
  // Whole minutes, as typed. Converted to seconds only on save.
  const [estimate, setEstimate] = useState(startEstimate);
  const [exercises, setExercises] = useState<PlannerExercise[]>(initialExercises);
  // Client-only row identities, parallel to `exercises` (#328): never on a
  // PlannerExercise, so nothing built from one can carry it to the sheet.
  const [rowKeys, setRowKeys] = useState<string[]>(() => initialExercises.map(() => newRowKey()));
  const reorder = useReorderFocus();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);

  const initialSnapshot = useRef({ name: startName, date: startDate, estimate: startEstimate, exercises: JSON.stringify(initialExercises) });

  const isDirty = () => {
    if (name !== initialSnapshot.current.name) return true;
    if (date !== initialSnapshot.current.date) return true;
    if (estimate !== initialSnapshot.current.estimate) return true;
    if (JSON.stringify(exercises) !== initialSnapshot.current.exercises) return true;
    return false;
  };

  const handleExerciseSelected = (ex: ExerciseWithRow) => {
    const slot: PlannerExercise = {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      sets: '1',
      reps: '',
    };
    setExercises((prev) => [...prev, slot]);
    setRowKeys((prev) => [...prev, newRowKey()]);
    setShowExercisePicker(false);
    setEditingIndex(exercises.length);
  };

  const updateExercise = (index: number, updated: Partial<PlannerExercise>) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, ...updated } : ex)),
    );
  };

  const move = (index: number, dir: MoveDirection) => {
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= exercises.length) return;
    setExercises((prev) => swapAt(prev, index, to));
    setRowKeys((prev) => swapAt(prev, index, to));
    if (editingIndex === index) setEditingIndex(to);
    else if (editingIndex === to) setEditingIndex(index);
    reorder.moved(rowKeys[index], dir, exercises[index].exercise_name, to + 1, exercises.length);
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    setRowKeys((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(-1);
    else if (editingIndex > index) setEditingIndex(editingIndex - 1);
  };

  const handleSave = async () => {
    if (exercises.length === 0) return;
    await onSave(name.trim() || 'Custom Workout', exercises, date, estimateMinutesToSeconds(estimate));
  };

  return (
    <div class="screen template-editor">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => {
            if (isDirty() && !confirm('Discard changes? Your edits will not be saved.')) return;
            onDiscard();
          }}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary"
          onClick={handleSave}
          disabled={saving || exercises.length === 0}
        >
          {saving ? 'Saving...' : 'Save Workout'}
        </button>
      </div>

      <div class="form-group">
        <label class="form-label" for="planner-name">Workout Name</label>
        <input
          id="planner-name"
          class="form-input"
          type="text"
          placeholder="e.g. Upper Push A"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="planner-date">Scheduled for</label>
        <input
          id="planner-date"
          class="form-input"
          type="date"
          value={date}
          onInput={(e) => setDate((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="planner-estimate">Estimated duration (minutes, optional)</label>
        <input
          id="planner-estimate"
          class="form-input"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          placeholder="e.g. 45"
          value={estimate}
          onInput={(e) => setEstimate((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="compact-card-list" ref={reorder.listRef}>
        {exercises.length === 0 && (
          <div class="empty-state">
            <p>No exercises yet</p>
            <p>Add exercises to plan your workout</p>
          </div>
        )}

        {exercises.map((ex, i) => (
          <div key={rowKeys[i] ?? `pos-${i}`} data-row-key={rowKeys[i]}>
            <ExerciseCompactCard
              section={ex.section}
              exerciseName={ex.exercise_name}
              sets={ex.sets}
              reps={ex.reps}
              editable
              index={i}
              total={exercises.length}
              onMoveUp={() => move(i, 'up')}
              onMoveDown={() => move(i, 'down')}
              onClick={() => setEditingIndex(editingIndex === i ? -1 : i)}
              onRemove={() => removeExercise(i)}
            />

            {editingIndex === i && (
              <div class="template-exercise-config">
                <SectionPicker
                  value={ex.section}
                  onChange={(section) => updateExercise(i, { section })}
                />

                <div class="config-row" style={{ marginTop: 'var(--space-sm)' }}>
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Sets</label>
                    <input
                      class="form-input"
                      type="number"
                      min="1"
                      max="20"
                      placeholder="e.g. 3"
                      value={ex.sets}
                      onInput={(e) =>
                        updateExercise(i, { sets: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Reps</label>
                    <input
                      class="form-input"
                      type="number"
                      min="0"
                      placeholder="e.g. 10"
                      value={ex.reps}
                      onInput={(e) =>
                        updateExercise(i, { reps: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        class="btn btn-secondary"
        style={{ width: '100%', marginTop: 'var(--space-md)' }}
        onClick={() => setShowExercisePicker(true)}
      >
        + Add Exercise
      </button>

      <button
        class="btn btn-ghost"
        style={{ width: '100%', marginTop: 'var(--space-md)' }}
        onClick={() => {
          if (isDirty() && !confirm('Discard changes? Your edits will not be saved.')) return;
          onDiscard();
        }}
      >
        Discard
      </button>

      {/* Mounted empty with the screen so the first move is announced (#328). */}
      <div role="status" aria-live="polite" class="sr-only">
        {reorder.announcement}
      </div>

      {showExercisePicker && (
        <AddExerciseModal
          onSelect={handleExerciseSelected}
          onClose={() => setShowExercisePicker(false)}
        />
      )}
    </div>
  );
}
