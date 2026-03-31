import { useState, useRef } from 'preact/hooks';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { ExerciseCompactCard } from '../shared/exercise-compact-card';
import { SectionPicker } from '../shared/section-picker';
import type { ExerciseWithRow } from '../../api/types';

export interface PlannerExercise {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
}

interface Props {
  initialName?: string;
  initialExercises?: PlannerExercise[];
  onSave: (name: string, exercises: PlannerExercise[]) => Promise<void>;
  onDiscard: () => void;
  saving: boolean;
}

export function WorkoutPlanner({ initialName = '', initialExercises = [], onSave, onDiscard, saving }: Props) {
  const startName = initialName || 'Custom Workout';
  const [name, setName] = useState(startName);
  const [exercises, setExercises] = useState<PlannerExercise[]>(initialExercises);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);

  const initialSnapshot = useRef({ name: startName, exercises: JSON.stringify(initialExercises) });

  const isDirty = () => {
    if (name !== initialSnapshot.current.name) return true;
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
    setShowExercisePicker(false);
    setEditingIndex(exercises.length);
  };

  const updateExercise = (index: number, updated: Partial<PlannerExercise>) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, ...updated } : ex)),
    );
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    if (editingIndex === index) setEditingIndex(index - 1);
    else if (editingIndex === index - 1) setEditingIndex(index);
  };

  const moveDown = (index: number) => {
    if (index >= exercises.length - 1) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    if (editingIndex === index) setEditingIndex(index + 1);
    else if (editingIndex === index + 1) setEditingIndex(index);
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(-1);
    else if (editingIndex > index) setEditingIndex(editingIndex - 1);
  };

  const handleSave = async () => {
    if (exercises.length === 0) return;
    await onSave(name.trim() || 'Custom Workout', exercises);
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
        <label class="form-label">Workout Name</label>
        <input
          class="form-input"
          type="text"
          placeholder="e.g. Upper Push A"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="compact-card-list">
        {exercises.length === 0 && (
          <div class="empty-state">
            <p>No exercises yet</p>
            <p>Add exercises to plan your workout</p>
          </div>
        )}

        {exercises.map((ex, i) => (
          <div key={`${ex.exercise_id}-${i}`}>
            <ExerciseCompactCard
              section={ex.section}
              exerciseName={ex.exercise_name}
              sets={ex.sets}
              reps={ex.reps}
              editable
              index={i}
              total={exercises.length}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
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

      {showExercisePicker && (
        <AddExerciseModal
          onSelect={handleExerciseSelected}
          onClose={() => setShowExercisePicker(false)}
        />
      )}
    </div>
  );
}
