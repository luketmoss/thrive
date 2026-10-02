// #319 — a modal that owns its focus: moves it in on open, keeps Tab inside,
// closes on Escape, and hands focus back to whatever held it before.
//
// Generalises the trap in `trends/custom-metrics-picker.tsx` (which keeps its
// own copy until #339): disabled controls, textareas and selects are counted
// correctly, and the opener is restored. The opener is read on the first render,
// before any effect has moved focus, and restored when the modal unmounts for
// any reason (Escape, Close, the overlay, or the modal's own commit), but only
// if it is still in the document: a modal torn down by a route change leaves
// focus to the route.

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface Options {
  /** Selector for the control that takes focus on open; else the first focusable. */
  initialFocus?: string;
}

export function useModalFocus(
  dialog: RefObject<HTMLElement>,
  onClose: () => void,
  { initialFocus }: Options = {},
): void {
  const opener = useRef<Element | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = document.activeElement;

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const root = dialog.current;
    if (root && !root.contains(document.activeElement)) {
      const target =
        (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ??
        root.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      const root = dialog.current;
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const to = opener.current;
      if (to instanceof HTMLElement && to.isConnected && to !== document.body) to.focus();
    };
    // Mount and unmount only: the opener and the listener live for the modal's life.
  }, []);
}
