// #371 — Move up/down in the workout tracker (log and edit mode): focus stays
// on the moved exercise's button, ends are aria-disabled, each move is
// announced once in the shared wording, and a row keeps its own state. The
// list holds "Row BB" twice, so rows must be told apart by more than
// exercise_id. The row key is client-only: no payload may carry it.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { activeWorkoutSets, activeWarmupExercises, isEditMode, workouts } from '../../state/store';
import type { SetWithRow } from '../../api/types';

const saveSet = vi.fn(async (..._args: unknown[]) => ({ sheetRow: 99 }));
const saveWorkoutEdits = vi.fn(async (..._args: unknown[]) => undefined);
const finishWorkout = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../state/actions', () => ({
  saveSet: (...args: unknown[]) => saveSet(...args),
  removeSet: vi.fn(),
  finishWorkout: (...args: unknown[]) => finishWorkout(...args),
  deleteWorkout: vi.fn(),
  saveWorkoutEdits: (...args: unknown[]) => saveWorkoutEdits(...args),
  exitEditMode: vi.fn(),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn(), goBack: vi.fn() }));

const { WorkoutTracker } = await import('./workout-tracker');

const LIST: [string, string, string][] = [
  ['e1', 'Row BB', 'primary'],
  ['e2', 'Pull-up', 'primary'],
  ['e1', 'Row BB', 'SS1'],
  ['e3', 'Curl', 'burnout'],
];

function setRows(): SetWithRow[] {
  return LIST.map(([exercise_id, exercise_name, section], i) => ({
    workout_id: 'w1', exercise_id, exercise_name, section, exercise_order: i + 1, set_number: 1,
    planned_reps: '8', weight: '', reps: '', effort: '', sheetRow: i + 2,
  }));
}

beforeEach(() => {
  activeWorkoutSets.value = setRows();
  activeWarmupExercises.value = [];
  workouts.value = [];
  saveSet.mockClear();
  saveWorkoutEdits.mockClear();
  finishWorkout.mockClear();
});
afterEach(() => {
  cleanup();
  isEditMode.value = false;
});

const rows = () => [...document.querySelectorAll<HTMLElement>('.tracker-exercise-list > [data-row-key]')];
const sections = () => rows().map((r) => r.querySelector('.section-badge-btn')!.textContent);
const moveBtn = (row: number, dir: 'up' | 'down') =>
  rows()[row].querySelector<HTMLButtonElement>(`[data-move="${dir}"]`)!;
const status = () => document.querySelector('.workout-tracker [role="status"]')!;

const modes: [string, boolean][] = [['log mode', false], ['edit mode', true]];

