// #385 — every label on the edit-workout form, the simple-workout form and the
// tracker's edit-details panel names a control: a text control through
// htmlFor/id, a toggle group through aria-labelledby on a visible <span>.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { activeWorkoutSets, activeWarmupExercises, isEditMode, workouts } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';

vi.mock('../../state/actions', () => ({
  saveSet: vi.fn(), removeSet: vi.fn(), finishWorkout: vi.fn(), deleteWorkout: vi.fn(),
  saveWorkoutEdits: vi.fn(), exitEditMode: vi.fn(), saveSimpleWorkoutEdits: vi.fn(),
  startSimpleWorkout: vi.fn(), finishSimpleWorkout: vi.fn(),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn(), goBack: vi.fn() }));

const { EditWorkoutForm } = await import('../activities/edit-workout-form');
const { SimpleWorkout } = await import('../workout/simple-workout');
const { WorkoutTracker } = await import('../workout/workout-tracker');
const { SubTypeToggle } = await import('./sub-type-toggle');

const BIKE = {
  id: 'w_b1', date: '2026-09-20', time: '07:05', type: 'bike', name: 'Ride', template_id: '',
  notes: '', elapsed_seconds: '', created: '', copied_from: '', status: '', moving_seconds: '',
  effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '',
  source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '',
  started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 2,
} as WorkoutWithRow;

afterEach(() => {
  cleanup();
  isEditMode.value = false;
  workouts.value = [];
  activeWorkoutSets.value = [];
});

/** Every <label> must wrap a control or point (htmlFor) at one in the document. */
function expectNoOrphanLabels(root: ParentNode = document) {
  const labels = [...root.querySelectorAll('label')];
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) {
    const target = l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input,textarea,select,button');
    expect(target, `label "${l.textContent}" has no control`).not.toBeNull();
  }
}

function expectEffortGroup() {
  const group = screen.getByRole('group', { name: 'Session Effort (optional)' });
  const label = document.getElementById(group.getAttribute('aria-labelledby')!)!;
  expect(label.tagName).toBe('SPAN');
  expect(label.classList.contains('form-label')).toBe(true);
  expect(screen.getByRole('button', { name: 'Session effort: Easy' })).toBeTruthy();
}

describe('AC1/AC3/AC5: edit-workout form', () => {
  it('names the groups by their visible labels and leaves no orphan label', () => {
    workouts.value = [BIKE];
    render(h(EditWorkoutForm as never, { workoutId: BIKE.id }));
    expectEffortGroup();
    const type = screen.getByRole('group', { name: 'Type (optional)' });
    expect(document.getElementById(type.getAttribute('aria-labelledby')!)!.tagName).toBe('SPAN');
    expect(screen.getByRole('button', { name: 'Activity type: Mountain' })).toBeTruthy();
    expectNoOrphanLabels();
  });
});

describe('AC1-AC5: simple-workout form', () => {
  it('names every control by its visible label', () => {
    render(h(SimpleWorkout as never, { workoutType: 'bike', onBack: vi.fn() }));
    expectEffortGroup();
    expect(screen.getByRole('group', { name: 'Type (optional)' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Duration (minutes)' })).toBeTruthy();
    expectNoOrphanLabels();
  });

  it('has no venue group for a sport without one', () => {
    render(h(SimpleWorkout as never, { workoutType: 'stretch', onBack: vi.fn() }));
    expect(screen.queryByRole('group', { name: 'Type (optional)' })).toBeNull();
    expectNoOrphanLabels();
  });
});

describe('AC1/AC5: tracker edit-details panel', () => {
  it('names the effort group by its visible label', () => {
    isEditMode.value = true;
    activeWorkoutSets.value = [];
    activeWarmupExercises.value = [];
    workouts.value = [{ ...BIKE, type: 'weight' } as WorkoutWithRow];
    render(h(WorkoutTracker as never, { workoutId: BIKE.id, workoutName: 'Ride' }));
    expectEffortGroup();
    expectNoOrphanLabels();
  });
});

describe('AC5: SubTypeToggle', () => {
  it('without labelledBy the group is named by label, as before', () => {
    render(h(SubTypeToggle as never, { workoutType: 'bike', value: '', onChange: vi.fn(), label: 'Activity type' }));
    expect(screen.getByRole('group', { name: 'Activity type' })).toBeTruthy();
  });

  it('with labelledBy the visible text names the group; buttons keep label', () => {
    render(h('div', null,
      h('span', { id: 'lbl' }, 'Type (optional)'),
      h(SubTypeToggle as never, { workoutType: 'bike', value: '', onChange: vi.fn(), label: 'Activity type', labelledBy: 'lbl' })));
    expect(screen.getByRole('group', { name: 'Type (optional)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activity type: Gravel' })).toBeTruthy();
  });
});
