interface Props {
  onTrackNow: () => void;
  onPlanForLater: () => void;
  onBack: () => void;
}

export function IntentSelector({ onTrackNow, onPlanForLater, onBack }: Props) {
  return (
    <div class="screen type-selector-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={onBack}
          aria-label="Back"
        >
          ← Back
        </button>
      </div>

      <h2 style={{ marginBottom: 'var(--space-lg)' }}>What would you like to do?</h2>

      <div class="type-selector-grid">
        <button class="type-card type-card-weight" onClick={onTrackNow}>
          <span class="type-card-icon">💪</span>
          <span class="type-card-label">Track Now</span>
        </button>
        <button class="type-card" onClick={onPlanForLater}>
          <span class="type-card-icon">📋</span>
          <span class="type-card-label">Plan for Later</span>
        </button>
      </div>
    </div>
  );
}
