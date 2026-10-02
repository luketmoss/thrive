// #290 — keep focus off `body` when a control that held it goes away.
//
// `PanelStatus` (#276) does this inline for the Day panels; this is the same
// rule as a hook, for the two places that sit outside `PanelStatus`: the Day
// Note's save retry and Trends' load retry. `PanelStatus` may adopt it later
// with no change in behaviour.
//
// The rule: when the element behind `ref` unmounts while it holds focus, find
// the target (while the DOM is still intact), then focus it in a microtask,
// after Preact's commit, but only if focus is then on `body` and the target is
// still in the document. It never acts on mount, never for an element that did
// not hold focus, and never over a focus the user has moved since.

import { useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

export function useFocusHandoff(
  ref: RefObject<HTMLElement>,
  /** Where focus goes, looked up from the unmounting element before it leaves. */
  target: (from: HTMLElement) => HTMLElement | null | undefined,
  /** Called on the target just before it is focused (a no-ring marker, say). */
  beforeFocus?: (to: HTMLElement) => void,
): void {
  const targetRef = useRef(target);
  targetRef.current = target;
  const beforeRef = useRef(beforeFocus);
  beforeRef.current = beforeFocus;
  useLayoutEffect(() => () => {
    const node = ref.current;
    if (!node || document.activeElement !== node) return;
    const to = targetRef.current(node);
    if (!to) return;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!to.isConnected || (active !== document.body && active != null)) return;
      beforeRef.current?.(to);
      to.focus();
    });
  }, []);
}
