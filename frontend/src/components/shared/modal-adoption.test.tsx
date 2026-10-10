// #339: ConfirmModal, FinishWorkoutModal and
// CustomMetricsPicker all run on useModalFocus: focus in, Tab trap, Escape,
// focus back to the opener, busy guard, labelled dialog.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { ConfirmModal } from './confirm-modal';
import { FinishWorkoutModal } from '../workout/finish-modal';
import { CustomMetricsPicker } from '../trends/custom-metrics-picker';

afterEach(cleanup);

const dialogOf = () => document.querySelector('[role="dialog"]') as HTMLElement;

/** An opener button plus a modal it toggles; `renderModal` gets the close handler. */
function harness(renderModal: (close: () => void) => any) {
  function Host() {
    const [open, setOpen] = useState(false);
    return h('div', {}, [
      h('button', { id: 'opener', onClick: () => setOpen(true) }, 'Open'),
      open && renderModal(() => setOpen(false)),
    ]);
  }
  render(h(Host, {}));
  const opener = document.getElementById('opener')!;
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function expectLabelled() {
  const d = dialogOf();
  expect(d.getAttribute('aria-modal')).toBe('true');
  const id = d.getAttribute('aria-labelledby')!;
  expect(id).toBeTruthy();
  expect(document.getElementById(id)?.tagName).toBe('H2');
}

describe('ConfirmModal', () => {
  const modal = (close: () => void, extra = {}) =>
    h(ConfirmModal as any, { title: 'Delete Label', message: 'Sure?', onConfirm: close, onCancel: close, ...extra });

  it('focuses Cancel, traps Tab, closes on Escape and returns focus', () => {
    const opener = harness((c) => modal(c));
    const buttons = dialogOf().querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0].textContent).toBe('Cancel');
    buttons[1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialogOf()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('is a labelled dialog and its heading id is unique per instance', () => {
    render(h('div', {}, [modal(() => {}), modal(() => {})]));
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    expect(dialogs).toHaveLength(2);
    const ids = dialogs.map((d) => d.getAttribute('aria-labelledby')!);
    expect(ids[0]).not.toBe(ids[1]);
    for (const d of dialogs) {
      expect(d.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete Label');
    }
  });

  it('closes on the backdrop', () => {
    const onCancel = vi.fn();
    render(modal(() => {}, { onCancel }));
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('FinishWorkoutModal', () => {
  const props = (over = {}) => ({
    notes: '', onNotesChange: () => {}, effort: '', onEffortChange: () => {},
    onFinish: () => {}, onCancel: () => {}, finishing: false, ...over,
  });

  it('focuses the notes textarea, is labelled, and returns focus on Escape', () => {
    const opener = harness((c) => h(FinishWorkoutModal as any, props({ onCancel: c })));
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expectLabelled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('ignores Escape and the backdrop while finishing, and closes again after', () => {
    const onCancel = vi.fn();
    const r = render(h(FinishWorkoutModal as any, props({ onCancel, finishing: true })));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onCancel).not.toHaveBeenCalled();
    r.rerender(h(FinishWorkoutModal as any, props({ onCancel, finishing: false })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not close on an IME Escape in the notes textarea', () => {
    const onCancel = vi.fn();
    render(h(FinishWorkoutModal as any, props({ onCancel })));
    fireEvent.keyDown(document.querySelector('textarea')!, { key: 'Escape', isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('CustomMetricsPicker', () => {
  it('focuses the first checkbox, is labelled, closes on Escape and returns focus', () => {
    const opener = harness((c) => h(CustomMetricsPicker as any, { selected: [], onChange: () => {}, onClose: c }));
    expect(document.activeElement?.getAttribute('type')).toBe('checkbox');
    expectLabelled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('keeps aria-disabled rows in the tab order at the cap', () => {
    render(h(CustomMetricsPicker as any, {
      selected: ['resting_hr', 'steps', 'hrv', 'distance'], onChange: () => {}, onClose: () => {},
    }));
    const boxes = [...dialogOf().querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.some((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    const done = dialogOf().querySelector<HTMLElement>('.trends-picker-done')!;
    done.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(boxes[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });
});
