import { getLastTimeData, formatLastTimeDate } from './last-time-data';
import type { SetWithRow } from '../../api/types';

interface Props {
  exerciseId: string;
  exerciseName: string;
  currentWorkoutId: string;
  onCopyDown: (lastTimeSets: SetWithRow[]) => void;
}

function effortClass(effort: string): string {
  if (!effort) return '';
  return `effort-${effort.toLowerCase()}`;
}

export function LastTimePanel({ exerciseId, exerciseName, currentWorkoutId, onCopyDown }: Props) {
  const data = getLastTimeData(exerciseId, currentWorkoutId);

  if (!data) {
    return (
      <div class="last-time-panel last-time-panel-empty">
        <span class="last-time-empty-text">No previous data</span>
      </div>
    );
  }

  return (
    <div class="last-time-panel">
      <div class="last-time-date">{formatLastTimeDate(data.workoutDate)}</div>
      <div class="last-time-sets">
        <div class="exercise-detail-sets-header">
          <span>Set</span>
          <span>Weight</span>
          <span>Reps</span>
          <span>Effort</span>
        </div>
        {data.sets.map((s) => (
          <div key={s.set_number} class="exercise-detail-set-row">
            <span class="set-num">{s.set_number}</span>
            <span>{s.weight ? `${s.weight} lbs` : '\u2014'}</span>
            <span>{s.reps || '\u2014'}</span>
            <span class={effortClass(s.effort)}>{s.effort || '\u2014'}</span>
          </div>
        ))}
      </div>
      <button
        class="copy-down-btn"
        onClick={() => onCopyDown(data.sets)}
        aria-label={`Copy previous workout data for ${exerciseName}`}
      >
        Copy Down
      </button>
    </div>
  );
}
