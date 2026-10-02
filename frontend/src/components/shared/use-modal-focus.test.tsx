// #319 AC4 — useModalFocus: focus in, Tab trap (skipping disabled controls),
// Escape, and focus back to the opener on unmount.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useModalFocus } from './use-modal-focus';

afterEach(cleanup);

function Modal({ onClose, initialFocus }: { onClose: () => void; initialFocus?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose, { initialFocus });
  return h('div', { ref, role: 'dialog' }, [
    h('button', { id: 'first' }, 'First'),
    h('input', { id: 'search' }),
    h('textarea', { id: 'notes' }),
    h('select', { id: 'pick' }, h('option', {}, 'a')),
    h('button', { id: 'last' }, 'Last'),
    h('button', { id: 'off', disabled: true }, 'Disabled'),
  ]);
}

function Host({ onClose = () => {}, initialFocus }: { onClose?: () => void; initialFocus?: string }) {
  const [open, setOpen] = useState(false);
  return h('div', {}, [
    h('button', { id: 'opener', onClick: () => setOpen(true) }, 'Open'),
    h('button', { id: 'behind' }, 'Behind'),
    open &&
      h(Modal, {
        initialFocus,
        onClose: () => {
          onClose();
          setOpen(false);
        },
      }),
  ]);
}

const $ = (id: string) => document.getElementById(id)!;

function open(props: Parameters<typeof Host>[0] = {}) {
  const r = render(h(Host, props));
  $('opener').focus();
  fireEvent.click($('opener'));
  return r;
}

describe('useModalFocus', () => {
  it('moves focus to the first focusable control on open', () => {
    open();
    expect(document.activeElement).toBe($('first'));
  });

  it('moves focus to the initialFocus selector when given', () => {
    open({ initialFocus: '#search' });
    expect(document.activeElement).toBe($('search'));
  });

  it('wraps Tab from the last enabled control to the first, skipping disabled ones', () => {
    open();
    $('last').focus();
    const e = fireEvent.keyDown(document, { key: 'Tab' });
    expect(e).toBe(false); // default prevented
    expect(document.activeElement).toBe($('first'));
  });

  it('wraps Shift+Tab from the first control to the last enabled one', () => {
    open();
    $('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe($('last'));
  });

  it('leaves Tab between inner controls (textarea, select) to the browser', () => {
    open();
    $('notes').focus();
    const e = fireEvent.keyDown(document, { key: 'Tab' });
    expect(e).toBe(true);
    expect(document.activeElement).toBe($('notes'));
  });

  it('pulls focus back in when it has escaped behind the overlay', () => {
    open();
    $('behind').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe($('first'));
  });

  it('calls onClose on Escape and returns focus to the opener', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe($('opener'));
  });

  it('stops listening once closed', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not restore focus to an opener that has left the document', () => {
    function Gone() {
      const [opener, setOpener] = useState(true);
      const [modal, setModal] = useState(false);
      return h('div', {}, [
        opener && h('button', { id: 'opener', onClick: () => setModal(true) }, 'Open'),
        h('button', { id: 'other' }, 'Other'),
        modal &&
          h(Modal, {
            onClose: () => {
              setOpener(false);
              setModal(false);
            },
          }),
      ]);
    }
    render(h(Gone, {}));
    $('opener').focus();
    fireEvent.click($('opener'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('opener')).toBeNull();
    expect(document.activeElement).not.toBe($('other'));
  });
});
