// #237 AC4 — a horizontal swipe, for touch and pen only.
//
// Counts when it moves more than 60 px sideways, sideways travel exceeds 1.6×
// vertical, and it takes under 900 ms. A mouse drag never counts. A swipe that
// starts in a text field is left to it. Vertical scrolling is untouched: the
// element carries `touch-action: pan-y`, so the browser cancels the pointer
// when the user scrolls. The click that ends a counted swipe is swallowed, so
// it does not also activate whatever it started on.

import { useRef } from 'preact/hooks';

export const SWIPE_MIN_PX = 60;
export const SWIPE_RATIO = 1.6;
export const SWIPE_MAX_MS = 900;

export type SwipeDirection = 'left' | 'right';

interface Start {
  id: number;
  x: number;
  y: number;
  t: number;
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function startsInTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_ENTRY) !== null;
}

/** Swallow the one click that a finished swipe would otherwise produce. */
function swallowNextClick(): void {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    window.removeEventListener('click', swallow, true);
    clearTimeout(timer);
  };
  window.addEventListener('click', swallow, true);
  const timer = setTimeout(done, 400);
}

/** The direction a finished gesture counts as, or null. Pure. */
export function swipeDirection(dx: number, dy: number, ms: number): SwipeDirection | null {
  if (Math.abs(dx) <= SWIPE_MIN_PX) return null;
  if (Math.abs(dx) <= SWIPE_RATIO * Math.abs(dy)) return null;
  if (ms >= SWIPE_MAX_MS) return null;
  return dx < 0 ? 'left' : 'right';
}

export interface SwipeOptions {
  onSwipe: (direction: SwipeDirection) => void;
  /** A pointer that starts on a matching element is ignored (a nested swipe area). */
  ignore?: string;
}

/** Pointer handlers to spread on the swipe area. */
export function useSwipe({ onSwipe, ignore }: SwipeOptions) {
  const start = useRef<Start | null>(null);
  const handler = useRef(onSwipe);
  handler.current = onSwipe;

  return {
    onPointerDown(e: PointerEvent) {
      start.current = null;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!e.isPrimary) return;
      if (startsInTextEntry(e.target)) return;
      if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp(e: PointerEvent) {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const direction = swipeDirection(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (!direction) return;
      swallowNextClick();
      handler.current(direction);
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
