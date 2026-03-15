import { useState, useEffect } from 'preact/hooks';
import { workouts, activeWorkoutId, activeWorkoutSets, activeWarmupExercises, sets, templates } from '../../state/store';
import { startWorkout } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { TypeSelector } from './type-selector';
import { TemplatePicker } from './template-picker';
import { WorkoutTracker } from './workout-tracker';
import { SimpleWorkout } from './simple-workout';
import type { WorkoutType } from '../../api/types';

type FlowStep = 'type' | 'template' | 'tracker' | 'simple';

interface Props {
  workoutId?: string;
}

export function WorkoutFlow({ workoutId }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<FlowStep>('type');
  const [selectedType, setSelectedType] = useState<WorkoutType>('weight');
  const [activeId, setActiveId] = useState<string | null>(workoutId || null);
  const [workoutName, setWorkoutName] = useState('');
  const [starting, setStarting] = useState(false);

  // If resuming an existing workout, jump to the correct step
  useEffect(() => {
    if (!workoutId) return;

    const workout = workouts.value.find((w) => w.id === workoutId);
    if (!workout) {
      navigate('/');
      return;
    }

    setSelectedType(workout.type);
    setWorkoutName(workout.name);
    activeWorkoutId.value = workoutId;

    // Load this workout's sets into activeWorkoutSets
    activeWorkoutSets.value = sets.value.filter((s) => s.workout_id === workoutId);

    // Restore warmup exercises from template (exclude any already in sets)
    if (workout.template_id) {
      const tpl = templates.value.find((t) => t.id === workout.template_id);
      if (tpl) {
        const workoutSets = activeWorkoutSets.value;
        activeWarmupExercises.value = tpl.exercises
          .filter((ex) => ex.section === 'warmup')
          .filter((ex) => !workoutSets.some(
            (s) => s.exercise_id === ex.exercise_id && s.exercise_order === ex.order && s.section === 'warmup',
          ))
          .map((ex) => ({
            exercise_id: ex.exercise_id,
            exercise_name: ex.exercise_name,
            exercise_order: ex.order,
          }));
      }
    }

    if (workout.type === 'weight') {
      setStep('tracker');
    } else {
      setStep('simple');
    }
  }, [workoutId]);

  const handleTypeSelect = (type: WorkoutType) => {
    setSelectedType(type);
    if (type === 'weight') {
      setStep('template');
    } else {
      setStep('simple');
    }
  };

  const handleTemplateSelect = async (templateId: string) => {
    if (!token || starting) return;
    setStarting(true);
    try {
      const tpl = templates.value.find((t) => t.id === templateId);
      const name = tpl?.name || 'Workout';
      const id = await startWorkout({
        type: 'weight',
        name,
        template_id: templateId,
      }, token);
      setActiveId(id);
      setWorkoutName(name);
      setStep('tracker');
      // Update URL without triggering re-render loop
      window.location.hash = `#/workout/${id}`;
    } catch {
      // Error toast shown by action
    } finally {
      setStarting(false);
    }
  };

  const handleBuildCustom = async () => {
    if (!token || starting) return;
    setStarting(true);
    try {
      const name = 'Custom Workout';
      const id = await startWorkout({
        type: 'weight',
        name,
      }, token);
      setActiveId(id);
      setWorkoutName(name);
      setStep('tracker');
      window.location.hash = `#/workout/${id}`;
    } catch {
      // Error toast shown by action
    } finally {
      setStarting(false);
    }
  };

  if (starting) {
    return (
      <div class="loading-screen">
        <div class="spinner" />
        <p>Starting workout...</p>
      </div>
    );
  }

  switch (step) {
    case 'type':
      return <TypeSelector onSelect={handleTypeSelect} />;
    case 'template':
      return (
        <TemplatePicker
          onSelectTemplate={handleTemplateSelect}
          onBuildCustom={handleBuildCustom}
          onBack={() => setStep('type')}
        />
      );
    case 'tracker':
      return activeId ? (
        <WorkoutTracker workoutId={activeId} workoutName={workoutName} />
      ) : null;
    case 'simple':
      return (
        <SimpleWorkout
          workoutType={selectedType}
          onBack={() => setStep('type')}
        />
      );
    default:
      return null;
  }
}
