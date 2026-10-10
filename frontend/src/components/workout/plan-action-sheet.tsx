import { useRef } from 'preact/hooks';
import { useModalFocus } from '../shared/use-modal-focus';

interface Props {
  workoutName: string;
  isCustom?: boolean;
  starting: boolean;
  saving: boolean;
  onStartNow: () => void;
  onSaveForLater: () => void;
  onCancel: () => void;
}

export function PlanActionSheet({
  workoutName,
  isCustom,
  starting,
  saving,
  onStartNow,
  onSaveForLater,
  onCancel,
}: Props) {
  const titleId = 'plan-action-sheet-title';
  const dialog = useRef<HTMLDivElement>(null);
  const busy = starting || saving;
  // Escape does nothing while starting or saving; Start Now takes focus.
  useModalFocus(
    dialog,
    () => {
      if (!busy) onCancel();
    },
    { initialFocus: '[data-modal-initial]' },
  );

  const handleBackgroundClick = (e: MouseEvent) => {
    if (busy) return;
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      onCancel();
    }
  };

  return (
    <div class="modal-overlay" onClick={handleBackgroundClick}>
      <div
        class="modal-content plan-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialog}
      >
        <h2 id={titleId} class="plan-action-sheet-title">
          {workoutName}
        </h2>

        {isCustom && (
          <p class="plan-action-sheet-note">
            Your exercise list will be empty — you can add exercises when you start.
          </p>
        )}

        <div class="plan-action-sheet-actions">
          <button
            data-modal-initial
            class="btn btn-primary plan-action-sheet-btn"
            onClick={onStartNow}
            disabled={busy}
          >
            {starting ? 'Starting…' : 'Start Now'}
          </button>
          <button
            class="btn btn-secondary plan-action-sheet-btn"
            onClick={onSaveForLater}
            disabled={busy}
          >
            {saving ? 'Saving…' : 'Save for Later'}
          </button>
          <button
            class="btn btn-ghost plan-action-sheet-btn"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
