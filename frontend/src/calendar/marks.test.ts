// #241 AC2 — the one mark rule, shared by the week strip and the Calendar.
import { describe, it, expect } from 'vitest';
import type { WorkoutWithRow } from '../api/types';
import { MAX_MARKS, markKinds, marksFor } from './marks';
import * as strip from '../components/day/week-strip';

const wk = (date: string, status = '') => ({ id: date + status, date, status }) as WorkoutWithRow;

describe('marksFor', () => {
  it('counts planned and everything else, for the dates asked only', () => {
    const m = marksFor(['2025-01-14', '2025-01-15'], [
      wk('2025-01-14'), wk('2025-01-14', 'active'), wk('2025-01-14', 'planned'), wk('2025-01-16'),
    ]);
    expect(m).toEqual({ '2025-01-14': { done: 2, planned: 1 }, '2025-01-15': { done: 0, planned: 0 } });
  });
});

describe('markKinds', () => {
  it('draws dots, then rings, three at most', () => {
    expect(markKinds({ done: 1, planned: 1 })).toEqual(['dot', 'ring']);
    expect(markKinds({ done: 2, planned: 5 })).toEqual(['dot', 'dot', 'ring']);
    expect(markKinds({ done: 0, planned: 0 })).toEqual([]);
    expect(MAX_MARKS).toBe(3);
  });
});

describe('the week strip', () => {
  it('uses this module, not a copy', () => {
    expect(strip.marksFor).toBe(marksFor);
    expect(strip.markKinds).toBe(markKinds);
  });
});
