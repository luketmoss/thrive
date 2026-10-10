import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { FinishWorkoutModal } from './finish-modal';

describe('FinishWorkoutModal', () => {
  let onNotesChange: ReturnType<typeof vi.fn>;
  let onFinish: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onNotesChange = vi.fn();
    onFinish = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function renderModal(overrides: Record<string, unknown> = {}) {
    const props = {
      notes: '',
      onNotesChange,
      effort: '',
      onEffortChange: vi.fn(),
      onFinish,
      onCancel,
      finishing: false,
      ...overrides,
    };
    return render(h(FinishWorkoutModal as any, props));
  }

  // AC1: Accessible modal overlay appears on finish
  describe('AC1: Accessible modal overlay', () => {
    it('renders with role="dialog" and aria-modal="true"', () => {
      const { container } = renderModal();
      const dialog = container.querySelector('[role="dialog"]')!;
      expect(dialog).toBeTruthy();
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('has aria-labelledby pointing to the heading', () => {
      const { container } = renderModal();
      const dialog = container.querySelector('[role="dialog"]')!;
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = container.querySelector(`#${labelledBy}`)!;
      expect(heading).toBeTruthy();
      expect(heading.textContent).toBe('Finish Workout');
    });

    it('uses modal-overlay class for fixed positioning', () => {
      const { container } = renderModal();
      const overlay = container.querySelector('.modal-overlay');
      expect(overlay).toBeTruthy();
    });

    it('auto-focuses the textarea on mount', () => {
      const { container } = renderModal();
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeTruthy();
      expect(document.activeElement).toBe(textarea);
    });
  });

  // AC2: Modal contains notes and correctly-ordered actions
  describe('AC2: Modal contents and button order', () => {
    it('contains a "Finish Workout" heading', () => {
      const { container } = renderModal();
      const heading = container.querySelector('h2');
      expect(heading).toBeTruthy();
      expect(heading!.textContent).toBe('Finish Workout');
    });

    it('contains a notes textarea with correct placeholder', () => {
      const { container } = renderModal();
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeTruthy();
      expect(textarea!.getAttribute('placeholder')).toBe('How did it go?');
    });

    it('contains "Workout Notes (optional)" label', () => {
      const { container } = renderModal();
      const label = container.querySelector('.form-label');
      expect(label).toBeTruthy();
      expect(label!.textContent).toBe('Workout Notes (optional)');
    });

    it('has "Save & Finish" button before "Cancel" button', () => {
      const { container } = renderModal();
      const buttons = container.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map((b) => b.textContent?.trim());
      const saveIdx = buttonTexts.indexOf('Save & Finish');
      const cancelIdx = buttonTexts.indexOf('Cancel');
      expect(saveIdx).toBeGreaterThanOrEqual(0);
      expect(cancelIdx).toBeGreaterThanOrEqual(0);
      expect(saveIdx).toBeLessThan(cancelIdx);
    });

    it('"Save & Finish" is a primary button', () => {
      const { container } = renderModal();
      const buttons = Array.from(container.querySelectorAll('button'));
      const saveBtn = buttons.find((b) => b.textContent?.trim() === 'Save & Finish');
      expect(saveBtn).toBeTruthy();
      expect(saveBtn!.classList.contains('btn-primary')).toBe(true);
    });

    it('"Cancel" is a secondary button', () => {
      const { container } = renderModal();
      const buttons = Array.from(container.querySelectorAll('button'));
      const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Cancel');
      expect(cancelBtn).toBeTruthy();
      expect(cancelBtn!.classList.contains('btn-secondary')).toBe(true);
    });
  });

  // AC3: Backdrop click and Escape close the modal (unless saving)
  describe('AC3: Dismiss behavior', () => {
    it('calls onCancel when backdrop is clicked', () => {
      const { container } = renderModal();
      const overlay = container.querySelector('.modal-overlay')!;
      fireEvent.click(overlay);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel when modal content is clicked', () => {
      const { container } = renderModal();
      const content = container.querySelector('.modal-content')!;
      fireEvent.click(content);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('calls onCancel when Escape is pressed', () => {
      renderModal();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onCancel on backdrop click while finishing', () => {
      const { container } = renderModal({ finishing: true });
      const overlay = container.querySelector('.modal-overlay')!;
      fireEvent.click(overlay);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('does NOT call onCancel on Escape while finishing', () => {
      renderModal({ finishing: true });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables Cancel button while finishing', () => {
      const { container } = renderModal({ finishing: true });
      const buttons = Array.from(container.querySelectorAll('button'));
      const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Cancel');
      expect(cancelBtn).toBeTruthy();
      expect(cancelBtn!.hasAttribute('disabled')).toBe(true);
    });
  });

  // AC4: Save & Finish works from modal
  describe('AC4: Save & Finish', () => {
    it('calls onFinish when "Save & Finish" is clicked', () => {
      const { container } = renderModal();
      const buttons = Array.from(container.querySelectorAll('button'));
      const saveBtn = buttons.find((b) => b.textContent?.trim() === 'Save & Finish')!;
      fireEvent.click(saveBtn);
      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('shows "Saving..." text while finishing', () => {
      const { container } = renderModal({ finishing: true });
      const buttons = Array.from(container.querySelectorAll('button'));
      const savingBtn = buttons.find((b) => b.textContent?.trim() === 'Saving...');
      expect(savingBtn).toBeTruthy();
    });

    it('disables "Save & Finish" button while finishing', () => {
      const { container } = renderModal({ finishing: true });
      const buttons = Array.from(container.querySelectorAll('button'));
      const savingBtn = buttons.find((b) => b.textContent?.trim() === 'Saving...');
      expect(savingBtn).toBeTruthy();
      expect(savingBtn!.hasAttribute('disabled')).toBe(true);
    });

    it('passes notes value to textarea', () => {
      const { container } = renderModal({ notes: 'Great session!' });
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Great session!');
    });

    it('calls onNotesChange when textarea changes', () => {
      const { container } = renderModal();
      const textarea = container.querySelector('textarea')!;
      fireEvent.input(textarea, { target: { value: 'New notes' } });
      expect(onNotesChange).toHaveBeenCalled();
    });
  });
});

// Issue #102 — session effort in the finish modal.
describe('FinishWorkoutModal — session effort (#102)', () => {
  let onEffortChange: ReturnType<typeof vi.fn>;

  beforeEach(() => { onEffortChange = vi.fn(); });
  afterEach(cleanup);

  function renderWithEffort(overrides: Record<string, unknown> = {}) {
    return render(h(FinishWorkoutModal as any, {
      notes: '', onNotesChange: vi.fn(), effort: '', onEffortChange,
      onFinish: vi.fn(), onCancel: vi.fn(), finishing: false, ...overrides,
    }));
  }

  // AC1: nothing pre-selected, and saving untouched leaves it empty.
  it('offers the control with nothing pre-selected', () => {
    const { container } = renderWithEffort();
    const group = container.querySelector('[role="group"]')!;
    expect(group).toBeTruthy();
    expect(group.querySelector('.active')).toBeNull();
  });

  // AC1: the control must sit BELOW the notes textarea so the existing
  // auto-focus still lands on the first field and Tab order follows reading
  // order.
  it('places the effort control after the notes textarea in DOM order', () => {
    const { container } = renderWithEffort();
    const textarea = container.querySelector('textarea')!;
    const group = container.querySelector('[role="group"]')!;
    expect(textarea.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still auto-focuses the notes textarea, not an effort button', () => {
    const { container } = renderWithEffort();
    expect(document.activeElement).toBe(container.querySelector('textarea'));
  });

  it('reports the chosen effort upward', () => {
    const { container } = renderWithEffort();
    const hard = [...container.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Hard')!;
    fireEvent.click(hard);
    expect(onEffortChange).toHaveBeenCalledWith('Hard');
  });

  // AC2: unset stays reachable from inside the modal.
  it('clears back to unset when the selected value is tapped again', () => {
    const { container } = renderWithEffort({ effort: 'Hard' });
    const hard = [...container.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Hard')!;
    fireEvent.click(hard);
    expect(onEffortChange).toHaveBeenCalledWith('');
  });

  it('does not block saving when effort is unset', () => {
    const onFinish = vi.fn();
    const { container } = renderWithEffort({ onFinish });
    const save = [...container.querySelectorAll('button')].find((b) => /Save & Finish/.test(b.textContent!))!;
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(onFinish).toHaveBeenCalled();
  });
});

// #372: visible labels name the controls.
describe('FinishWorkoutModal accessible names (#372)', () => {
  afterEach(cleanup);
  const mk = (extra: Record<string, unknown> = {}) =>
    render(h(FinishWorkoutModal as any, {
      notes: '', onNotesChange: vi.fn(), effort: '', onEffortChange: vi.fn(),
      onFinish: vi.fn(), onCancel: vi.fn(), finishing: false, ...extra,
    }));

  it('names the notes textarea by its visible label, not the placeholder', () => {
    const { getByRole } = mk();
    const box = getByRole('textbox', { name: 'Workout Notes (optional)' });
    expect(box.getAttribute('placeholder')).toBe('How did it go?');
  });

  it('names the effort group by its visible label', () => {
    const { getByRole, container } = mk();
    const group = getByRole('group', { name: 'Session Effort (optional)' });
    expect(group.hasAttribute('aria-label')).toBe(false);
    expect(container.querySelector('label.form-label[for]')?.textContent).toBe('Workout Notes (optional)');
    expect([...container.querySelectorAll('label')].some((l) => /Session Effort/.test(l.textContent!))).toBe(false);
  });

  it('keeps the effort button names and pressed state', () => {
    const { getByRole } = mk({ effort: 'Hard' });
    expect(getByRole('button', { name: 'Session effort: Hard' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: 'Session effort: Easy' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('generates distinct ids for two instances in one tree', () => {
    const props = { notes: '', onNotesChange: vi.fn(), effort: '', onEffortChange: vi.fn(), onFinish: vi.fn(), onCancel: vi.fn(), finishing: false };
    const { container } = render(h('div', null, h(FinishWorkoutModal as any, props), h(FinishWorkoutModal as any, props)));
    const ids = [...container.querySelectorAll('textarea')].map((t) => t.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });
});
