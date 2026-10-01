// #237 AC4 — a horizontal swipe, for touch and pen only.
//
// Counts when it moves more than 60 px sideways, sideways travel exceeds 1.6×
// vertical, and it takes under 900 ms. A mouse drag never counts. A swipe that
// starts in a text field is left to it. Vertical scrolling is untouched: the
// element carries `touch-action: pan-y pinch-zoom`, so the browser cancels the
// pointer when the user scrolls, and a pinch still zooms (#272). The click that
// ends a counted swipe is swallowed, so it does not also activate whatever it
// started on.
//
// #272: a second finger down is a pinch, never half a swipe: it abandons the
// gesture, and nothing is counted or swallowed when the fingers lift. While the
// page is zoomed in (visualViewport.scale above 1) a one-finger drag is a pan,
// so no swipe counts, and `data-zoomed` on the root switches the swipe surfaces
// to `touch-action: manipulation` so the browser can pan them sideways. Where
// visualViewport is missing the page is treated as not zoomed.

import { useEffect, useRef } from 'preact/hooks';

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

/** Scale above this is zoomed in; the slack absorbs sub-pixel float scale. */
const ZOOM_EPSILON = 1.01;

/** Is the page pinch-zoomed in? False where visualViewport is missing. */
export function isZoomed(): boolean {
  const scale = window.visualViewport?.scale ?? 1;
  return scale > ZOOM_EPSILON;
}

function syncZoomAttribute(): void {
  const root = document.documentElement;
  if (isZoomed()) root.setAttribute('data-zoomed', '');
  else root.removeAttribute('data-zoomed');
}

/** Keep `data-zoomed` on the root in step with the visual viewport. Returns cleanup. */
export function watchZoom(): () => void {
  const vv = window.visualViewport;
  syncZoomAttribute();
  if (!vv) return () => {};
  vv.addEventListener('resize', syncZoomAttribute);
  return () => vv.removeEventListener('resize', syncZoomAttribute);
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

  useEffect(() => watchZoom(), []);

  return {
    onPointerDown(e: PointerEvent) {
      // Any pointer down first abandons the pending gesture: a second finger
      // (a pinch) must never leave the first one's start behind.
      start.current = null;
      if (isZoomed()) return;
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
      if (isZoomed()) return;
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
