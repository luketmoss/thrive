import type { Effort } from '../../api/types';

export interface TrackerSet {
  set_number: number;
  planned_reps: string;
  weight: string;
  reps: string;
  effort: Effort | '';
  notes: string;
  saved: boolean;
  sheetRow: number;
}

interface Props {
  set: TrackerSet;
  onUpdate: (updates: Partial<TrackerSet>) => void;
  onRemove: () => void;
}

const EFFORTS: Effort[] = ['Easy', 'Medium', 'Hard'];
const EFFORT_LABELS: Record<Effort, string> = { Easy: 'E', Medium: 'M', Hard: 'H' };

export function SetRow({ set, onUpdate, onRemove }: Props) {
  return (
    <div class="tracker-set">
      <span class="tracker-set-number">S{set.set_number}</span>

      <div class="set-inputs">
        <input
          class="form-input set-weight-input"
          type="number"
          inputMode="decimal"
          placeholder="lbs"
          value={set.weight}
          onInput={(e) => onUpdate({ weight: (e.target as HTMLInputElement).value })}
        />
        <span class="set-input-separator">×</span>
        <input
          class="form-input set-reps-input"
          type="number"
          inputMode="numeric"
          placeholder="reps"
          value={set.reps}
          onInput={(e) => onUpdate({ reps: (e.target as HTMLInputElement).value })}
        />
        {set.planned_reps && (
          <span class="set-planned-target" aria-label={`target: ${set.planned_reps} reps`}>
            <span aria-hidden="true">/ </span>{set.planned_reps}
          </span>
        )}
      </div>

      <div class="effort-toggle">
        {EFFORTS.map((e) => (
          <button
            key={e}
            class={`effort-btn effort-btn-${e.toLowerCase()}${set.effort === e ? ' active' : ''}`}
            onClick={() => onUpdate({ effort: set.effort === e ? '' : e })}
            aria-label={e}
          >
            {EFFORT_LABELS[e]}
          </button>
        ))}
      </div>

      <span
        class="set-saved"
        style={{ visibility: set.saved ? 'visible' : 'hidden' }}
        aria-label="Saved"
        aria-hidden={set.saved ? 'false' : 'true'}
      >
        ✓
      </span>

      <button
        class="set-remove-btn"
        onClick={onRemove}
        aria-label="Remove set"
      >
        ×
      </button>
    </div>
  );
}
