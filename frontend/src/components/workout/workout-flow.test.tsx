// #143: `#/workout/new?plan=YYYY-MM-DD` opens the new-workout flow in plan mode.
// These drive the real WorkoutFlow, TemplatePicker, IntentSelector and
// WorkoutPlanner; only the actions that would write to Sheets are mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { templates } from '../../state/store';
import { toLocalDateStr } from '../activities/activities-helpers';

const startWorkout = vi.fn(async (_data: unknown, _token: string) => 'w_new');
const saveWorkoutForLater = vi.fn(async (_data: unknown, _token: string) => 'w_planned');
const navigate = vi.fn();

vi.mock('../../state/actions', () => ({
  startWorkout: (data: unknown, token: string) => startWorkout(data, token),
  saveWorkoutForLater: (data: unknown, token: string) => saveWorkoutForLater(data, token),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: (p: string) => navigate(p) }));
vi.mock('./workout-tracker', () => ({
  WorkoutTracker: ({ workoutId }: { workoutId: string }) => h('div', { 'data-testid': 'tracker' }, workoutId),
}));

const { WorkoutFlow } = await import('./workout-flow');

const PUSH = {
  id: 'tpl_push',
  name: 'Upper Push A',
  exercises: [
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_1', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 2 },
  ],
};

const heading = (c: Element) => c.querySelector('h2')?.textContent;
const dateInput = (c: Element) => c.querySelector<HTMLInputElement>('#planner-date');

function button(c: Element, text: string): HTMLElement {
  const el = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`No button "${text}" in: ${c.textContent}`);
  return el as HTMLElement;
}

async function tap(c: Element, text: string) {
  fireEvent.click(button(c, text));
  await Promise.resolve();
}

describe('WorkoutFlow ?plan= deep link (#143)', () => {
  beforeEach(() => {
    templates.value = [PUSH];
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('AC1: a valid date opens the flow in plan mode', () => {
    it('skips the type and intent steps and shows the template picker', () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      expect(heading(container)).toBe('Choose a template');
    });

    it('opens the planner on that date from a template', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Upper Push A');
      expect(dateInput(container)?.value).toBe('2026-09-24');
      expect(startWorkout).not.toHaveBeenCalled();
    });

    it('opens the planner on that date from Build Custom', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Build Custom');
      expect(dateInput(container)?.value).toBe('2026-09-24');
    });

    it('saves a planned weight workout on that date, then returns to Activities', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Upper Push A');
      await tap(container, 'Save Workout');
      await Promise.resolve();

      expect(saveWorkoutForLater).toHaveBeenCalledTimes(1);
      expect(saveWorkoutForLater.mock.calls[0][0]).toMatchObject({
        type: 'weight',
        name: 'Upper Push A',
        date: '2026-09-24',
      });
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('does not count the linked date as an unsaved edit', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Upper Push A');
      await tap(container, 'Back');
      expect(confirm).not.toHaveBeenCalled();
      expect(heading(container)).toBe('Choose a template');
    });
  });

  describe('AC2: a missing or malformed date falls back to today, still in plan mode', () => {
    it.each(['', 'tomorrow', '2026-9-4', '2026-02-30'])('?plan=%j', async (raw) => {
      const { container } = render(<WorkoutFlow planDate={raw} />);
      expect(heading(container)).toBe('Choose a template');
      await tap(container, 'Build Custom');
      expect(dateInput(container)?.value).toBe(toLocalDateStr(new Date()));
    });
  });

  describe('AC3: no parameter means no change', () => {
    it('starts at the type selector, then Track Now / Plan for Later', async () => {
      const { container } = render(<WorkoutFlow />);
      expect(heading(container)).toBe('What type of workout?');
      await tap(container, 'Weight');
      expect(heading(container)).toBe('What would you like to do?');
      await tap(container, 'Plan for Later');
      await tap(container, 'Build Custom');
      expect(dateInput(container)?.value).toBe(toLocalDateStr(new Date()));
    });
  });

  describe('AC4: back navigation stays coherent', () => {
    it('Back from the template picker reaches Track Now / Plan for Later', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Back');
      expect(heading(container)).toBe('What would you like to do?');
    });

    it('Plan for Later again still opens the planner on the linked date', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Back');
      await tap(container, 'Plan for Later');
      await tap(container, 'Build Custom');
      expect(dateInput(container)?.value).toBe('2026-09-24');
    });

    it('Track Now starts tracking with no date from the link', async () => {
      const { container } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Back');
      await tap(container, 'Track Now');
      await tap(container, 'Upper Push A');
      await Promise.resolve();

      expect(startWorkout).toHaveBeenCalledTimes(1);
      const data = startWorkout.mock.calls[0][0] as Record<string, unknown>;
      expect(data).toEqual({ type: 'weight', name: 'Upper Push A', template_id: 'tpl_push' });
      expect(saveWorkoutForLater).not.toHaveBeenCalled();
    });
  });

  describe('AC5: a query-only change starts the flow afresh', () => {
    it('?plan=A → ?plan=B drops the open planner and uses the new date', async () => {
      const { container, rerender } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Upper Push A');
      expect(dateInput(container)?.value).toBe('2026-09-24');

      rerender(<WorkoutFlow planDate="2026-09-25" />);
      await Promise.resolve();
      expect(heading(container)).toBe('Choose a template');

      await tap(container, 'Build Custom');
      expect(dateInput(container)?.value).toBe('2026-09-25');
    });

    it('dropping the query returns to the normal start', async () => {
      const { container, rerender } = render(<WorkoutFlow planDate="2026-09-24" />);
      rerender(<WorkoutFlow />);
      await Promise.resolve();
      expect(heading(container)).toBe('What type of workout?');
    });

    it('the Track Now hand-off to /workout/:id keeps the tracker', async () => {
      const { container, rerender } = render(<WorkoutFlow planDate="2026-09-24" />);
      await tap(container, 'Back');
      await tap(container, 'Track Now');
      await tap(container, 'Build Custom');
      await Promise.resolve();
      expect(container.querySelector('[data-testid="tracker"]')?.textContent).toBe('w_new');

      // The router now renders `<WorkoutFlow workoutId=… />` with no planDate.
      rerender(<WorkoutFlow workoutId="w_new" />);
      await Promise.resolve();
      expect(container.querySelector('[data-testid="tracker"]')?.textContent).toBe('w_new');
    });
  });
});
