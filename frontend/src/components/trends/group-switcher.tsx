// The Trends group switcher (#243 AC4): one row of buttons, one per registered
// group, in registry order. Same aria-pressed convention as Range/Average/View.
//
// It never wraps and never widens the page: it scrolls sideways inside its own
// focusable region, because three groups fit a 320px column and the eventual
// six do not. With fewer than two groups there is nothing to switch, so nothing
// renders.

import type { TrendGroup } from './metrics';

interface Props {
  groups: readonly TrendGroup[];
  value: string;
  onChange: (id: string) => void;
}

export function GroupSwitcher({ groups, value, onChange }: Props) {
  if (groups.length < 2) return null;
  return (
    <div class="trends-group-scroll" role="region" tabIndex={0} aria-label="Metric group">
      <div class="trends-group-row" role="group" aria-label="Metric group">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            class={`sub-type-btn trends-group-btn${g.id === value ? ' active' : ''}`}
            aria-pressed={g.id === value ? 'true' : 'false'}
            onClick={() => onChange(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
