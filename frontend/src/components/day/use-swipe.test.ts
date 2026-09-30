// #237 AC4 — what counts as a swipe.
import { describe, it, expect } from 'vitest';
import { swipeDirection } from './use-swipe';

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
