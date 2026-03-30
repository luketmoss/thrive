import { useEffect, useRef } from 'preact/hooks';

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
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the first button when the sheet opens
  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const handleBackgroundClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      onCancel();
    }
  };

  const busy = starting || saving;

  return (
    <div class="modal-overlay" onClick={handleBackgroundClick}>
      <div
        class="modal-content plan-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
            ref={firstButtonRef}
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