describe.each(modes)('%s', (_name, edit) => {
  const mount = () => {
    isEditMode.value = edit;
    return render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
  };

  it('rows carry distinct row keys on the root element', () => {
    mount();
    const keys = rows().map((r) => r.dataset.rowKey);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    rows().forEach((r) => expect(r.classList.contains('tracker-exercise')).toBe(true));
  });

  it('AC1 + AC3: focus follows the moved duplicate, and pressing again moves it again', () => {
    mount();
    // The second "Row BB" (SS1), third of four.
    const key = rows()[2].dataset.rowKey;
    moveBtn(2, 'up').focus();
    fireEvent.click(moveBtn(2, 'up'));
    expect(sections()).toEqual(['primary', 'SS1', 'primary', 'burnout']);
    expect(rows()[1].dataset.rowKey).toBe(key);
    expect(document.activeElement).toBe(moveBtn(1, 'up'));
    expect(status().textContent).toBe('Row BB moved to position 2 of 4');

    fireEvent.click(document.activeElement as HTMLElement);
    expect(sections()).toEqual(['SS1', 'primary', 'primary', 'burnout']);
    expect(document.activeElement).toBe(moveBtn(0, 'up'));
  });

  it('AC1: Move down keeps focus on Move down', () => {
    mount();
    moveBtn(1, 'down').focus();
    fireEvent.click(moveBtn(1, 'down'));
    expect(sections()).toEqual(['primary', 'SS1', 'primary', 'burnout']);
    expect(document.activeElement).toBe(moveBtn(2, 'down'));
    expect(status().textContent).toBe('Pull-up moved to position 3 of 4');
  });

  it('AC2: end buttons are aria-disabled, not disabled, and do nothing', () => {
    mount();
    const top = moveBtn(0, 'up');
    const bottom = moveBtn(3, 'down');
    for (const b of [top, bottom]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.hasAttribute('disabled')).toBe(false);
      expect(b.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    }
    expect(moveBtn(1, 'up').hasAttribute('aria-disabled')).toBe(false);
    top.focus();
    fireEvent.click(top);
    fireEvent.click(bottom);
    expect(sections()).toEqual(['primary', 'primary', 'SS1', 'burnout']);
    expect(status().textContent).toBe('');
  });

  it('AC2: a move to the last position keeps focus on the now aria-disabled button', () => {
    mount();
    moveBtn(2, 'down').focus();
    fireEvent.click(moveBtn(2, 'down'));
    expect(sections()).toEqual(['primary', 'primary', 'burnout', 'SS1']);
    const btn = moveBtn(3, 'down');
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('AC4: an open panel and section picker travel with the row; set values are kept', () => {
    mount();
    const row = rows()[2];
    fireEvent.click(row.querySelector('.last-time-toggle')!);
    fireEvent.click(row.querySelector('.section-badge-btn')!);
    const weight = row.querySelector<HTMLInputElement>('.tracker-set-list .set-weight-input')!;
    fireEvent.input(weight, { target: { value: '135' } });

    fireEvent.click(moveBtn(2, 'up'));
    const moved = rows()[1];
    expect(moved).toBe(row);
    expect(moved.querySelector('.last-time-panel')).not.toBeNull();
    expect(moved.querySelector('.section-picker-row')).not.toBeNull();
    expect(moved.querySelector<HTMLInputElement>('.tracker-set-list .set-weight-input')!.value).toBe('135');
    // The row it swapped with did not pick up the open state.
    expect(rows()[2].querySelector('.last-time-panel')).toBeNull();
    expect(rows()[2].querySelector('.section-picker-row')).toBeNull();
  });

  it('AC5: one announcement per move, in the shared wording', () => {
    mount();
    fireEvent.click(moveBtn(3, 'up'));
    expect(status().textContent).toBe('Curl moved to position 3 of 4');
    expect(document.querySelectorAll('.workout-tracker [role="status"]')).toHaveLength(1);
  });
});

describe('AC6: the row key never reaches a payload', () => {
  it('edit-mode save swaps exercise_order and carries no rowKey', async () => {
    isEditMode.value = true;
    const view = render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
    fireEvent.click(moveBtn(2, 'up'));
    fireEvent.click(view.getByText('Save Changes'));
    await vi.waitFor(() => expect(saveWorkoutEdits).toHaveBeenCalled());
    const edited = saveWorkoutEdits.mock.calls[0][2] as Record<string, unknown>[];
    expect(JSON.stringify(saveWorkoutEdits.mock.calls[0])).not.toContain('row-');
    for (const s of edited) expect(Object.keys(s)).not.toContain('rowKey');
    const orderOf = (section: string) => edited.find((s) => s.section === section)!.exercise_order;
    expect(orderOf('SS1')).toBe(2);
    expect(edited.find((s) => s.exercise_id === 'e2')!.exercise_order).toBe(3);
  });

  it('finish saves sets with the swapped order and no rowKey', async () => {
    const view = render(<WorkoutTracker workoutId="w1" workoutName="Pull A" />);
    const weight = rows()[2].querySelector<HTMLInputElement>('.tracker-set-list .set-weight-input')!;
    fireEvent.input(weight, { target: { value: '135' } });
    fireEvent.click(moveBtn(2, 'up'));
    fireEvent.click(view.getAllByText('Finish')[0]);
    const finishBtns = view.getAllByRole('button', { name: /finish/i });
    fireEvent.click(finishBtns[finishBtns.length - 1]);
    await vi.waitFor(() => expect(finishWorkout).toHaveBeenCalled());
    const payload = saveSet.mock.calls[saveSet.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('rowKey');
    expect(payload).toMatchObject({ exercise_id: 'e1', section: 'SS1', exercise_order: 2, weight: '135' });
  });
});
