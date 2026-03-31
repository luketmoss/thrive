import { sectionBadgeClass } from '../shared/section-utils';

export interface TemplateExerciseSlot {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
}

interface Props {
  exercise: TemplateExerciseSlot;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

export function TemplateExerciseRow({ exercise, index, total, onMoveUp, onMoveDown, onEdit, onRemove }: Props) {
  const setsReps = exercise.sets && exercise.reps
    ? `${exercise.sets} × ${exercise.reps}`
    : exercise.sets
      ? `${exercise.sets} sets`
      : exercise.reps
        ? `${exercise.reps} reps`
        : '';

  return (
    <div class="template-exercise-row">
      <div class="template-exercise-row-reorder">
        <button
          class="reorder-btn"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="Move up"
        >
          ▲
        </button>
        <button
          class="reorder-btn"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="Move down"
        >
          ▼
        </button>
      </div>

      <div class="template-exercise-row-body" onClick={onEdit}>
        <div class="template-exercise-row-top">
          <span class={sectionBadgeClass(exercise.section)}>{exercise.section}</span>
          <span class="template-exercise-row-name">{exercise.exercise_name}</span>
        </div>
        {setsReps && (
          <div class="template-exercise-row-meta">
            <span>{setsReps}</span>
          </div>
        )}
      </div>

      <button class="template-exercise-row-remove" onClick={onRemove} aria-label="Remove exercise">
        ✕
      </button>
    </div>
  );
}
