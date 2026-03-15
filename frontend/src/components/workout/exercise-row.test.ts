import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { ExerciseRow } from './exercise-row';
import type { TrackerExercise } from './exercise-row';
import type { TrackerSet } from './set-row';
import type { Effort } from '../../api/types';

function makeSet(overrides: Partial<TrackerSet> = {}): TrackerSet {
  return {
    set_number: 1,
    planned_reps: '',
    weight: '',
    reps: '',
    effort: '',
    notes: '',
    saved: false,
    sheetRow: -1,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<TrackerExercise> = {}): TrackerExercise {
  return {
    exercise_id: 'ex1',
    exercise_name: 'Bench Press',
    section: 'primary',
    exercise_order: 1,
    sets: [makeSet()],
    quickFillWeight: '',
    quickFillReps: '',
    quickFillEffort: '',
    ...overrides,
  };
}

const noopStr = (_s: string) => {};
const noopEffort = (_e: Effort | '') => {};
const noop = () => {};

function renderExerciseRow(overrides: Partial<TrackerExercise> = {}, props: Record<string, unknown> = {}) {
  const exercise = makeExercise(overrides);
  return render(
    h(ExerciseRow as any, {
      exercise,
      currentWorkoutId: 'w1',
      onUpdateSet: () => {},
      onAddSet: noop,
      onRemoveSet: () => {},
      onQuickFillWeight: noopStr,
      onQuickFillReps: noopStr,
      onQuickFillEffort: noopEffort,
      onCopyDown: () => {},
      onChangeSection: noopStr,
      onMoveUp: noop,
      onMoveDown: noop,
      onRemoveExercise: noop,
      isFirst: false,
      isLast: false,
      totalExercises: 3,
      ...props,
    }),
  );
}

describe('AC1: Controls row merges section badge and action buttons', () => {
  it('renders a single controls row with section badge and action buttons when totalExercises > 1', () => {
    const { container } = renderExerciseRow({ section: 'primary' }, { totalExercises: 3 });
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    expect(controlsRow).not.toBeNull();
    // Section badge inside controls row
    const badge = controlsRow!.querySelector('.section-badge-btn');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('primary');
    // Action buttons inside controls row
    const buttons = controlsRow!.querySelectorAll('.exercise-toolbar-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(3); // ▲ ▼ ✕
    // History toggle inside controls row
    const historyBtn = controlsRow!.querySelector('.last-time-toggle');
    expect(historyBtn).not.toBeNull();
  });

  it('does not render the old separate exercise-toolbar-row', () => {
    const { container } = renderExerciseRow({ section: 'primary' }, { totalExercises: 3 });
    const oldToolbar = container.querySelector('.exercise-toolbar-row');
    expect(oldToolbar).toBeNull();
  });

  it('renders controls row without move/remove buttons when totalExercises === 1', () => {
    const { container } = renderExerciseRow({ section: 'primary' }, { totalExercises: 1 });
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    expect(controlsRow).not.toBeNull();
    // Section badge present
    const badge = controlsRow!.querySelector('.section-badge-btn');
    expect(badge).not.toBeNull();
    // No move/remove toolbar buttons (history toggle is always present)
    const buttons = controlsRow!.querySelectorAll('.exercise-toolbar-btn:not(.last-time-toggle)');
    expect(buttons.length).toBe(0);
    // History toggle still present
    const historyBtn = controlsRow!.querySelector('.last-time-toggle');
    expect(historyBtn).not.toBeNull();
  });
});

describe('AC2: Action buttons render at 28x28px matching effort button size', () => {
  it('preserves disabled state on move-up when isFirst', () => {
    const { container } = renderExerciseRow({}, { isFirst: true, isLast: false, totalExercises: 3 });
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    // Get non-history toolbar buttons (history toggle also has exercise-toolbar-btn)
    const buttons = controlsRow!.querySelectorAll('.exercise-toolbar-btn:not(.last-time-toggle)');
    // First non-history button is move-up
    const moveUp = buttons[0] as HTMLButtonElement;
    expect(moveUp.disabled).toBe(true);
    expect(moveUp.getAttribute('aria-label')).toContain('Move');
    expect(moveUp.getAttribute('aria-label')).toContain('up');
  });

  it('preserves disabled state on move-down when isLast', () => {
    const { container } = renderExerciseRow({}, { isFirst: false, isLast: true, totalExercises: 3 });
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    // Get non-history toolbar buttons
    const buttons = controlsRow!.querySelectorAll('.exercise-toolbar-btn:not(.last-time-toggle)');
    // Second non-history button is move-down
    const moveDown = buttons[1] as HTMLButtonElement;
    expect(moveDown.disabled).toBe(true);
    expect(moveDown.getAttribute('aria-label')).toContain('Move');
    expect(moveDown.getAttribute('aria-label')).toContain('down');
  });

  it('preserves aria-labels on all action buttons', () => {
    const { container } = renderExerciseRow({ exercise_name: 'Bench Press' }, { totalExercises: 3 });
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    // All toolbar buttons (including history) should have aria-labels
    const buttons = controlsRow!.querySelectorAll('.exercise-toolbar-btn');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
    // Remove button
    const removeBtn = controlsRow!.querySelector('.exercise-toolbar-remove');
    expect(removeBtn!.getAttribute('aria-label')).toContain('Remove');
    expect(removeBtn!.getAttribute('aria-label')).toContain('Bench Press');
  });
});

describe('AC3: Exercise name occupies its own full-width row', () => {
  it('renders exercise name in a dedicated name row below controls', () => {
    const { container } = renderExerciseRow({ exercise_name: 'Bench Press', section: 'primary' });
    const nameRow = container.querySelector('.tracker-exercise-name-row');
    expect(nameRow).not.toBeNull();
    expect(nameRow!.textContent).toContain('Bench Press');
  });

  it('name row appears after controls row in DOM order', () => {
    const { container } = renderExerciseRow({ section: 'primary' });
    const card = container.firstElementChild!;
    const children = Array.from(card.children);
    const controlsIdx = children.findIndex((el) => el.classList.contains('tracker-exercise-controls'));
    const nameIdx = children.findIndex((el) => el.classList.contains('tracker-exercise-name-row'));
    expect(controlsIdx).toBeGreaterThanOrEqual(0);
    expect(nameIdx).toBeGreaterThan(controlsIdx);
  });
});

describe('AC4: Quick fill section uses border-top divider instead of text label', () => {
  it('does not render the quick-fill-heading text', () => {
    const { container } = renderExerciseRow({ section: 'primary' });
    const heading = container.querySelector('.quick-fill-heading');
    expect(heading).toBeNull();
  });

  it('still renders the quick-fill-row with inputs', () => {
    const { container } = renderExerciseRow({ section: 'primary' });
    const row = container.querySelector('.quick-fill-row');
    expect(row).not.toBeNull();
    // Weight and reps inputs
    const weightInput = row!.querySelector('.set-weight-input');
    const repsInput = row!.querySelector('.set-reps-input');
    expect(weightInput).not.toBeNull();
    expect(repsInput).not.toBeNull();
    // Effort buttons
    const effortBtns = row!.querySelectorAll('.effort-btn');
    expect(effortBtns.length).toBe(3);
  });
});

describe('AC5: Warmup cards are unaffected', () => {
  it('warmup cards do not use the new controls row layout', () => {
    const { container } = renderExerciseRow({ section: 'warmup' }, { totalExercises: 3 });
    // Warmup cards should NOT have the new controls row
    const controlsRow = container.querySelector('.tracker-exercise-controls');
    expect(controlsRow).toBeNull();
    // Should still have the old header
    const header = container.querySelector('.tracker-exercise-header');
    expect(header).not.toBeNull();
    // Should still have toolbar row below header
    const toolbar = container.querySelector('.exercise-toolbar-row');
    expect(toolbar).not.toBeNull();
  });

  it('warmup cards do not render quick fill section', () => {
    const { container } = renderExerciseRow({ section: 'warmup' });
    const quickFill = container.querySelector('.quick-fill-row');
    expect(quickFill).toBeNull();
  });
});
