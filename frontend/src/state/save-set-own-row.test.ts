// #389 — saveSet's row targeting. Given the set's own row, it updates that
// row and looks nothing up by order; given -1, it appends and takes the row
// just appended (the LAST match), never an earlier twin's; left out, the
// order lookup is unchanged. The offline fallback queues the same row.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activeWorkoutSets, sets, activeWorkoutId } from './store';
import type { SetWithRow, WorkoutSet } from '../api/types';

const api = vi.hoisted(() => ({
  updateSet: vi.fn(async (..._a: unknown[]) => undefined),
  appendSet: vi.fn(async (..._a: unknown[]) => undefined),
  fetchSets: vi.fn(async (..._a: unknown[]): Promise<SetWithRow[]> => []),
}));
vi.mock('../api/workouts-api', async (orig) => ({
  ...(await orig<typeof import('../api/workouts-api')>()),
  updateSet: api.updateSet,
  appendSet: api.appendSet,
  fetchSets: api.fetchSets,
}));
const enqueueSet = vi.hoisted(() => vi.fn());
vi.mock('../api/sync-queue', async (orig) => ({
  ...(await orig<typeof import('../api/sync-queue')>()),
  enqueueSet,
}));

const { saveSet, SetRowStaleError } = await import('./actions');

const row = (o: Partial<SetWithRow>): SetWithRow => ({
  workout_id: 'w1', exercise_id: 'e_row', exercise_name: 'Row BB', section: 'primary',
  exercise_order: 1, set_number: 1, planned_reps: '8', weight: '95', reps: '8', effort: '',
  sheetRow: 2, ...o,
});
// The primary copy at order 1 (row 2); the SS1 copy, moved to order 1 in the
// tracker, still at order 2 in the sheet (row 3).
const TWINS = [row({}), row({ section: 'SS1', exercise_order: 2, weight: '', reps: '', sheetRow: 3 })];
const ss1Edit: WorkoutSet = {
  workout_id: 'w1', exercise_id: 'e_row', exercise_name: 'Row BB', section: 'SS1',
  exercise_order: 1, set_number: 1, planned_reps: '8', weight: '135', reps: '', effort: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  activeWorkoutId.value = 'w1';
  activeWorkoutSets.value = [...TWINS];
  sets.value = [...TWINS];
});

describe('#389 saveSet row targeting', () => {
  it('own row given: updates that row, not the order match', async () => {
    const out = await saveSet(ss1Edit, 'tok', 3);
    expect(api.updateSet).toHaveBeenCalledWith(3, ss1Edit, 'tok');
    expect(api.appendSet).not.toHaveBeenCalled();
    expect(out.sheetRow).toBe(3);
    expect(activeWorkoutSets.value[0]).toEqual(TWINS[0]);
    expect(activeWorkoutSets.value[1]).toEqual({ ...ss1Edit, sheetRow: 3 });
  });

  it('no own row (-1): appends, even with a twin at the same key, and takes the appended row', async () => {
    api.fetchSets.mockResolvedValueOnce([...TWINS, row({ section: 'SS1', weight: '135', reps: '', sheetRow: 4 })]);
    const out = await saveSet(ss1Edit, 'tok', -1);
    expect(api.updateSet).not.toHaveBeenCalled();
    expect(api.appendSet).toHaveBeenCalledTimes(1);
    expect(out.sheetRow).toBe(4);
  });

  it('own row left out: the order lookup is unchanged', async () => {
    await saveSet(ss1Edit, 'tok');
    expect(api.updateSet).toHaveBeenCalledWith(2, ss1Edit, 'tok');
  });

  it('network failure: queues the row the save was aimed at, and no row key', async () => {
    api.updateSet.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(saveSet(ss1Edit, 'tok', 3)).rejects.toThrow(TypeError);
    expect(enqueueSet).toHaveBeenCalledWith({ ...ss1Edit, sheetRow: 3 });
  });

  it('network failure on an append queues -1, not a twin\'s row', async () => {
    api.appendSet.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(saveSet(ss1Edit, 'tok', -1)).rejects.toThrow(TypeError);
    expect(enqueueSet).toHaveBeenCalledWith({ ...ss1Edit, sheetRow: -1 });
  });

  describe('the own row is checked before it is written', () => {
    it('refuses a row that now holds another exercise: nothing written or queued', async () => {
      activeWorkoutSets.value = [row({ exercise_id: 'e_curl', exercise_name: 'Curl', sheetRow: 3 })];
      await expect(saveSet(ss1Edit, 'tok', 3)).rejects.toBeInstanceOf(SetRowStaleError);
      expect(api.updateSet).not.toHaveBeenCalled();
      expect(api.appendSet).not.toHaveBeenCalled();
      expect(enqueueSet).not.toHaveBeenCalled();
    });

    it('refuses a row missing from the workout, or holding another set number', async () => {
      await expect(saveSet(ss1Edit, 'tok', 9)).rejects.toBeInstanceOf(SetRowStaleError);
      await expect(saveSet({ ...ss1Edit, set_number: 2 }, 'tok', 3)).rejects.toBeInstanceOf(SetRowStaleError);
      expect(api.updateSet).not.toHaveBeenCalled();
    });

    it('refuses the twin\'s row: same exercise and set number, other section and order', async () => {
      // The primary copy's save, aimed by a stale row at the SS1 copy's row 3.
      const primaryEdit = { ...ss1Edit, section: 'primary', exercise_order: 1 };
      await expect(saveSet(primaryEdit, 'tok', 3)).rejects.toBeInstanceOf(SetRowStaleError);
      expect(api.updateSet).not.toHaveBeenCalled();
    });

    it('accepts a section change at the same order', async () => {
      await saveSet({ ...ss1Edit, section: 'SS2', exercise_order: 2 }, 'tok', 3);
      expect(api.updateSet).toHaveBeenCalledWith(3, expect.objectContaining({ section: 'SS2' }), 'tok');
    });
  });
});
