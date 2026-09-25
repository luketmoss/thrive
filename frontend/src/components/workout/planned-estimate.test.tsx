// #145 — a planned workout's estimated duration: typed in the planner, kept
// and changed by the planned-workout editor, shown on the planned card and
// detail. Drives the real WorkoutFlow, WorkoutPlanner, WorkoutEdit,
// ActivitiesScreen and WorkoutDetail; only the actions that write are mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { templates, workouts, sets, exercises } from '../../state/store';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';

const saveWorkoutForLater = vi.fn(async (_data: unknown, _token: string) => undefined);
const deleteWorkout = vi.fn(async (_id: string, _token: string) => undefined);
const navigate = vi.fn();

vi.mock('../../state/actions', () => ({
  startWorkout: vi.fn(),
  saveWorkoutForLater: (data: unknown, token: string) => saveWorkoutForLater(data, token),
  deleteWorkout: (id: string, token: string) => deleteWorkout(id, token),
  enterEditMode: vi.fn(),
  exitEditMode: vi.fn(),
  startPlannedWorkout: vi.fn(),
  copyWorkout: vi.fn(),
  saveWorkoutAsTemplate: vi.fn(),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: (p: string) => navigate(p) }));
vi.mock('./workout-tracker', () => ({
  WorkoutTracker: ({ workoutId }: { workoutId: string }) => h('div', { 'data-testid': 'tracker' }, workoutId),
}));

const { WorkoutFlow } = await import('./workout-flow');
const { WorkoutEdit } = await import('../activities/workout-edit');
const { ActivitiesScreen } = await import('../activities/activities-screen');
const { WorkoutDetail } = await import('../activities/workout-detail');

const PUSH = {
  id: 'tpl_push',
  name: 'Upper Push A',
  exercises: [
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 2 },
  ],
};

function planned(overrides: Partial<WorkoutWithRow> = {}): WorkoutWithRow {
  return {
    id: 'w_plan', date: '2099-12-31', time: '', type: 'weight', name: 'Upper Pull A', template_id: '',
    notes: '', elapsed_seconds: '', created: '', copied_from: '', status: 'planned', moving_seconds: '',
    effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '',
    source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '',
    started_at_utc: '', calories: '', estimated_seconds: '2820', sheetRow: 2, ...overrides,
  };
}

const PLAN_SETS: SetWithRow[] = [1, 2, 3].map((n) => ({
  workout_id: 'w_plan', exercise_id: 'ex_row', exercise_name: 'Row BB', section: 'primary', exercise_order: 1,
  set_number: n, planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: 1 + n,
}));

const estimateInput = () => document.querySelector<HTMLInputElement>('#planner-estimate')!;
const nameInput = () => document.querySelector<HTMLInputElement>('#planner-name')!;

function button(text: string): HTMLElement {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`No button "${text}" in: ${document.body.textContent}`);
  return el as HTMLElement;
}

async function tap(text: string) {
  fireEvent.click(button(text));
  await Promise.resolve();
  await Promise.resolve();
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.input(input, { target: { value } });
}

const savedEstimate = () =>
  (saveWorkoutForLater.mock.calls[saveWorkoutForLater.mock.calls.length - 1][0] as { estimated_seconds?: string }).estimated_seconds;

beforeEach(() => {
  vi.clearAllMocks();
  templates.value = [PUSH];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  workouts.value = [];
  sets.value = [];
  exercises.value = [];
});

describe('AC2: the planner offers an optional estimate', () => {
  it('is a labelled number field, spelled out in minutes and optional', () => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    fireEvent.click(button('Build Custom'));
    const input = screen.getByLabelText('Estimated duration (minutes, optional)') as HTMLInputElement;
    expect(input).toBe(estimateInput());
    expect(input.type).toBe('number');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.min).toBe('1');
    expect(input.step).toBe('1');
    expect(input.placeholder).toBe('e.g. 45');
  });

  it.each([
    ['a template', () => fireEvent.click(button('Upper Push A'))],
    ['Build Custom', () => fireEvent.click(button('Build Custom'))],
  ])('starts blank when planning from %s — no template default', async (_route, open) => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    open();
    await Promise.resolve();
    expect(estimateInput().value).toBe('');
  });

  it('starts blank on the Plan for Later route too', async () => {
    render(<WorkoutFlow />);
    await tap('Weight');
    await tap('Plan for Later');
    await tap('Upper Push A');
    expect(estimateInput().value).toBe('');
  });

  it('saves 47 minutes as 2820 seconds', async () => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    await tap('Upper Push A');
    type(estimateInput(), '47');
    await tap('Save Workout');
    expect(saveWorkoutForLater).toHaveBeenCalledTimes(1);
    expect(saveWorkoutForLater.mock.calls[0][0]).toMatchObject({
      name: 'Upper Push A', date: '2099-12-31', estimated_seconds: '2820',
    });
  });

  it.each(['', '0', '-5', 'abc'])('saves %j as blank, never 0', async (typed) => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    await tap('Upper Push A');
    if (typed) type(estimateInput(), typed);
    await tap('Save Workout');
    expect(savedEstimate()).toBe('');
  });
});

