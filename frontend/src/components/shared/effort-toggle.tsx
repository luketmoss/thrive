import type { Effort } from '../../api/types';

const EFFORTS: Effort[] = ['Easy', 'Medium', 'Hard'];

interface Props {
  value: Effort | '';
  onChange: (effort: Effort | '') => void;
  /**
   * `compact` is the 28px set-row control, kept as-is for a dense surface.
   * `session` is the 44px workout-level control — full words, AA contrast in
   * the unset state, and a non-colour active cue.
   */
  size?: 'compact' | 'session';
  /**
   * Prefixes each button's accessible name, e.g. "Session effort: Easy".
   * Also names the group.
   */
  label: string;
  /**
   * Id of a visible element that names the group. When set it replaces
   * `label` as the group's name; the buttons still use `label`.
   */
  labelledBy?: string;
}

/**
 * Easy / Medium / Hard, with tap-the-selected-value-to-clear.
 *
 * Unset is a legitimate permanent state, not a missing value — nothing here
 * defaults, and clearing is reachable from every value.
 */
export function EffortToggle({ value, onChange, size = 'compact', label, labelledBy }: Props) {
  const session = size === 'session';

  return (
    <div class={`effort-toggle${session ? ' effort-toggle-session' : ''}`} role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}>
      {EFFORTS.map((effort) => {
        const active = value === effort;
        return (
          <button
            key={effort}
            type="button"
            class={`effort-btn effort-btn-${effort.toLowerCase()}${active ? ' active' : ''}`}
            onClick={() => onChange(active ? '' : effort)}
            aria-label={`${label}: ${effort}`}
            aria-pressed={active ? 'true' : 'false'}
          >
            {session ? effort : effort.charAt(0)}
          </button>
        );
      })}
    </div>
  );
}
