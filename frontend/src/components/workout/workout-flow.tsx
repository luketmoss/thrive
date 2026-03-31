import { useState, useEffect } from 'preact/hooks';
import { workouts, activeWorkoutId, activeWorkoutSets, activeWarmupExercises, sets, templates } from '../../state/store';
import { startWorkout, saveWorkoutForLater } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { TypeSelector } from './type-selector';
import { IntentSelector } from './intent-selector';
import { TemplatePicker } from './template-picker';
import { WorkoutTracker } from './workout-tracker';
import { SimpleWorkout } from './simple-workout';
import { WorkoutPlanner } from './workout-planner';
import type { WorkoutType, BuilderExercise } from '../../api/types';
import type { PlannerExercise } from './workout-planner';

type FlowStep = 'type' | 'intent' | 'template' | 'planner' | 'tracker' | 'simple';
type Intent = 'track' | 'plan';

interface Props {
  workoutId?: string;
}

export function WorkoutFlow({ workoutId }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<FlowStep>('type');
  const [selectedType, setSelectedType] = useState<WorkoutType>('weight');
  const [activeId, setActiveId] = useState<string | null>(workoutId || null);
  const [workoutName, setWorkoutName] = useState('');
  const [intent, setIntent] = useState<Intent>('track');
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Planner state: exercises to pre-populate when user picks a template for "plan for later"
  const [plannerName, setPlannerName] = useState('');
  const [plannerExercises, setPlannerExercises] = useState<PlannerExercise[]>([]);

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
      setStep('intent');
    } else {
      setStep('simple');
    }
  };

  const handleIntentSelect = (selectedIntent: Intent) => {
    setIntent(selectedIntent);
    setStep('template');
  };

  // Called when the user taps a template card
  const handleTemplateCardTap = async (templateId: string) => {
    const tpl = templates.value.find((t) => t.id === templateId);
    if (!tpl) return;

    if (intent === 'track') {
      // Track Now: go straight to tracker with template exercises
      if (!token || starting) return;
      setStarting(true);
      try {
        const name = tpl.name;
        const id = await startWorkout({ type: 'weight', name, template_id: templateId }, token);
        setActiveId(id);
        setWorkoutName(name);
        setStep('tracker');
        window.location.hash = `#/workout/${id}`;
      } catch {
        // Error toast shown by action
      } finally {
        setStarting(false);
      }
    } else {
      // Plan for Later: populate planner with template exercises
      setPlannerName(tpl.name);
      setPlannerExercises(
        tpl.exercises.map((ex) => ({
          exercise_id: ex.exercise_id,
          exercise_name: ex.exercise_name,
          section: ex.section as string,
          sets: ex.section === 'warmup' ? '' : (ex.sets || '1'),
          reps: ex.reps,
        })),
      );
      setStep('planner');
    }
  };

  // Called when the user taps "Build Custom"
  const handleBuildCustomTap = async () => {
    if (intent === 'track') {
      // Track Now + Build Custom: go straight to tracker with empty workout
      if (!token) return;
      setStarting(true);
      try {
        const name = 'Custom Workout';
        const id = await startWorkout({ type: 'weight', name }, token);
        setActiveId(id);
        setWorkoutName(name);
        setStep('tracker');
        window.location.hash = `#/workout/${id}`;
      } catch {
        // Error toast shown by action
      } finally {
        setStarting(false);
      }
    } else {
      // Plan for Later + Build Custom: go to empty planner
      setPlannerName('');
      setPlannerExercises([]);
      setStep('planner');
    }
  };

  // Planner: "Save Workout" handler
  const handlePlannerSave = async (name: string, exercises: PlannerExercise[]) => {
    if (!token) return;
    setSaving(true);
    try {
      const builderExercises: BuilderExercise[] = exercises.map((ex) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: ex.section,
        sets: Number(ex.sets) || 1,
        planned_reps: ex.reps,
      }));
      await saveWorkoutForLater({ type: 'weight', name, exercises: builderExercises }, token);
      navigate('/');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  if (starting && step !== 'planner') {
    return (
      <div class="loading-screen">
        <div class="spinner" />
        <p>Starting workout…</p>
      </div>
    );
  }

  switch (step) {
    case 'type':
      return <TypeSelector onSelect={handleTypeSelect} />;
    case 'intent':
      return (
        <IntentSelector
          onTrackNow={() => handleIntentSelect('track')}
          onPlanForLater={() => handleIntentSelect('plan')}
          onBack={() => setStep('type')}
        />
      );
    case 'template':
      return (
        <TemplatePicker
          onSelectTemplate={handleTemplateCardTap}
          onBuildCustom={handleBuildCustomTap}
          onBack={() => setStep('intent')}
        />
      );
    case 'planner':
      return (
        <WorkoutPlanner
          initialName={plannerName}
          initialExercises={plannerExercises}
          onSave={handlePlannerSave}
          onDiscard={() => setStep('template')}
          saving={saving}
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
