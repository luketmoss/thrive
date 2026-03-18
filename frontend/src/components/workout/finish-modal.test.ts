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
