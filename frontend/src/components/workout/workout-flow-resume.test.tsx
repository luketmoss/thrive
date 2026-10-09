// #351: resuming `#/workout/:id` rebuilds the warmup list from that workout
// alone, through the rule startPlannedWorkout uses. These drive the real
// WorkoutFlow, planner and actions in demo mode. The tracker is stubbed to
// list exactly what the real one lists on mount:
// mergeWarmups(buildExerciseList(activeWorkoutSets), activeWarmupExercises).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import {
  workouts, sets, templates, activeWorkoutId, activeWorkoutSets, activeWarmupExercises,
} from '../../state/store';
import type { SetWithRow, Template, WorkoutWithRow } from '../../api/types';
import { buildExerciseList, mergeWarmups } from './build-exercise-list';

const navigate = vi.fn();

vi.mock('../../api/demo-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/demo-data')>()),
  isDemo: () => true,
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: (p: string) => navigate(p) }));
vi.mock('./workout-tracker', () => ({
  WorkoutTracker: ({ workoutId }: { workoutId: string }) => {
    const list = mergeWarmups(buildExerciseList(activeWorkoutSets.value), activeWarmupExercises.value);
    return h('ul', { 'data-testid': 'tracker', 'data-workout': workoutId },
      list.map((ex) => h('li', null, `${ex.exercise_order}:${ex.section}:${ex.exercise_name}`)));
  },
}));

const { WorkoutFlow } = await import('./workout-flow');
const { startPlannedWorkout } = await import('../../state/actions');

const PUSH: Template = {
  id: 'tpl_push',
  name: 'Upper Push A',
  exercises: [
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_bp', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 3 },
  ],
};

function workout(id: string, over: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id, date: '2026-10-09', time: '09:00', type: 'weight', name: id, template_id: '', notes: '',
    elapsed_seconds: '', created: '', copied_from: '', status: 'active',
    moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
    sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '',
    synced_at: '', started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '',
    sheetRow: 2, ...over,
  };
}

let nextRow = 2;
function set(workout_id: string, exercise_id: string, exercise_name: string, section: string, exercise_order: number, set_number = 1): SetWithRow {
  return {
    workout_id, exercise_id, exercise_name, section, exercise_order, set_number,
    planned_reps: '', weight: '', reps: '', effort: '', sheetRow: nextRow++,
  };
}

const STALE = [{ exercise_id: 'ex_stale', exercise_name: 'Stale Warmup', exercise_order: 0 }];

const listed = (c: Element) =>
  Array.from(c.querySelectorAll('[data-testid="tracker"] li')).map((li) => li.textContent);

