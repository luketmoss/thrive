import { useEffect, useRef } from 'preact/hooks';

interface FinishWorkoutModalProps {
  notes: string;
  onNotesChange: (e: Event) => void;
  onFinish: () => void;
  onCancel: () => void;
  finishing: boolean;
}

const HEADING_ID = 'finish-workout-heading';

export function FinishWorkoutModal({
  notes,
  onNotesChange,
  onFinish,
  onCancel,
  finishing,
}: FinishWorkoutModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !finishing) {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [finishing, onCancel]);

  const handleBackdropClick = (e: MouseEvent) => {
    if (finishing) return;
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      onCancel();
    }
  };

  return (
    <div class="modal-overlay" onClick={handleBackdropClick}>
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        style="max-width: 400px;"
      >
        <h2
          id={HEADING_ID}
          style="font-size: var(--text-lg); font-weight: 700; margin-bottom: var(--space-md);"
        >
          Finish Workout
        </h2>

        <div class="form-group" style="margin-bottom: var(--space-md);">
          <label class="form-label">Workout Notes (optional)</label>
          <textarea
            ref={textareaRef}
            class="form-textarea"
            placeholder="How did it go?"
            rows={3}
            value={notes}
            onInput={onNotesChange}
          />
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
          <button
            class="btn btn-primary"
            onClick={onFinish}
            disabled={finishing}
            style="width: 100%;"
          >
            {finishing ? 'Saving...' : 'Save & Finish'}
          </button>
          <button
            class="btn btn-secondary"
            onClick={onCancel}
            disabled={finishing}
            style="width: 100%;"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
