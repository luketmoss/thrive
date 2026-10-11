import { sectionBadgeClass } from './section-utils';
import { repsSummary } from '../workout/planned-reps';

interface Props {
  section: string;
  exerciseName: string;
  sets: string;
  reps: string;
  /**
   * Each set's planned reps, in set order (#375). When given, the summary is
   * built from it (`3 × 10/8/6`, with a screen-reader form) and `sets`/`reps`
   * are not used for it; an empty list shows no summary (a warmup).
   */
  repsBySet?: string[];
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
  repsBySet,
  editable,
  index = 0,
  total = 0,
  onMoveUp,
  onMoveDown,
  onClick,
  expanded,
  onRemove,
}: Props) {
  const perSet = repsBySet ? repsSummary(repsBySet) : null;
  const setsReps = perSet
    ? perSet.visual
    : sets && reps
      ? `${sets} × ${reps}`
      : sets
        ? `${sets} sets`
        : reps
          ? `${reps} reps`
          : '';

  // At an end the button is aria-disabled, not disabled (#328): it keeps focus
  // after a move puts the row there, and activating it does nothing.
  const atTop = index === 0;
  const atBottom = index === total - 1;

  return (
    <div class={editable ? 'compact-card compact-card-editable' : 'compact-card'}>
      {editable && (
        <div class="compact-card-reorder">
          <button
            class="reorder-btn"
            onClick={() => {
              if (!atTop) onMoveUp?.();
            }}
            aria-disabled={atTop ? 'true' : undefined}
            data-move="up"
            type="button"
            aria-label={`Move ${exerciseName} up`}
          >
            <span aria-hidden="true">▲</span>
          </button>
          <button
            class="reorder-btn"
            onClick={() => {
              if (!atBottom) onMoveDown?.();
            }}
            aria-disabled={atBottom ? 'true' : undefined}
            data-move="down"
            type="button"
            aria-label={`Move ${exerciseName} down`}
          >
            <span aria-hidden="true">▼</span>
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
            {perSet && perSet.spoken !== perSet.visual ? (
              <>
                <span aria-hidden="true">{setsReps}</span>
                <span class="sr-only">{perSet.spoken}</span>
              </>
            ) : (
              <span>{setsReps}</span>
            )}
          </div>
        )}
      </div>

      {editable && (
        <button
          class="compact-card-remove"
          onClick={onRemove}
          type="button"
          aria-label={`Remove ${exerciseName}`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