beforeEach(() => {
  nextRow = 2;
  templates.value = [PUSH];
  workouts.value = [];
  sets.value = [];
  activeWorkoutId.value = null;
  activeWorkoutSets.value = [];
  activeWarmupExercises.value = [];
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('AC3: resuming a workout without a template clears stale warmups', () => {
  it('no template_id: [] and exactly its own rows', () => {
    workouts.value = [workout('w_c')];
    sets.value = [set('w_c', 'ex_sq', 'Squat', 'primary', 1)];
    activeWarmupExercises.value = [...STALE];

    const { container } = render(<WorkoutFlow workoutId="w_c" />);

    expect(activeWarmupExercises.value).toEqual([]);
    expect(listed(container)).toEqual(['1:primary:Squat']);
  });

  it('template not loaded: [] and exactly its own rows', () => {
    workouts.value = [workout('w_c', { template_id: 'tpl_deleted' })];
    sets.value = [set('w_c', 'ex_sq', 'Squat', 'primary', 1)];
    activeWarmupExercises.value = [...STALE];

    const { container } = render(<WorkoutFlow workoutId="w_c" />);

    expect(activeWarmupExercises.value).toEqual([]);
    expect(listed(container)).toEqual(['1:primary:Squat']);
  });
});

describe('AC4: resuming a template workout uses the plan-start warmup rule', () => {
  it('a warmup moved from order 1 to 3 is listed once, at 3', () => {
    workouts.value = [workout('w_t', { template_id: 'tpl_push' })];
    sets.value = [
      set('w_t', 'ex_bp', 'Bench Press BB', 'primary', 2),
      set('w_t', 'ex_wu', 'Band Pull-Apart', 'warmup', 3),
    ];

    const { container } = render(<WorkoutFlow workoutId="w_t" />);

    expect(activeWarmupExercises.value).toEqual([]);
    expect(listed(container)).toEqual(['2:primary:Bench Press BB', '3:warmup:Band Pull-Apart']);
  });

  it('a removed warmup does not come back while another warmup row exists', () => {
    workouts.value = [workout('w_t', { template_id: 'tpl_push' })];
    sets.value = [
      set('w_t', 'ex_other', 'Arm Circles', 'warmup', 1),
      set('w_t', 'ex_bp', 'Bench Press BB', 'primary', 2),
    ];

    const { container } = render(<WorkoutFlow workoutId="w_t" />);

    expect(listed(container)).toEqual(['1:warmup:Arm Circles', '2:primary:Bench Press BB']);
  });

  it('a legacy workout with no warmup rows still gets the template warmups', () => {
    workouts.value = [workout('w_t', { template_id: 'tpl_push' })];
    sets.value = [set('w_t', 'ex_bp', 'Bench Press BB', 'primary', 2)];
    activeWarmupExercises.value = [...STALE];

    const { container } = render(<WorkoutFlow workoutId="w_t" />);

    expect(activeWarmupExercises.value).toEqual([{ exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', exercise_order: 1 }]);
    expect(listed(container)).toEqual(['1:warmup:Band Pull-Apart', '2:primary:Bench Press BB']);
  });

  it('straight after startPlannedWorkout, resume agrees with it', async () => {
    workouts.value = [workout('w_p', { template_id: 'tpl_push', status: 'planned' })];
    sets.value = [
      set('w_p', 'ex_bp', 'Bench Press BB', 'primary', 2),
      set('w_p', 'ex_wu', 'Band Pull-Apart', 'warmup', 3),
    ];

    await startPlannedWorkout('w_p', 'test-token');
    const afterStart = activeWarmupExercises.value;
    const { container } = render(<WorkoutFlow workoutId="w_p" />);

    expect(activeWarmupExercises.value).toEqual(afterStart);
    expect(listed(container)).toEqual(['2:primary:Bench Press BB', '3:warmup:Band Pull-Apart']);
  });
});

describe('AC5: planning a template while a custom workout is active', () => {
  it('leaves the active workout\'s list exactly as it was, and the plan keeps its warmups', async () => {
    workouts.value = [workout('w_a')];
    sets.value = [
      set('w_a', 'ex_sq', 'Squat', 'primary', 1),
      set('w_a', 'ex_sq', 'Squat', 'primary', 1, 2),
      set('w_a', 'ex_rdl', 'RDL', 'SS1', 2),
    ];

    const { container, rerender } = render(<WorkoutFlow workoutId="w_a" />);
    const before = listed(container);
    expect(before).toEqual(['1:primary:Squat', '2:SS1:RDL']);

    // Plan for Later from the Day screen's link, pick "Upper Push A", save.
    rerender(<WorkoutFlow planDate="2099-12-31" />);
    await Promise.resolve();
    const tap = async (text: string) => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
      if (!btn) throw new Error(`No button "${text}" in: ${container.textContent}`);
      fireEvent.click(btn);
      await Promise.resolve();
    };
    await tap('Upper Push A');
    await tap('Save Workout');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/activities'));

    const plan = workouts.value.find((w) => w.status === 'planned')!;
    expect(plan).toBeDefined();
    expect(sets.value.filter((s) => s.workout_id === plan.id).map((s) => `${s.exercise_order}:${s.section}`))
      .toEqual(['1:warmup', '2:primary', '2:primary', '2:primary']);

    // Return to the active workout.
    cleanup();
    const back = render(<WorkoutFlow workoutId="w_a" />);
    expect(activeWorkoutId.value).toBe('w_a');
    expect(listed(back.container)).toEqual(before);
  });
});
