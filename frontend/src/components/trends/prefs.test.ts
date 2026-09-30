// #242 AC1 — the Trends controls remembered on this device, never breaking.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RANGE_PREF, AVERAGE_PREF, VIEW_PREF, readPref, writePref } from './prefs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Trends prefs', () => {
  it('uses the documented keys and defaults', () => {
    expect([RANGE_PREF.key, AVERAGE_PREF.key, VIEW_PREF.key])
      .toEqual(['thrive-trends-range', 'thrive-trends-average', 'thrive-trends-view']);
    expect([readPref(RANGE_PREF), readPref(AVERAGE_PREF), readPref(VIEW_PREF)]).toEqual(['3M', '7d', 'Chart']);
  });

  it('round-trips a choice', () => {
    writePref(RANGE_PREF, '1Y');
    writePref(AVERAGE_PREF, 'Off');
    writePref(VIEW_PREF, 'Table');
    expect([readPref(RANGE_PREF), readPref(AVERAGE_PREF), readPref(VIEW_PREF)]).toEqual(['1Y', 'Off', 'Table']);
  });

  it('gives the default for an unknown stored value', () => {
    localStorage.setItem('thrive-trends-range', '2Y');
    expect(readPref(RANGE_PREF)).toBe('3M');
  });

  it('gives the default when storage cannot be read, and a failed write does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(readPref(AVERAGE_PREF)).toBe('7d');
    expect(() => writePref(AVERAGE_PREF, '30d')).not.toThrow();
  });
});
