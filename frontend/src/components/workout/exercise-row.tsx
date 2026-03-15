import { useState, useEffect } from 'preact/hooks';
import { SetRow } from './set-row';
import { LastTimePanel } from './last-time-panel';
import type { TrackerSet } from './set-row';

export interface TrackerExercise {
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  sets: TrackerSet[];
  quickFillWeight: string;
  quickFillReps: string;
}

interface Props {
  exercise: TrackerExercise;
  currentWorkoutId: string;
  onUpdateSet: (setNumber: number, updates: Partial<TrackerSet>) => void;
  onAddSet: () => void;
  onRemoveSet: (setNumber: number) => void;
  onQuickFillWeight: (weight: string) => void;
  onQuickFillReps: (reps: string) => void;
}

function sectionBadgeClass(section: string): string {
  if (section.startsWith('SS')) return 'section-badge section-ss';
  return `section-badge section-${section}`;
}

export function ExerciseRow({ exercise, currentWorkoutId, onUpdateSet, onAddSet, onRemoveSet, onQuickFillWeight, onQuickFillReps }: Props) {
  const isWarmup = exercise.section === 'warmup';
  const [showLastTime, setShowLastTime] = useState(false);

  // AC4: Escape key closes the panel
  useEffect(() => {
    if (!showLastTime) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowLastTime(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showLastTime]);

  // Warmup exercises render as simplified name-only cards
  if (isWarmup) {
    return (
      <div
        class="tracker-exercise tracker-exercise-warmup"
        aria-label={`Warmup: ${exercise.exercise_name} (list only)`}
      >
        <div class="tracker-exercise-header">
          <span class={sectionBadgeClass(exercise.section)}>
            {exercise.section}
          </span>
          <span class="tracker-exercise-name">{exercise.exercise_name}</span>
        </div>
      </div>
    );
  }

  const isSS = exercise.section.startsWith('SS');
  const cardClass = `tracker-exercise${isSS ? ` section-ss-group ss-${exercise.section}` : ''}`;

  return (
    <div class={cardClass}>
      <div class="tracker-exercise-header">
        <span class={sectionBadgeClass(exercise.section)}>
          {exercise.section}
        </span>
        <span class="tracker-exercise-name">{exercise.exercise_name}</span>
        <button
          class="last-time-toggle"
          onClick={() => setShowLastTime(!showLastTime)}
          aria-label={`View previous performance for ${exercise.exercise_name}`}
          aria-expanded={showLastTime ? 'true' : 'false'}
        >
          <svg class="last-time-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
      </div>

      {showLastTime && (
        <LastTimePanel
          exerciseId={exercise.exercise_id}
          currentWorkoutId={currentWorkoutId}
        />
      )}

      <div class="quick-fill-row">
        <span class="quick-fill-label">Quick fill</span>
        <input
          id={`quick-fill-wt-${exercise.exercise_id}-${exercise.exercise_order}`}
          class="form-input quick-fill-input"
          type="number"
          inputMode="decimal"
          placeholder="lbs"
          aria-label="Fill all sets weight (lbs)"
          value={exercise.quickFillWeight}
          onInput={(e) => onQuickFillWeight((e.target as HTMLInputElement).value)}
        />
        <span class="set-input-separator">×</span>
        <input
          id={`quick-fill-reps-${exercise.exercise_id}-${exercise.exercise_order}`}
          class="form-input quick-fill-input"
          type="number"
          inputMode="numeric"
          placeholder="reps"
          aria-label="Fill all sets reps"
          value={exercise.quickFillReps}
          onInput={(e) => onQuickFillReps((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="tracker-set-list">
        {exercise.sets.map((set) => (
          <SetRow
            key={set.set_number}
            set={set}
            onUpdate={(updates) => onUpdateSet(set.set_number, updates)}
            onRemove={() => onRemoveSet(set.set_number)}
          />
        ))}
      </div>

      <button class="add-set-btn" onClick={onAddSet}>
        + Add Set
      </button>
    </div>
  );
}
