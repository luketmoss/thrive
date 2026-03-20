import { filterType, filterTags, allTags } from '../../state/store';
import { LabelBadge } from '../shared/label-badge';
import type { WorkoutType } from '../../api/types';

const TYPES: { value: WorkoutType; label: string }[] = [
  { value: 'weight', label: 'Weight' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'bike', label: 'Bike' },
  { value: 'hike', label: 'Hike' },
];

export function ActivitiesFilters() {
  const activeType = filterType.value;
  const activeTags = filterTags.value;
  const tags = allTags.value;
  const hasFilters = activeType !== null || activeTags.length > 0;

  const toggleType = (type: WorkoutType) => {
    filterType.value = filterType.value === type ? null : type;
  };

  const toggleTag = (tag: string) => {
    filterTags.value = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
  };

  const clearAll = () => {
    filterType.value = null;
    filterTags.value = [];
  };

  return (
    <div class="activities-filters">
      <div class="filter-row">
        {TYPES.map(({ value, label }) => (
          <button
            key={value}
            class={`filter-chip badge-${value}${activeType === value ? ' active' : ''}`}
            onClick={() => toggleType(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div class="filter-row tag-filter-row">
          {tags.map((tag) => (
            <LabelBadge
              key={tag}
              name={tag}
              active={activeTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            />
          ))}
        </div>
      )}

      {hasFilters && (
        <button class="filter-clear" onClick={clearAll}>
          Clear filters
        </button>
      )}
    </div>
  );
}
