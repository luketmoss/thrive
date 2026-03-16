import { useState } from 'preact/hooks';
import { workouts, sets } from '../../state/store';
import { deleteWorkout, copyWorkout, saveWorkoutAsTemplate } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { ExerciseDetail, groupSetsIntoExercises } from './exercise-detail';

interface Props {
  workoutId: string;
}

/** Find the most recent previous workout with the same template/name (for "last time" reference). */
function findPreviousWorkout(workoutId: string) {
  const workout = workouts.value.find((w) => w.id === workoutId);
  if (!workout) return null;

  // Sort by date desc, find the first one before this workout with the same name or template
  const sorted = [...workouts.value].sort((a, b) => {
    const da = a.date + 'T' + (a.time || '00:00');
    const db = b.date + 'T' + (b.time || '00:00');
    return db.localeCompare(da);
  });

  const thisDate = workout.date + 'T' + (workout.time || '00:00');
  return sorted.find((w) =>
    w.id !== workoutId &&
    (w.date + 'T' + (w.time || '00:00')) < thisDate &&
    (
      (workout.template_id && w.template_id === workout.template_id) ||
      (!workout.template_id && w.name === workout.name)
    ),
  ) || null;
}

export function WorkoutDetail({ workoutId }: Props) {
  const { token } = useAuth();
  const workout = workouts.value.find((w) => w.id === workoutId);
  const [expandedIndex, setExpandedIndex] = useState(-1);
  const [deleting, setDeleting] = useState(false);
  const [showLastTime, setShowLastTime] = useState(false);

  if (!workout) {
    return (
      <div class="screen">
        <div class="empty-state">
          <p>Workout not found</p>
          <button class="btn btn-primary" onClick={() => navigate('/')}>Back to Activities</button>
        </div>
      </div>
    );
  }

  const workoutSets = sets.value
    .filter((s) => s.workout_id === workoutId)
    .sort((a, b) => a.exercise_order - b.exercise_order || a.set_number - b.set_number);

  const exerciseGroups = groupSetsIntoExercises(workoutSets);

  // "Last time" reference
  const prevWorkout = findPreviousWorkout(workoutId);
  const prevSets = prevWorkout
    ? sets.value.filter((s) => s.workout_id === prevWorkout.id)
    : [];
  const prevGroups = prevSets.length > 0 ? groupSetsIntoExercises(prevSets) : [];

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm('Delete this workout? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteWorkout(workoutId, token);
      navigate('/');
    } catch {
      // Error toast shown by action
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async () => {
    if (!token) return;
    try {
      const newId = await copyWorkout(workoutId, token);
      navigate(`/workout/${newId}`);
    } catch {
      // Error toast shown by action
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!token || !workout) return;
    const name = prompt('Template name:', workout.name);
    if (!name?.trim()) return;
    try {
      await saveWorkoutAsTemplate(workoutId, name.trim(), token);
    } catch {
      // Error toast shown by action
    }
  };

  return (
    <div class="screen workout-detail-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => navigate('/')}
          aria-label="Back"
        >
          ← Back
        </button>
        <div class="detail-header-actions">
          {workout.type === 'weight' && exerciseGroups.length > 0 && (
            <button class="btn btn-secondary btn-sm" onClick={handleSaveAsTemplate}>
              Save Template
            </button>
          )}
          {workout.type === 'weight' && (
            <button class="btn btn-secondary btn-sm" onClick={handleCopy}>
              Copy
            </button>
          )}
          <button
            class="btn btn-primary btn-sm"
            onClick={() => navigate(`/history/${workoutId}/edit`)}
          >
            Edit
          </button>
        </div>
      </div>

      <div class="detail-meta">
        <h2 class="detail-title">{workout.name || workout.type}</h2>
        <div class="detail-info-row">
          <span class={`type-badge badge-${workout.type}`}>{workout.type}</span>
          <span class="detail-date">{workout.date}</span>
          {workout.time && <span class="detail-time">{workout.time}</span>}
          {workout.duration_min && (
            <span class="detail-duration">{workout.duration_min} min</span>
          )}
        </div>
        {workout.notes && (
          <p class="detail-notes">{workout.notes}</p>
        )}
        {workout.copied_from && (
          <p class="detail-copied">Copied from a previous workout</p>
        )}
      </div>

      {/* Exercise breakdown for weight workouts */}
      {exerciseGroups.length > 0 && (
        <div class="detail-exercises">
          <div class="detail-section-header">
            <h3>Exercises</h3>
            {prevWorkout && (
              <button
                class="btn-link"
                onClick={() => setShowLastTime(!showLastTime)}
              >
                {showLastTime ? 'Hide' : 'Show'} last time
              </button>
            )}
          </div>

          {exerciseGroups.map((group, i) => (
            <div key={`${group.exercise_id}-${group.exercise_order}`}>
              <ExerciseDetail
                group={group}
                expanded={expandedIndex === i}
                onToggle={() => setExpandedIndex(expandedIndex === i ? -1 : i)}
              />
              {showLastTime && prevGroups.length > 0 && (() => {
                const prev = prevGroups.find(
                  (pg) => pg.exercise_id === group.exercise_id && pg.exercise_order === group.exercise_order,
                );
                if (!prev) return null;
                const prevBest = prev.sets.reduce<typeof prev.sets[0] | null>((best, s) => {
                  if (!best) return s;
                  return (Number(s.weight) || 0) > (Number(best.weight) || 0) ? s : best;
                }, null);
                if (!prevBest) return null;
                return (
                  <div class="last-time-ref">
                    Last time: {prevBest.weight ? `${prevBest.weight} lbs` : ''}
                    {prevBest.weight && prevBest.reps ? ' × ' : ''}
                    {prevBest.reps ? `${prevBest.reps} reps` : ''}
                    {prevBest.effort ? ` (${prevBest.effort})` : ''}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* Non-weight workouts just show notes (already shown above) */}
      {exerciseGroups.length === 0 && workout.type !== 'weight' && !workout.notes && (
        <div class="empty-state">
          <p>No additional details</p>
        </div>
      )}

      <div class="detail-actions">
        <button
          class="btn btn-danger"
          style={{ width: '100%' }}
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting...' : 'Delete Workout'}
        </button>
      </div>
    </div>
  );
}
