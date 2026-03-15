import { SetRow } from './set-row';
import type { TrackerSet } from './set-row';

export interface TrackerExercise {
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  sets: TrackerSet[];
  quickFillWeight: string;
}

interface Props {
  exercise: TrackerExercise;
  onUpdateSet: (setNumber: number, updates: Partial<TrackerSet>) => void;
  onAddSet: () => void;
  onRemoveSet: (setNumber: number) => void;
  onQuickFillWeight: (weight: string) => void;
}

function sectionBadgeClass(section: string): string {
  if (section.startsWith('SS')) return 'section-badge section-ss';
  return `section-badge section-${section}`;
}

export function ExerciseRow({ exercise, onUpdateSet, onAddSet, onRemoveSet, onQuickFillWeight }: Props) {
  const isSS = exercise.section.startsWith('SS');
  const cardClass = `tracker-exercise${isSS ? ` section-ss-group ss-${exercise.section}` : ''}`;

  return (
    <div class={cardClass}>
      <div class="tracker-exercise-header">
        <span class={sectionBadgeClass(exercise.section)}>
          {exercise.section}
        </span>
        <span class="tracker-exercise-name">{exercise.exercise_name}</span>
      </div>

      <div class="quick-fill-row">
        <label class="quick-fill-label" for={`quick-fill-${exercise.exercise_id}-${exercise.exercise_order}`}>Weight</label>
        <input
          id={`quick-fill-${exercise.exercise_id}-${exercise.exercise_order}`}
          class="form-input quick-fill-input"
          type="number"
          inputMode="decimal"
          placeholder="Fill all sets (lbs)"
          value={exercise.quickFillWeight}
          onInput={(e) => onQuickFillWeight((e.target as HTMLInputElement).value)}
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
