import { useState, useEffect } from 'preact/hooks';
import { workouts, sets, isEditMode } from '../../state/store';
import { enterEditMode, exitEditMode, deleteWorkout } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { WorkoutTracker } from '../workout/workout-tracker';
import { EditWorkoutForm } from './edit-workout-form';
import { WorkoutPlanner } from '../workout/workout-planner';
import type { PlannerExercise } from '../workout/workout-planner';
import type { BuilderExercise } from '../../api/types';
import { saveWorkoutForLater } from '../../state/actions';

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
      navigate('/');
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
        reps: '',
      });
      continue;
    }

    const setCount = workoutSets.filter(
      (ws) => ws.exercise_id === s.exercise_id && ws.exercise_order === s.exercise_order,
    ).length;
    initialExercises.push({
      exercise_id: s.exercise_id,
      exercise_name: s.exercise_name,
      section: s.section || 'primary',
      sets: String(setCount),
      reps: s.planned_reps || '',
    });
  }

  // Sort by exercise_order from set rows
  initialExercises.sort((a, b) => {
    const orderA = workoutSets.find((s) => s.exercise_id === a.exercise_id && s.section === a.section)?.exercise_order ?? 0;
    const orderB = workoutSets.find((s) => s.exercise_id === b.exercise_id && s.section === b.section)?.exercise_order ?? 0;
    return orderA - orderB;
  });

  const handleSave = async (name: string, exercises: PlannerExercise[]) => {
    if (!token) return;
    setSaving(true);
    try {
      // Delete old workout and create new planned one with updated exercises
      const builderExercises: BuilderExercise[] = exercises.map((ex) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: ex.section,
        sets: Number(ex.sets) || 1,
        planned_reps: ex.reps,
      }));

      await deleteWorkout(workoutId, token);
      await saveWorkoutForLater(
        { type: 'weight', name, exercises: builderExercises },
        token,
      );
      navigate('/');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    navigate(`/history/${workoutId}`);
  };

  return (
    <WorkoutPlanner
      initialName={workout.name}
      initialExercises={initialExercises}
      onSave={handleSave}
      onDiscard={handleDiscard}
      saving={saving}
    />
  );
}
