import { useState, useEffect } from 'preact/hooks';
import { workouts, sets, isEditMode } from '../../state/store';
import { enterEditMode, exitEditMode, savePlannedWorkoutEdits } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate, goBack } from '../../router/router';
import { WorkoutTracker } from '../workout/workout-tracker';
import { EditWorkoutForm } from './edit-workout-form';
import { WorkoutPlanner } from '../workout/workout-planner';
import type { PlannerExercise } from '../workout/workout-planner';
import { plannerToBuilderExercises } from '../workout/planned-reps';
import { estimateMinutesToSeconds, secondsToMinutesInput } from '../../api/duration';

interface Props {
  workoutId: string;
}

export function WorkoutEdit({ workoutId }: Props) {
  const { token } = useAuth();
  const workout = workouts.value.find((w) => w.id === workoutId);
  const isPlanned = workout?.status === 'planned';

  // Enter edit mode synchronously for non-planned weight workouts
  if (workout?.type === 'weight' && !isPlanned && !isEditMode.value) {
    enterEditMode(workoutId);
  }

  // Cleanup on unmount
  useEffect(() => {
    if (!workout) {
      navigate('/activities');
      return;
    }

    return () => {
      if (isEditMode.value) {
        exitEditMode();
      }
    };
  }, [workoutId]);

  if (!workout) return null;

  // Planned workout: use planner-style editor
  if (isPlanned && workout.type === 'weight') {
    return (
      <PlannedWorkoutEditor workoutId={workoutId} />
    );
  }

  // Non-weight workouts use the lightweight form
  if (workout.type !== 'weight') {
    return <EditWorkoutForm workoutId={workoutId} />;
  }

  // Weight workouts use the tracker in edit mode
  const workoutSets = sets.value.filter((s) => s.workout_id === workoutId);
  if (!isEditMode.value && workoutSets.length === 0) return null;

  return <WorkoutTracker workoutId={workoutId} workoutName={workout.name} />;
}

// One conversion for both planner callers (#375); re-exported here, where
// #350's and #380's tests import it.
export { plannerToBuilderExercises };

/** Editor for planned workouts - uses the planner UI. */
function PlannedWorkoutEditor({ workoutId }: { workoutId: string }) {
  const { token } = useAuth();
  const workout = workouts.value.find((w) => w.id === workoutId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!workout) return null;

  // Build initial exercises from workout sets + template warmups
  const workoutSets = sets.value
    .filter((s) => s.workout_id === workoutId)
    .sort((a, b) => a.exercise_order - b.exercise_order || a.set_number - b.set_number);

  const initialExercises: PlannerExercise[] = [];
  const seen = new Set<string>();

  // Build exercises from set rows (warmups are now stored as set rows too)
  for (const s of workoutSets) {
    const key = `${s.exercise_id}__${s.exercise_order}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (s.section === 'warmup') {
      initialExercises.push({
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        section: 'warmup',
        sets: '',
        reps_by_set: [],
        source_order: s.exercise_order,
      });
      continue;
    }

    // Already in set order, so entry i is set i + 1.
    const own = workoutSets.filter(
      (ws) => ws.exercise_id === s.exercise_id && ws.exercise_order === s.exercise_order,
    );
    // Each set's stored text, verbatim (#375): a row left alone saves it back.
    initialExercises.push({
      exercise_id: s.exercise_id,
      exercise_name: s.exercise_name,
      section: s.section || 'primary',
      sets: String(own.length),
      reps_by_set: own.map((ws) => ws.planned_reps),
      source_order: s.exercise_order,
    });
  }

  // Already in exercise_order: the rows are sorted by it and each entry is
  // pushed at its first row. (A re-sort keyed by exercise_id + section once
  // pulled a second same-exercise, same-section entry up beside the first,
  // so an untouched plan was rewritten on Save — #350's AC4/AC5.)

  const handleSave = async (name: string, exercises: PlannerExercise[], date: string, estimatedSeconds: string) => {
    if (!token) return;
    setSaving(true);
    try {
      // Saved in place (#349): only what the user changed is patched, so an
      // untouched estimate is never re-sent (and an off-minute stored value
      // never rounded), and every column the planner does not edit stays as
      // the sheet holds it.
      const patch: { name?: string; date?: string; estimated_seconds?: string } = {};
      if (name !== workout.name) patch.name = name;
      if (date !== workout.date) patch.date = date;
      if (estimatedSeconds !== estimateMinutesToSeconds(secondsToMinutesInput(workout.estimated_seconds))) {
        patch.estimated_seconds = estimatedSeconds;
      }
      await savePlannedWorkoutEdits(workoutId, patch, plannerToBuilderExercises(exercises), token);
      goBack('/activities');
    } catch {
      // Error toast shown by action; the user stays here with their edits.
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    goBack('/activities');
  };

  return (
    <WorkoutPlanner
      initialName={workout.name}
      initialExercises={initialExercises}
      initialDate={workout.date}
      initialEstimatedSeconds={workout.estimated_seconds}
      onSave={handleSave}
      onDiscard={handleDiscard}
      saving={saving}
    />
  );
}
