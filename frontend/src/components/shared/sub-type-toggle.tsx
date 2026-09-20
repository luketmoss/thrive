import type { WorkoutType } from '../../api/types';

/**
 * Venue/terrain options offered per sport (#129).
 *
 * The map governs what the *control offers*, not what the column accepts.
 * `Workouts!R` is a free string precisely so Biking-Road or Running-Trail can
 * arrive from the COROS sync — or from a later edit to this map — without a
 * schema change. A stored value that is not listed here still round-trips.
 */
export const SUB_TYPE_OPTIONS: Partial<Record<WorkoutType, string[]>> = {
  bike: ['mountain', 'gravel', 'indoor'],
  run: ['outdoor', 'indoor'],
  walk: ['outdoor', 'indoor'],
};

/** The options for a type, or `[]` where the sport has no venue split. */
export function subTypeOptions(type: WorkoutType): string[] {
  return SUB_TYPE_OPTIONS[type] ?? [];
}

/** `mountain` -> `Mountain`. The column stores lowercase; the UI shows words. */
export function subTypeLabel(subType: string): string {
  return subType.charAt(0).toUpperCase() + subType.slice(1);
}

interface Props {
  workoutType: WorkoutType;
  value: string;
  onChange: (subType: string) => void;
  /** Prefixes each button's accessible name, and names the group. */
  label?: string;
}

/**
 * Venue/terrain picker, with tap-the-selected-value-to-clear.
 *
 * Deliberately the same contract as `EffortToggle`'s `session` size: 44px
 * targets, `role="group"` with a group label, per-button `aria-pressed`, and
 * an active cue that is not colour alone.
 *
 * Unset is a legitimate permanent state, not a missing value — every bike and
 * hike logged before #129 has a blank `sub_type` and is not thereby
 * incomplete. Nothing here defaults, and clearing stays reachable from every
 * value.
 */
export function SubTypeToggle({ workoutType, value, onChange, label = 'Type' }: Props) {
  const options = subTypeOptions(workoutType);
  if (options.length === 0) return null;

  return (
    <div class="sub-type-toggle" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            class={`sub-type-btn${active ? ' active' : ''}`}
            onClick={() => onChange(active ? '' : option)}
            aria-label={`${label}: ${subTypeLabel(option)}`}
            aria-pressed={active ? 'true' : 'false'}
          >
            {subTypeLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
