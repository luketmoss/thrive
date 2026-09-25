import { describe, it, expect } from 'vitest';
import { secondsToMinutes, minutesToSeconds, secondsToMinutesInput, formatDuration, estimateMinutesToSeconds, formatEstimate } from './duration';

// Issue #101 — Workouts!H stores elapsed seconds; the UI reads and writes
// whole minutes. These are the only two places that conversion happens.
describe('secondsToMinutes', () => {
  // AC3: the exact example from the acceptance criteria.
  it('reads a migrated 62-minute workout back as 62', () => {
    expect(secondsToMinutes('3720')).toBe(62);
  });

  it('returns null for an unset duration rather than 0', () => {
    expect(secondsToMinutes('')).toBeNull();
  });

  it('returns null for a non-numeric value rather than 0', () => {
    expect(secondsToMinutes('abc')).toBeNull();
  });

  it('distinguishes a genuine zero from an absent value', () => {
    expect(secondsToMinutes('0')).toBe(0);
    expect(secondsToMinutes('')).toBeNull();
  });

  it('rounds to the nearest minute', () => {
    expect(secondsToMinutes('3744')).toBe(62); // 62.4
    expect(secondsToMinutes('3750')).toBe(63); // 62.5
  });
});

describe('minutesToSeconds', () => {
  it('stores 45 typed minutes as 2700 seconds', () => {
    expect(minutesToSeconds('45')).toBe('2700');
  });

  it('leaves an empty entry empty rather than writing 0', () => {
    expect(minutesToSeconds('')).toBe('');
    expect(minutesToSeconds('   ')).toBe('');
  });

  it('leaves a non-numeric entry empty rather than writing 0', () => {
    expect(minutesToSeconds('abc')).toBe('');
  });
});

describe('round-trip', () => {
  // AC3: exact because entry granularity is whole minutes.
  it('is exact for every whole-minute value a user can type', () => {
    for (const mins of [0, 1, 15, 20, 30, 45, 58, 62, 90, 180, 600]) {
      expect(secondsToMinutes(minutesToSeconds(String(mins)))).toBe(mins);
    }
  });

  it('keeps an unset duration unset through a full round-trip', () => {
    expect(secondsToMinutes(minutesToSeconds(''))).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders the stored seconds as minutes', () => {
    expect(formatDuration('3720')).toBe('62 min');
  });

  it('renders nothing when there is no duration', () => {
    expect(formatDuration('')).toBe('');
  });
});

describe('secondsToMinutesInput', () => {
  it('gives a minutes field its starting value', () => {
    expect(secondsToMinutesInput('3720')).toBe('62');
  });

  it('gives an empty field for an unset duration', () => {
    expect(secondsToMinutesInput('')).toBe('');
  });

  // Guards the literal string "null" reaching an input from a garbled cell.
  it('gives an empty field for a non-numeric cell, never the text "null"', () => {
    expect(secondsToMinutesInput('abc')).toBe('');
  });
});

// #145: a planned workout's estimate. Same boundary, stricter about zero.
describe('estimateMinutesToSeconds', () => {
  it('converts whole minutes to seconds', () => {
    expect(estimateMinutesToSeconds('47')).toBe('2820');
    expect(estimateMinutesToSeconds('1')).toBe('60');
  });

  it.each(['', '  ', '0', '-5', 'abc'])('treats %j as no estimate, never 0', (typed) => {
    expect(estimateMinutesToSeconds(typed)).toBe('');
  });
});

describe('formatEstimate', () => {
  it('reads "about 47 min", and spells it out when spoken', () => {
    expect(formatEstimate('2820')).toBe('about 47 min');
    expect(formatEstimate('2820', true)).toBe('about 47 minutes');
    expect(formatEstimate('60', true)).toBe('about 1 minute');
  });

  it.each(['', '0', 'garbled'])('shows nothing for %j', (stored) => {
    expect(formatEstimate(stored)).toBe('');
  });
});
