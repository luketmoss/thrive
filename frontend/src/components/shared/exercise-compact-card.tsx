import { sectionBadgeClass } from './section-utils';

interface Props {
  section: string;
  exerciseName: string;
  sets: string;
  reps: string;
  /** Show move arrows and remove button. */
  editable?: boolean;
  index?: number;
  total?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onClick?: () => void;
  /** Whether the row's panel is open; reflected as aria-expanded when the row is a button. */
  expanded?: boolean;
  onRemove?: () => void;
}

export function ExerciseCompactCard({
  section,
  exerciseName,
  sets,
  reps,
  editable,
  index = 0,
  total = 0,
  onMoveUp,
  onMoveDown,
  onClick,
  expanded,
  onRemove,
}: Props) {
  const setsReps =
    sets && reps
      ? `${sets} × ${reps}`
      : sets
        ? `${sets} sets`
        : reps
          ? `${reps} reps`
          : '';

  return (
    <div class="compact-card">
      {editable && (
        <div class="compact-card-reorder">
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
      )}

      <div
        class="compact-card-body"
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-expanded={onClick && expanded !== undefined ? expanded : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  // Space must not scroll the page.
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
      >
        <div class="compact-card-top">
          <span class={sectionBadgeClass(section)}>{section}</span>
          <span class="compact-card-name">{exerciseName}</span>
        </div>
        {setsReps && (
          <div class="compact-card-meta">
            <span>{setsReps}</span>
          </div>
        )}
      </div>

      {editable && (
        <button
          class="compact-card-remove"
          onClick={onRemove}
          aria-label={`Remove ${exerciseName}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}