describe('AC3: the planned-workout editor changes the estimate and never loses it', () => {
  beforeEach(() => {
    workouts.value = [planned()];
    sets.value = PLAN_SETS;
  });

  it('pre-fills the stored estimate in minutes', () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    expect(estimateInput().value).toBe('47');
  });

  it('keeps the estimate through a name-only edit (delete and recreate)', async () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    type(nameInput(), 'Upper Pull B');
    await tap('Save Workout');
    await Promise.resolve();
    expect(deleteWorkout).toHaveBeenCalledWith('w_plan', 'test-token');
    expect(saveWorkoutForLater.mock.calls[0][0]).toMatchObject({
      name: 'Upper Pull B', date: '2099-12-31', estimated_seconds: '2820',
    });
  });

  it('changes it: 50 minutes saves as 3000', async () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    type(estimateInput(), '50');
    await tap('Save Workout');
    await Promise.resolve();
    expect(savedEstimate()).toBe('3000');
  });

  it('clears it: a blanked field saves as blank', async () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    type(estimateInput(), '');
    await tap('Save Workout');
    await Promise.resolve();
    expect(savedEstimate()).toBe('');
  });

  it('a plan with no estimate stays without one', async () => {
    workouts.value = [planned({ estimated_seconds: '' })];
    render(<WorkoutEdit workoutId="w_plan" />);
    expect(estimateInput().value).toBe('');
    await tap('Save Workout');
    await Promise.resolve();
    expect(savedEstimate()).toBe('');
  });

  it('an estimate-only change counts as unsaved, so Back asks first', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorkoutEdit workoutId="w_plan" />);
    type(estimateInput(), '50');
    await tap('Back');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('an untouched estimate does not', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorkoutEdit workoutId="w_plan" />);
    await tap('Back');
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('AC2: a planned workout shows its estimate', () => {
  function card(name: string): HTMLElement {
    return screen.getByText(name).closest('button') as HTMLElement;
  }

  it('ends the planned card meta with "about 47 min", after the date', () => {
    workouts.value = [planned()];
    sets.value = PLAN_SETS;
    render(h(ActivitiesScreen, {}));
    const meta = card('Upper Pull A').querySelector('.workout-meta')!;
    expect(meta.textContent).toMatch(/^1 exercise · .+ · about 47 min$/);
    expect(card('Upper Pull A').getAttribute('aria-label')).toMatch(/, 1 exercise, about 47 minutes$/);
  });

  it('shows nothing on a card with no estimate — no "0 min", no dash', () => {
    workouts.value = [planned({ estimated_seconds: '' })];
    sets.value = PLAN_SETS;
    render(h(ActivitiesScreen, {}));
    const c = card('Upper Pull A');
    expect(c.querySelector('.workout-meta')!.textContent).not.toMatch(/min|—/);
    expect(c.getAttribute('aria-label')).not.toMatch(/minute/);
  });

  it('shows "about 47 min" beside the Planned badge on the detail', () => {
    workouts.value = [planned()];
    sets.value = PLAN_SETS;
    render(h(WorkoutDetail, { workoutId: 'w_plan' }));
    const row = document.querySelector('.detail-info-row')!;
    expect(row.querySelector('.badge-planned')).toBeTruthy();
    expect(row.querySelector('.detail-estimate')!.textContent).toBe('about 47 min');
  });

  it('shows no estimate on the detail when there is none', () => {
    workouts.value = [planned({ estimated_seconds: '' })];
    render(h(WorkoutDetail, { workoutId: 'w_plan' }));
    expect(document.querySelector('.detail-estimate')).toBeNull();
  });

  it('shows no estimate once the workout is no longer planned (AC4)', () => {
    workouts.value = [planned({ status: '', elapsed_seconds: '3300', time: '07:00' })];
    sets.value = PLAN_SETS;
    render(h(WorkoutDetail, { workoutId: 'w_plan' }));
    expect(document.querySelector('.detail-estimate')).toBeNull();
    expect(document.querySelector('.detail-duration')!.textContent).toBe('55 min');
  });
});
