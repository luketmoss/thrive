import { describe, it, expect, vi, beforeEach } from 'vitest';

// #360: finishing a started planned non-weight workout updates that row.
const updateWorkout = vi.fn();
const createWorkout = vi.fn();

vi.mock('../api/workouts-api', async (orig) => ({
  ...(await orig<typeof import('../api/workouts-api')>()),
  updateWorkout: (...a: unknown[]) => updateWorkout(...a),
  createWorkout: (...a: unknown[]) => createWorkout(...a),
}));

import { finishSimpleWorkout } from './actions';
import { workouts, activeWorkoutId, activeWorkoutSets, toasts } from './store';
import { WorkoutRowMismatchError } from '../api/workouts-api';
import type { WorkoutWithRow, WorkoutType } from '../api/types';

const planned = (type: WorkoutType): WorkoutWithRow => ({
  id: 'w1', date: '2026-10-07', time: '09:00', type, name: 'Stretch', template_id: '',
  notes: '', elapsed_seconds: '', created: '', copied_from: '', status: 'active',
  moving_seconds: '', effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '',
  sub_type: '', source: '', source_activity_id: '', raw_ref: '', fit_ref: '',
  fit_fetched_at: '', synced_at: '', started_at_utc: '', calories: '',
  estimated_seconds: '1800', sport_type: '', sheetRow: 5,
} as WorkoutWithRow);

const data = {
  name: 'Evening stretch', notes: 'loose', elapsed_seconds: '1500', effort: 'Easy' as const,
  distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '', date: '2026-10-07',
};

describe('finishSimpleWorkout (#360)', () => {
  beforeEach(() => {
    updateWorkout.mockReset();
    createWorkout.mockReset();
    toasts.value = [];
    activeWorkoutId.value = 'w1';
    activeWorkoutSets.value = [];
  });

  for (const type of ['stretch', 'bike', 'hike', 'run', 'walk'] as WorkoutType[]) {
    it(`finishes a planned ${type} row in place and clears the active state`, async () => {
      const row = planned(type);
      workouts.value = [row];
      updateWorkout.mockImplementation(async (w, patch) => ({ ...w, ...patch }));

      await finishSimpleWorkout('w1', data, 'tok');

      expect(createWorkout).not.toHaveBeenCalled();
      expect(updateWorkout).toHaveBeenCalledWith(row, { ...data, status: '' }, 'tok');
      expect(workouts.value).toHaveLength(1);
      expect(workouts.value[0]).toMatchObject({ id: 'w1', status: '', notes: 'loose', elapsed_seconds: '1500', effort: 'Easy', estimated_seconds: '1800' });
      expect(activeWorkoutId.value).toBeNull();
    });
  }

  it('keeps the row active and the input when the row moved', async () => {
    workouts.value = [planned('stretch')];
    updateWorkout.mockRejectedValue(new WorkoutRowMismatchError('w1'));

    await expect(finishSimpleWorkout('w1', data, 'tok')).rejects.toBeInstanceOf(WorkoutRowMismatchError);

    expect(workouts.value[0].status).toBe('active');
    expect(activeWorkoutId.value).toBe('w1');
    expect(createWorkout).not.toHaveBeenCalled();
    expect(toasts.value[toasts.value.length - 1]?.type).toBe('error');
  });

  it('keeps the row active on any other failure', async () => {
    workouts.value = [planned('stretch')];
    updateWorkout.mockRejectedValue(new Error('boom'));
    await expect(finishSimpleWorkout('w1', data, 'tok')).rejects.toThrow('boom');
    expect(workouts.value[0].status).toBe('active');
    expect(activeWorkoutId.value).toBe('w1');
  });
});
