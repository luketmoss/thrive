interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const handleBackgroundClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      onCancel();
    }
  };

  return (
    <div class="modal-overlay" onClick={handleBackgroundClick}>
      <div class="modal-content" style="max-width: 360px;">
        <h2 style="font-size: var(--text-lg); font-weight: 700; margin-bottom: var(--space-sm);">
          {title}
        </h2>
        <p style="color: var(--color-text-secondary); margin-bottom: var(--space-lg);">
          {message}
        </p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
