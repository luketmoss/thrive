import type { SetWithRow } from '../../api/types';

interface ExerciseGroup {
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  sets: SetWithRow[];
}

interface Props {
  group: ExerciseGroup;
  expanded: boolean;
  onToggle: () => void;
}

function sectionBadgeClass(section: string): string {
  if (section.startsWith('SS')) return 'section-badge section-ss';
  return `section-badge section-${section}`;
}

function effortClass(effort: string): string {
  if (!effort) return '';
  return `effort-${effort.toLowerCase()}`;
}

export function ExerciseDetail({ group, expanded, onToggle }: Props) {
  // Summary: best set (heaviest weight × reps)
  const filledSets = group.sets.filter((s) => s.weight || s.reps);
  const bestSet = filledSets.reduce<SetWithRow | null>((best, s) => {
    if (!best) return s;
    const bw = Number(best.weight) || 0;
    const sw = Number(s.weight) || 0;
    return sw > bw ? s : best;
  }, null);

  const summary = bestSet
    ? `${bestSet.weight ? bestSet.weight + ' lbs' : ''}${bestSet.weight && bestSet.reps ? ' × ' : ''}${bestSet.reps ? bestSet.reps + ' reps' : ''}`
    : `${group.sets.length} set${group.sets.length !== 1 ? 's' : ''}`;

  return (
    <div class="exercise-detail">
      <div class="exercise-detail-header" onClick={onToggle}>
        <div class="exercise-detail-info">
          <span class={sectionBadgeClass(group.section)}>{group.section}</span>
          <span class="exercise-detail-name">{group.exercise_name}</span>
        </div>
        <div class="exercise-detail-summary">
          <span class="exercise-detail-summary-text">{summary}</span>
          <span class={`exercise-detail-chevron${expanded ? ' expanded' : ''}`}>▸</span>
        </div>
      </div>

      {expanded && (
        <div class="exercise-detail-sets">
          <div class="exercise-detail-sets-header">
            <span>Set</span>
            <span>Weight</span>
            <span>Reps</span>
            <span>Effort</span>
          </div>
          {group.sets.map((s) => (
            <div key={s.set_number} class="exercise-detail-set-row">
              <span class="set-num">{s.set_number}</span>
              <span>{s.weight ? `${s.weight} lbs` : '—'}</span>
              <span>{s.reps || '—'}</span>
              <span class={effortClass(s.effort)}>{s.effort || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Group flat sets into exercise groups, sorted by exercise_order. */
export function groupSetsIntoExercises(workoutSets: SetWithRow[]): ExerciseGroup[] {
  const map = new Map<string, ExerciseGroup>();
  for (const s of workoutSets) {
    const key = `${s.exercise_id}__${s.exercise_order}`;
    let group = map.get(key);
    if (!group) {
      group = {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: s.section,
        exercise_order: s.exercise_order,
        sets: [],
      };
      map.set(key, group);
    }
    group.sets.push(s);
  }
  const groups = Array.from(map.values()).sort((a, b) => a.exercise_order - b.exercise_order);
  for (const g of groups) {
    g.sets.sort((a, b) => a.set_number - b.set_number);
  }
  return groups;
}
