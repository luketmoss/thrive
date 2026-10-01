// #237 AC4 — what counts as a swipe.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { h } from 'preact';
import { render, cleanup } from '@testing-library/preact';
import { swipeDirection, useSwipe, isZoomed, type SwipeDirection } from './use-swipe';

describe('swipeDirection', () => {
  it('needs more than 60 px sideways, 1.6× the vertical travel, in under 900 ms', () => {
    expect(swipeDirection(-61, 0, 100)).toBe('left');
    expect(swipeDirection(61, 0, 100)).toBe('right');
    expect(swipeDirection(60, 0, 100)).toBeNull();
    expect(swipeDirection(-80, 50, 100)).toBeNull(); // 80 = 1.6 × 50
    expect(swipeDirection(-81, 50, 100)).toBe('left');
    expect(swipeDirection(-81, -50, 100)).toBe('left');
    expect(swipeDirection(-200, 0, 900)).toBeNull();
    expect(swipeDirection(-200, 0, 899)).toBe('left');
  });
});

// #272 — pinch-zoom: the guard against a pinch read as a swipe, and the zoom check.
type Handlers = ReturnType<typeof useSwipe>;

function mount(onSwipe: (d: SwipeDirection) => void): Handlers {
  let handlers!: Handlers;
  function Probe() {
    handlers = useSwipe({ onSwipe });
    return null;
  }
  render(h(Probe, {}));
  return handlers;
}

function ptr(
  id: number,
  x: number,
  t: number,
  extra: { isPrimary?: boolean; pointerType?: string } = {},
): PointerEvent {
  return {
    pointerId: id,
    clientX: x,
    clientY: 0,
    timeStamp: t,
    pointerType: extra.pointerType ?? 'touch',
    isPrimary: extra.isPrimary ?? true,
    target: document.body,
  } as unknown as PointerEvent;
}

function stubViewport(scale: number) {
  const listeners: Array<() => void> = [];
  const vv = {
    scale,
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.push(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
  return {
    vv,
    resize(next: number) {
      vv.scale = next;
      listeners.slice().forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.click(); // clears a click swallow a counted swipe left behind
  Reflect.deleteProperty(window, 'visualViewport');
  document.documentElement.removeAttribute('data-zoomed');
});

describe('useSwipe at normal zoom (#272 AC2)', () => {
  it('still counts a 100 px sideways touch swipe', () => {
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    hs.onPointerDown(ptr(1, 200, 0));
    hs.onPointerUp(ptr(1, 100, 100));
    expect(onSwipe).toHaveBeenCalledWith('left');
  });

  it('never counts a mouse drag', () => {
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    hs.onPointerDown(ptr(1, 200, 0, { pointerType: 'mouse' }));
    hs.onPointerUp(ptr(1, 100, 100, { pointerType: 'mouse' }));
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe('useSwipe against a pinch (#272 AC3)', () => {
  for (const order of ['primary-first', 'second-first']) {
    it(`abandons the gesture when a second finger goes down (${order} release)`, () => {
      const onSwipe = vi.fn();
      const hs = mount(onSwipe);
      const click = vi.fn();
      window.addEventListener('click', click);
      hs.onPointerDown(ptr(1, 200, 0));
      hs.onPointerDown(ptr(2, 220, 10, { isPrimary: false }));
      if (order === 'primary-first') {
        hs.onPointerUp(ptr(1, 80, 120));
        hs.onPointerUp(ptr(2, 60, 130, { isPrimary: false }));
      } else {
        hs.onPointerUp(ptr(2, 60, 120, { isPrimary: false }));
        hs.onPointerUp(ptr(1, 80, 130));
      }
      expect(onSwipe).not.toHaveBeenCalled();
      // No click swallow was installed: a click still reaches a window listener.
      document.body.click();
      expect(click).toHaveBeenCalledTimes(1);
      window.removeEventListener('click', click);
    });
  }

  it('counts nothing after pointercancel either', () => {
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    hs.onPointerDown(ptr(1, 200, 0));
    hs.onPointerDown(ptr(2, 220, 10, { isPrimary: false }));
    hs.onPointerCancel();
    hs.onPointerUp(ptr(1, 80, 120));
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe('useSwipe when zoomed in (#272 AC4)', () => {
  it('treats a missing visualViewport as not zoomed and sets no attribute', () => {
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    expect(isZoomed()).toBe(false);
    expect(document.documentElement.hasAttribute('data-zoomed')).toBe(false);
    hs.onPointerDown(ptr(1, 200, 0));
    hs.onPointerUp(ptr(1, 100, 100));
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('ignores a qualifying swipe at scale 2 and sets data-zoomed', () => {
    stubViewport(2);
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    expect(document.documentElement.hasAttribute('data-zoomed')).toBe(true);
    hs.onPointerDown(ptr(1, 200, 0));
    hs.onPointerUp(ptr(1, 100, 100));
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('follows visualViewport resize: set when zoomed, removed and swipes back at scale 1', () => {
    const vp = stubViewport(1);
    const onSwipe = vi.fn();
    const hs = mount(onSwipe);
    const root = document.documentElement;
    expect(root.hasAttribute('data-zoomed')).toBe(false);
    vp.resize(2.5);
    expect(root.hasAttribute('data-zoomed')).toBe(true);
    vp.resize(1);
    expect(root.hasAttribute('data-zoomed')).toBe(false);
    hs.onPointerDown(ptr(1, 200, 0));
    hs.onPointerUp(ptr(1, 100, 100));
    expect(onSwipe).toHaveBeenCalledWith('left');
  });

  it('tolerates a sub-pixel scale and removes its listener on unmount', () => {
    const vp = stubViewport(1.005);
    mount(vi.fn());
    expect(isZoomed()).toBe(false);
    expect(document.documentElement.hasAttribute('data-zoomed')).toBe(false);
    expect(vp.vv.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    cleanup();
    expect(vp.vv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
