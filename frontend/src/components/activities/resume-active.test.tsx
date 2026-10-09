// #362 — an in-progress workout can be resumed from the detail screen and the
// Day view, whatever its type.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'tok' }) }));

const navigate = vi.fn();
vi.mock('../../router/router', async (orig) => ({
  ...(await orig<typeof import('../../router/router')>()),
  navigate: (p: string) => navigate(p),
}));

import { WorkoutDetail } from './workout-detail';
import { TrainingPanel } from '../day/training-panel';
import { workouts, sets, activeWorkoutId } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';

const D = '2026-10-09';

function wk(over: Partial<WorkoutWithRow>): WorkoutWithRow {
  return {
    id: 'w1', date: D, time: '07:30', type: 'weight', name: 'Upper Pull', template_id: '', notes: '',
    elapsed_seconds: '', created: '', copied_from: '', status: 'active', moving_seconds: '', effort: '',
    distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', source: '', source_activity_id: '',
    raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '',
    estimated_seconds: '', sport_type: '', sheetRow: 2, ...over,
  };
}

beforeEach(() => {
  navigate.mockClear();
  activeWorkoutId.value = null;
});
afterEach(() => {
  cleanup();
  workouts.value = [];
  sets.value = [];
  activeWorkoutId.value = null;
});

describe('AC1: Resume on the detail screen', () => {
  it('offers Resume Workout for an active workout, above Delete, and no Start', () => {
    workouts.value = [wk({})];
    const { container } = render(h(WorkoutDetail, { workoutId: 'w1' }));
    const actions = container.querySelector('.detail-actions')!;
    const buttons = [...actions.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Resume Workout', 'Delete Workout']);
    expect(screen.queryByText('Start Workout')).toBeNull();
  });

  it('reads "Active" in the badge instead of the type', () => {
    workouts.value = [wk({})];
    const { container } = render(h(WorkoutDetail, { workoutId: 'w1' }));
    expect(container.querySelector('.detail-info-row .badge-active')!.textContent).toBe('Active');
    expect(container.querySelector('.detail-info-row .badge-weight')).toBeNull();
  });

  it.each(['weight', 'stretch', 'bike', 'hike', 'run', 'walk'] as const)(
    'Resume opens the workout screen for %s',
    (type) => {
      workouts.value = [wk({ type })];
      render(h(WorkoutDetail, { workoutId: 'w1' }));
      fireEvent.click(screen.getByText('Resume Workout'));
      expect(navigate).toHaveBeenCalledWith('/workout/w1');
    },
  );

  it('keeps Edit in the header', () => {
    workouts.value = [wk({})];
    render(h(WorkoutDetail, { workoutId: 'w1' }));
    expect(screen.getByText('Edit')).toBeTruthy();
  });
});

describe('AC2: the Day view card goes straight back in', () => {
  function panel() {
    return render(h(TrainingPanel, { date: D, state: 'today', today: D }));
  }

  it('links an active card to the workout screen, with an in-progress name', () => {
    workouts.value = [wk({})];
    const { container } = panel();
    const card = container.querySelector('a.training-card') as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe('#/workout/w1');
    expect(card.getAttribute('aria-label')).toBe('Upper Pull, in progress. Resume workout.');
    expect(card.querySelector('.badge-active')!.textContent).toBe('Active');
  });
});

describe('AC3: the start guard does not block a resume', () => {
  it('Resume shows no toast when another workout is the tracked one', () => {
    workouts.value = [wk({ id: 'w1' }), wk({ id: 'w2', sheetRow: 3 })];
    activeWorkoutId.value = 'w2';
    render(h(WorkoutDetail, { workoutId: 'w1' }));
    fireEvent.click(screen.getByText('Resume Workout'));
    expect(navigate).toHaveBeenCalledWith('/workout/w1');
    expect(screen.queryByText(/Finish your current workout/)).toBeNull();
  });
});

describe('AC4: nothing else changes', () => {
  it('a completed workout has no Resume and a done card still opens the detail screen', () => {
    workouts.value = [wk({ status: '' })];
    const { container } = render(h(WorkoutDetail, { workoutId: 'w1' }));
    expect(screen.queryByText('Resume Workout')).toBeNull();
    expect(container.querySelector('.detail-info-row .badge-weight')).toBeTruthy();
    cleanup();
    const p = render(h(TrainingPanel, { date: D, state: 'today', today: D }));
    const card = p.container.querySelector('a.training-card') as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe('#/history/w1');
    expect(card.getAttribute('aria-label')).toBeNull();
  });

  it('a planned workout still shows Start Workout, not Resume', () => {
    workouts.value = [wk({ status: 'planned' })];
    render(h(WorkoutDetail, { workoutId: 'w1' }));
    expect(screen.getByText('Start Workout')).toBeTruthy();
    expect(screen.queryByText('Resume Workout')).toBeNull();
  });
});
