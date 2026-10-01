import { describe, it, expect } from 'vitest';
import {
  milesToMeters, metersToMiles, feetToMeters, metersToFeet,
  metersToMilesInput, metersToFeetInput, bpmToStored,
  formatDistance, formatElevation, formatHeartRate, kgToLb, formatWeight,
} from './units';

// Issue #103 — entered in miles and feet, stored as integer meters.
describe('distance', () => {
  // AC2: the exact example from the acceptance criteria.
  it('stores 12.4 miles as 19956 meters', () => {
    expect(milesToMeters('12.4')).toBe('19956');
  });

  it('reads 19956 meters back as exactly 12.4', () => {
    expect(metersToMiles('19956')).toBe(12.4);
  });

  // AC2: idempotence — a record must not drift across repeated edits.
  it('round-trips every one-decimal value a user can type', () => {
    for (const mi of ['0.1', '1.0', '3.7', '12.4', '26.2', '100.5']) {
      const stored = milesToMeters(mi);
      expect(metersToMiles(stored)).toBe(Number(mi));
      // Saving the displayed value again must produce the same storage.
      expect(milesToMeters(String(metersToMiles(stored)))).toBe(stored);
    }
  });
});

describe('elevation', () => {
  // AC2: normalised to the nearest 10 feet on entry.
  it('stores 1500 feet as 457 meters', () => {
    expect(feetToMeters('1500')).toBe('457');
  });

  it('reads 457 meters back as 1500 feet', () => {
    expect(metersToFeet('457')).toBe(1500);
  });

  it('normalises a value typed off the 10-foot step', () => {
    // 1495 rounds to 1500 and thereafter displays as 1500 — the reason the
    // form tells the user about this precision rather than applying it silently.
    expect(feetToMeters('1495')).toBe(feetToMeters('1500'));
    expect(metersToFeet(feetToMeters('1495'))).toBe(1500);
  });

  it('is idempotent across repeated edits', () => {
    for (const ft of ['0', '10', '340', '1500', '1495', '5461', '12000']) {
      const once = feetToMeters(ft);
      const displayed = String(metersToFeet(once));
      expect(feetToMeters(displayed)).toBe(once);
    }
  });
});

// AC3: empty means empty, and a deliberate 0 is not empty.
describe('empty is never zero', () => {
  it('leaves an unfilled distance empty rather than storing 0', () => {
    expect(milesToMeters('')).toBe('');
    expect(milesToMeters('   ')).toBe('');
  });

  it('leaves an unfilled elevation empty rather than storing 0', () => {
    expect(feetToMeters('')).toBe('');
  });

  it('leaves an unfilled heart rate empty rather than storing 0', () => {
    expect(bpmToStored('')).toBe('');
  });

  it('stores a deliberately typed 0 as 0, distinct from empty', () => {
    expect(milesToMeters('0')).toBe('0');
    expect(feetToMeters('0')).toBe('0');
    expect(bpmToStored('0')).toBe('0');
  });

  it('reads an empty stored value back as null, not 0', () => {
    expect(metersToMiles('')).toBeNull();
    expect(metersToFeet('')).toBeNull();
  });

  it('reads a stored 0 back as 0, not null', () => {
    expect(metersToMiles('0')).toBe(0);
    expect(metersToFeet('0')).toBe(0);
  });

  it('treats a non-numeric cell as unset rather than 0', () => {
    expect(metersToMiles('abc')).toBeNull();
    expect(milesToMeters('abc')).toBe('');
  });
});

describe('form seeding', () => {
  it('never puts the text "null" in an input', () => {
    expect(metersToMilesInput('')).toBe('');
    expect(metersToMilesInput('abc')).toBe('');
    expect(metersToFeetInput('')).toBe('');
    expect(metersToFeetInput('abc')).toBe('');
  });

  it('seeds a field with the displayed value', () => {
    expect(metersToMilesInput('19956')).toBe('12.4');
    expect(metersToFeetInput('457')).toBe('1500');
  });
});

// AC3: omitted entirely when empty — no "0 mi", no em dash.
describe('display', () => {
  it('formats imperial values', () => {
    expect(formatDistance('19956')).toBe('12.4 mi');
    expect(formatElevation('457')).toBe('1,500 ft');
    expect(formatHeartRate('136')).toBe('136 bpm');
  });

  it('renders nothing at all when unset', () => {
    expect(formatDistance('')).toBe('');
    expect(formatElevation('')).toBe('');
    expect(formatHeartRate('')).toBe('');
  });

  it('still renders a deliberate zero', () => {
    expect(formatDistance('0')).toBe('0 mi');
    expect(formatHeartRate('0')).toBe('0 bpm');
  });
});

// #239 AC4 — kg as stored, lb as shown.
describe('body weight', () => {
  it('converts kg to lb, rounded to 0.1', () => {
    expect(kgToLb('80.9')).toBe(178.4);
    expect(kgToLb('100')).toBe(220.5);
  });
  it('keeps blank as null and a measured 0 as 0', () => {
    expect(kgToLb('')).toBeNull();
    expect(kgToLb('0')).toBe(0);
  });
  it('formats with one decimal and the unit, or nothing', () => {
    expect(formatWeight('80.9')).toBe('178.4 lb');
    expect(formatWeight('81.64')).toBe('180.0 lb');
    expect(formatWeight('')).toBe('');
  });
});
