import type { Section } from '../../api/types';

export interface TemplateExerciseSlot {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
  rest_seconds: string;
  group_rest_seconds: string;
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

function sectionBadgeClass(section: string): string {
  if (section === 'warmup') return 'section-badge section-warmup';
  if (section === 'primary') return 'section-badge section-primary';
  if (section.startsWith('SS')) return 'section-badge section-ss';
  if (section === 'burnout') return 'section-badge section-burnout';
  if (section === 'cooldown') return 'section-badge section-cooldown';
  return 'section-badge';
}

export function TemplateExerciseRow({ exercise, index, total, onMoveUp, onMoveDown, onEdit, onRemove }: Props) {
  const setsReps = exercise.sets && exercise.reps
    ? `${exercise.sets} × ${exercise.reps}`
    : exercise.sets
      ? `${exercise.sets} sets`
      : exercise.reps
        ? `${exercise.reps} reps`
        : '';

  const restInfo = exercise.rest_seconds
    ? `${exercise.rest_seconds}s rest`
    : '';

  const groupRest = exercise.group_rest_seconds
    ? `${exercise.group_rest_seconds}s group`
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
        {(setsReps || restInfo || groupRest) && (
          <div class="template-exercise-row-meta">
            {setsReps && <span>{setsReps}</span>}
            {restInfo && <span>{restInfo}</span>}
            {groupRest && <span>{groupRest}</span>}
          </div>
        )}
      </div>

      <button class="template-exercise-row-remove" onClick={onRemove} aria-label="Remove exercise">
        ✕
      </button>
    </div>
  );
}
