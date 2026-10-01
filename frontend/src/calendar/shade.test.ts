// #241 AC3 — shading by one health metric: choices, memory, quartile bins.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DAILY_HEALTH_FIELDS } from '../api/health-api';
import {
  SHADE_STORAGE_KEY, binOf, metricWords, quartiles, readShade, shadeChoices, shadeMonth, writeShade,
} from './shade';
import { gridRange, monthOf } from './dates';

beforeEach(() => localStorage.clear());

describe('shadeChoices', () => {
  it('is Nothing, Sleep, Resting HR, HRV, Steps today', () => {
    expect(shadeChoices().map((c) => c.label)).toEqual(['Nothing', 'Sleep', 'Resting HR', 'HRV', 'Steps']);
    expect(shadeChoices().map((c) => c.metric?.field ?? null)).toEqual([null, 'sleep_total_s', 'resting_hr', 'hrv', 'steps']);
  });
  it('adds Average stress sixth once the field list has stress_avg', () => {
    const labels = shadeChoices([...DAILY_HEALTH_FIELDS, 'stress_avg']).map((c) => c.label);
    expect(labels).toEqual(['Nothing', 'Sleep', 'Resting HR', 'HRV', 'Steps', 'Average stress']);
  });
});

describe('readShade / writeShade', () => {
  it('defaults to none, and remembers a choice', () => {
    expect(readShade()).toBe('none');
    writeShade('hrv');
    expect(localStorage.getItem(SHADE_STORAGE_KEY)).toBe('hrv');
    expect(readShade()).toBe('hrv');
  });
  it('treats an unrecognised value as none', () => {
    localStorage.setItem(SHADE_STORAGE_KEY, 'stress'); // not offered yet
    expect(readShade()).toBe('none');
    localStorage.setItem(SHADE_STORAGE_KEY, 'bogus');
    expect(readShade()).toBe('none');
  });
  it('never throws when storage does', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(readShade()).toBe('none');
    expect(() => writeShade('sleep')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('quartiles / binOf', () => {
  it('cuts at the 25th, 50th and 75th percentiles', () => {
    expect(quartiles([1, 2, 3, 4, 5])).toEqual([2, 3, 4]);
    expect(quartiles([])).toBeNull();
  });
  it('bins low to high', () => {
    const q = quartiles([1, 2, 3, 4, 5])!;
    expect([1, 2, 3, 4, 5].map((v) => binOf(v, q))).toEqual([1, 1, 2, 3, 4]);
  });
});

describe('shadeMonth', () => {
  const month = '2026-09';
  const days = gridRange(month).days;
  const inMonth = days.filter((d) => monthOf(d) === month);

  it('bins in-month days only, and never a neighbouring month\'s values', () => {
    const series = new Map<string, number>([
      ['2026-09-01', 50], ['2026-09-02', 60], ['2026-09-03', 70], ['2026-09-04', 80],
      ['2026-08-31', 1000], ['2026-10-01', -1000], // leading / trailing: excluded entirely
    ]);
    const s = shadeMonth(inMonth, series);
    expect(s.bins).toEqual({ '2026-09-01': 1, '2026-09-02': 2, '2026-09-03': 3, '2026-09-04': 4 });
    expect(s.low).toBe(50);
    expect(s.high).toBe(80);
  });
  it('leaves a day with no value unbinned, and a month with none empty', () => {
    const s = shadeMonth(inMonth, new Map([['2026-09-10', 0]]));
    expect(s.bins).toEqual({ '2026-09-10': 1 }); // a measured 0 is a value
    expect(shadeMonth(inMonth, new Map())).toEqual({ bins: {}, low: null, high: null });
  });
});

describe('metricWords', () => {
  const [, sleep, rhr, , steps] = shadeChoices();
  it('says the value in the metric\'s own words, or that there is none', () => {
    expect(metricWords(rhr, 52)).toBe('resting HR 52 bpm');
    expect(metricWords(rhr, undefined)).toBe('no resting HR');
    expect(metricWords(sleep, 25920)).toBe('sleep 7h 12m');
    expect(metricWords(steps, 9412)).toBe('steps 9,412');
    expect(metricWords(shadeChoices()[0], 1)).toBe('');
  });
});
