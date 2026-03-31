import { useState } from 'preact/hooks';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import type { BuilderExercise } from '../../api/types';
import type { ExerciseWithRow } from '../../api/types';

interface Props {
  onBack: () => void;
  onStartWorkout: (exercises: BuilderExercise[]) => Promise<void>;
  onSaveAsPlanned: (exercises: BuilderExercise[]) => Promise<void>;
  starting: boolean;
  saving: boolean;
}

export function WorkoutBuilder({ onBack, onStartWorkout, onSaveAsPlanned, starting, saving }: Props) {
  const [exercises, setExercises] = useState<BuilderExercise[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const busy = starting || saving;

  const handleAddExercise = (ex: ExerciseWithRow) => {
    if (exercises.some((e) => e.exercise_id === ex.id)) {
      setShowAddModal(false);
      return;
    }
    setExercises((prev) => [...prev, {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      sets: 3,
      planned_reps: '',
    }]);
    setShowAddModal(false);
  };

  const handleRemove = (exerciseId: string) => {
    setExercises((prev) => prev.filter((e) => e.exercise_id !== exerciseId));
  };

  const handleSetCountChange = (exerciseId: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return;
    const clamped = Math.min(num, 20);
    setExercises((prev) => prev.map((e) =>
      e.exercise_id === exerciseId ? { ...e, sets: clamped } : e,
    ));
  };

  const handlePlannedRepsChange = (exerciseId: string, value: string) => {
    setExercises((prev) => prev.map((e) =>
      e.exercise_id === exerciseId ? { ...e, planned_reps: value } : e,
    ));
  };

  const handleStart = async () => {
    await onStartWorkout(exercises);
  };

  const handleSave = async () => {
    await onSaveAsPlanned(exercises);
  };

  return (
    <div class="screen builder-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={onBack}
          aria-label="Back to template picker"
        >
          ← Back
        </button>
      </div>

      <h2 style={{ marginBottom: 'var(--space-lg)' }}>Custom Workout</h2>

      <div class="screen-body builder-body">
        {exercises.length === 0 ? (
          <div class="empty-state">
            <p>Add exercises to plan your workout, or tap Start Workout to begin an empty session</p>
          </div>
        ) : (
          <div class="builder-exercise-list">
            {exercises.map((ex) => (
              <div key={ex.exercise_id} class="builder-exercise-row">
                <div class="builder-exercise-header">
                  <span class="builder-exercise-name">{ex.exercise_name}</span>
                  <button
                    class="btn btn-ghost builder-remove-btn"
                    onClick={() => handleRemove(ex.exercise_id)}
                    aria-label={`Remove ${ex.exercise_name}`}
                  >
                    ✕
                  </button>
                </div>
                <div class="builder-exercise-config">
                  <div class="builder-exercise-field">
                    <label for={`sets-${ex.exercise_id}`}>Sets</label>
                    <input
                      id={`sets-${ex.exercise_id}`}
                      class="form-input"
                      type="number"
                      min="1"
                      max="20"
                      value={ex.sets}
                      onInput={(e) => handleSetCountChange(ex.exercise_id, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div class="builder-exercise-field">
                    <label for={`reps-${ex.exercise_id}`}>Planned reps</label>
                    <input
                      id={`reps-${ex.exercise_id}`}
                      class="form-input"
                      type="text"
                      placeholder="e.g. 8-12"
                      value={ex.planned_reps}
                      onInput={(e) => handlePlannedRepsChange(ex.exercise_id, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          class="btn btn-secondary builder-add-btn"
          onClick={() => setShowAddModal(true)}
        >
          + Add Exercise
        </button>
      </div>

      <div class="builder-footer">
        <button
          class="btn btn-primary builder-footer-btn"
          onClick={handleStart}
          disabled={busy}
        >
          {starting ? 'Starting\u2026' : 'Start Workout'}
        </button>
        <button
          class="btn btn-secondary builder-footer-btn"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? 'Saving\u2026' : 'Save as Planned'}
        </button>
      </div>

      {showAddModal && (
        <AddExerciseModal
          onSelect={handleAddExercise}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
