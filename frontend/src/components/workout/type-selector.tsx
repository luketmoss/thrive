import type { WorkoutType } from '../../api/types';
import { navigate } from '../../router/router';

interface Props {
  onSelect: (type: WorkoutType) => void;
}

const TYPES: { type: WorkoutType; label: string; icon: string }[] = [
  { type: 'weight', label: 'Weight', icon: '🏋️' },
  { type: 'stretch', label: 'Stretch', icon: '🤸' },
  { type: 'bike', label: 'Bike', icon: '🚴' },
  { type: 'yoga', label: 'Yoga', icon: '🧘' },
];

export function TypeSelector({ onSelect }: Props) {
  return (
    <div class="screen type-selector-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => navigate('/')}
          aria-label="Back"
        >
          ← Back
        </button>
      </div>

      <h2 style={{ marginBottom: 'var(--space-lg)' }}>What type of workout?</h2>

      <div class="type-selector-grid">
        {TYPES.map(({ type, label, icon }) => (
          <button
            key={type}
            class={`type-card type-card-${type}`}
            onClick={() => onSelect(type)}
          >
            <span class="type-card-icon">{icon}</span>
            <span class="type-card-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
