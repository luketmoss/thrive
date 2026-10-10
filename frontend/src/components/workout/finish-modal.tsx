import { useId, useRef } from 'preact/hooks';
import { useModalFocus } from '../shared/use-modal-focus';
import { EffortToggle } from '../shared/effort-toggle';
import type { Effort } from '../../api/types';

interface FinishWorkoutModalProps {
  notes: string;
  onNotesChange: (e: Event) => void;
  effort: Effort | '';
  onEffortChange: (effort: Effort | '') => void;
  onFinish: () => void;
  onCancel: () => void;
  finishing: boolean;
}

const HEADING_ID = 'finish-workout-heading';

export function FinishWorkoutModal({
  notes,
  onNotesChange,
  effort,
  onEffortChange,
  onFinish,
  onCancel,
  finishing,
}: FinishWorkoutModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const uid = useId();
  const notesId = `finish-notes-${uid}`;
  const effortLabelId = `finish-effort-label-${uid}`;
  // Escape and the backdrop do nothing while the save is in flight.
  useModalFocus(
    dialog,
    () => {
      if (!finishing) onCancel();
    },
    { initialFocus: 'textarea' },
  );

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
        ref={dialog}
        style="max-width: 400px;"
      >
        <h2
          id={HEADING_ID}
          style="font-size: var(--text-lg); font-weight: 700; margin-bottom: var(--space-md);"
        >
          Finish Workout
        </h2>

        <div class="form-group" style="margin-bottom: var(--space-md);">
          <label class="form-label" htmlFor={notesId}>Workout Notes (optional)</label>
          <textarea
            id={notesId}
            class="form-textarea"
            placeholder="How did it go?"
            rows={3}
            value={notes}
            onInput={onNotesChange}
          />
        </div>

        <div class="form-group" style="margin-bottom: var(--space-md);">
          <span class="form-label" id={effortLabelId}>Session Effort (optional)</span>
          <EffortToggle
            value={effort}
            onChange={onEffortChange}
            size="session"
            label="Session effort"
            labelledBy={effortLabelId}
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
