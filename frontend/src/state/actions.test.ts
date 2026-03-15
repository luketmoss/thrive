import { describe, it, expect } from 'vitest';
import { parseSetCount } from './actions';

describe('parseSetCount', () => {
  it('returns the upper bound of a range like "4-5"', () => {
    expect(parseSetCount('4-5')).toBe(5);
  });

  it('returns the upper bound of a range like "2-3"', () => {
    expect(parseSetCount('2-3')).toBe(3);
  });

  it('returns a single number as-is', () => {
    expect(parseSetCount('3')).toBe(3);
  });

  it('returns 1 for the string "1"', () => {
    expect(parseSetCount('1')).toBe(1);
  });

  it('returns default 3 for empty string', () => {
    expect(parseSetCount('')).toBe(3);
  });

  it('returns default 3 for whitespace-only string', () => {
    expect(parseSetCount('   ')).toBe(3);
  });

  it('handles range with spaces around dash', () => {
    expect(parseSetCount(' 4 - 6 ')).toBe(6);
  });

  it('returns default 3 for non-numeric input', () => {
    expect(parseSetCount('abc')).toBe(3);
  });

  it('returns the max of a three-part range (edge case)', () => {
    // "2-4-6" is unusual but the function should take the max
    expect(parseSetCount('2-4-6')).toBe(6);
  });

  it('handles single large number', () => {
    expect(parseSetCount('10')).toBe(10);
  });
});
