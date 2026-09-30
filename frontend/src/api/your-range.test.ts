// #242 AC3 — yourRange: the 30 days before D, never D, ≥ 14 values.

import { describe, it, expect } from 'vitest';
import { yourRange } from './your-range';

const D = '2026-09-27';

/** Dates D−1, D−2, … D−k. */
function daysBefore(k: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= k; i++) {
    out.push(new Date(Date.parse(`${D}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function mapOf(dates: string[], value: (i: number) => number): Map<string, number> {
  return new Map(dates.map((d, i) => [d, value(i)]));
}

describe('yourRange', () => {
  it('returns null with exactly 13 values', () => {
    expect(yourRange(mapOf(daysBefore(13), () => 50), D)).toBeNull();
  });

  it('returns a range with exactly 14 values', () => {
    const r = yourRange(mapOf(daysBefore(14), (i) => (i % 2 ? 48 : 52)), D);
    expect(r).not.toBeNull();
    expect(r!.n).toBe(14);
    expect(r!.mean).toBe(50);
    expect(r!.sd).toBe(2); // population SD
    expect(r!.lo).toBe(48);
    expect(r!.hi).toBe(52);
  });

  it('names its window: D − 30 … D − 1', () => {
    const r = yourRange(mapOf(daysBefore(30), () => 50), D)!;
    expect(r.from).toBe('2026-08-28');
    expect(r.to).toBe('2026-09-26');
    expect(r.n).toBe(30);
  });

  it('ignores a value on D itself, and anything older than D − 30', () => {
    const values = mapOf(daysBefore(14), () => 50);
    values.set(D, 1000);
    values.set('2026-08-27', 1000); // D − 31
    const r = yourRange(values, D)!;
    expect(r.n).toBe(14);
    expect(r.mean).toBe(50);
  });

  it('counts a 0 as a value', () => {
    const values = mapOf(daysBefore(13), () => 10);
    values.set(daysBefore(14)[13], 0);
    const r = yourRange(values, D)!;
    expect(r).not.toBeNull();
    expect(r.n).toBe(14);
    expect(r.mean).toBeCloseTo(130 / 14);
  });

  it('gives sd 0 when every value is equal', () => {
    const r = yourRange(mapOf(daysBefore(20), () => 55), D)!;
    expect(r.sd).toBe(0);
    expect(r.lo).toBe(55);
    expect(r.hi).toBe(55);
  });

  it('skips gaps inside the window', () => {
    // Every other day of the 30: 15 values.
    const dates = daysBefore(30).filter((_, i) => i % 2 === 0);
    const r = yourRange(mapOf(dates, (i) => 40 + i), D)!;
    expect(r.n).toBe(15);
    expect(r.mean).toBe(47);
    // Remove one more: 14 still a range; 13 is not.
    const fewer = new Map([...mapOf(dates, () => 1)].slice(0, 13));
    expect(yourRange(fewer, D)).toBeNull();
  });
});
