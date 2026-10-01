// #246 AC1, AC3, AC4 — the three new metrics, the custom group, and its stored selection.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TREND_GROUPS, SLEEP_DEEP, SLEEP_REM, SLEEP_LIGHT, SLEEP_AWAKE, STEPS, CUSTOM_PICKABLE, CUSTOM_SECTIONS,
  customGroup, normaliseCustom,
} from './metrics';
import { readCustom, writeCustom, CUSTOM_KEY, GROUP_PREF, readPref } from './prefs';
import { dailyHealth } from '../../state/store';
import { addDays } from '../../day/dates';
import { todayInDenver } from '../../day/dates';

beforeEach(() => { localStorage.clear(); dailyHealth.value = { state: 'idle' }; });
afterEach(() => vi.restoreAllMocks());

describe('Light Sleep, Awake Sleep and Steps', () => {
  it('Light and Awake reuse the Deep/REM formatter and shape', () => {
    for (const m of [SLEEP_LIGHT, SLEEP_AWAKE]) {
      expect([m.unit, m.band, m.format, m.axisFormat, m.excludesToday])
        .toEqual(['', false, SLEEP_DEEP.format, SLEEP_REM.axisFormat, undefined]);
    }
    expect([SLEEP_LIGHT.id, SLEEP_LIGHT.label, SLEEP_AWAKE.id, SLEEP_AWAKE.label])
      .toEqual(['sleep_light', 'Light Sleep', 'sleep_awake', 'Awake Sleep']);
    dailyHealth.value = { state: 'loaded', rows: [
      { date: '2026-09-01', sleep_light_s: '14400', sleep_awake_s: '', sheetRow: 2 },
      { date: '2026-09-02', sleep_light_s: '', sleep_awake_s: '1800', sheetRow: 3 },
    ] as never[] };
    expect(SLEEP_LIGHT.points()).toEqual([{ date: '2026-09-01', value: 4 }]);
    expect(SLEEP_AWAKE.points()).toEqual([{ date: '2026-09-02', value: 0.5 }]);
    expect(SLEEP_LIGHT.format(4.25)).toBe('4h 15m');
  });

  it('the Sleep group itself is unchanged', () => {
    const sleep = TREND_GROUPS.find((g) => g.id === 'sleep')!;
    expect(sleep.metrics.map((m) => m.id)).toEqual(['sleep_total', 'sleep_deep', 'sleep_rem', 'sleep_score']);
  });

  it('Steps: thousands-separated, banded, zero-based, today excluded, read from DailyHealth', () => {
    expect([STEPS.unit, STEPS.band, STEPS.zeroBased, STEPS.excludesToday, STEPS.source ?? 'dailyHealth'])
      .toEqual(['steps', true, true, true, 'dailyHealth']);
    expect(STEPS.format(8241)).toBe('8,241');
    expect(STEPS.format(1234567)).toBe('1,234,567');
    expect(STEPS.format(8240.6)).toBe('8,241');
    dailyHealth.value = { state: 'loaded', rows: [
      { date: '2026-09-01', steps: '8241', sheetRow: 2 },
      { date: '2026-09-02', steps: '', sheetRow: 3 },
      { date: '2026-09-03', steps: '0', sheetRow: 4 },
    ] as never[] };
    expect(STEPS.points()).toEqual([{ date: '2026-09-01', value: 8241 }, { date: '2026-09-03', value: 0 }]);
  });
});

describe('the custom group', () => {
  const ORDER = ['resting_hr', 'hrv', 'stress_avg', 'sleep_total', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake', 'sleep_score',
    'vo2max', 'training_load', 'weight', 'body_fat', 'systolic', 'diastolic', 'bp_readings',
    'activity_count', 'moving_time', 'distance', 'ascent', 'steps'];

  it('offers 21 metrics in the canonical order, under the six group headings', () => {
    expect(CUSTOM_PICKABLE.map((m) => m.id)).toEqual(ORDER);
    expect(CUSTOM_SECTIONS.map((s) => s.label))
      .toEqual(['Recovery', 'Sleep', 'Fitness', 'Body', 'Blood Pressure', 'Activity']);
  });
  it('is last in the registry', () => {
    expect(TREND_GROUPS[TREND_GROUPS.length - 1].id).toBe('custom');
  });
  it('is empty with nothing selected', () => {
    expect(customGroup([])).toMatchObject({ id: 'custom', label: 'Custom', metrics: [] });
  });
  it('holds one metric', () => {
    expect(customGroup(['weight']).metrics.map((m) => m.id)).toEqual(['weight']);
  });
  it('stacks four metrics from several groups in canonical order, not pick order', () => {
    const g = customGroup(['steps', 'weight', 'sleep_score', 'resting_hr']);
    expect(g.metrics.map((m) => m.id)).toEqual(['resting_hr', 'sleep_score', 'weight', 'steps']);
    expect(new Set(g.metrics.map((m) => m.source ?? 'dailyHealth'))).toEqual(new Set(['dailyHealth', 'bodyMeasurements']));
  });
  it('keeps a metric\'s own note and source', () => {
    const d = customGroup(['distance']).metrics[0];
    expect([d.note, d.source, d.band]).toEqual(['Outdoor only', 'dailySummary', false]);
  });
  it('Steps in a custom set still leaves today out', () => {
    const today = todayInDenver();
    dailyHealth.value = { state: 'loaded', rows: [{ date: addDays(today, -1), steps: '1', sheetRow: 2 }] as never[] };
    const m = customGroup(['steps']).metrics[0];
    expect([m.excludesToday, m.points()]).toEqual([true, [{ date: addDays(today, -1), value: 1 }]]);
  });
});

describe('the stored selection', () => {
  it('uses thrive-trends-custom and round-trips', () => {
    expect(CUSTOM_KEY).toBe('thrive-trends-custom');
    writeCustom(['hrv', 'steps']);
    expect(localStorage.getItem('thrive-trends-custom')).toBe('["hrv","steps"]');
    expect(readCustom()).toEqual(['hrv', 'steps']);
  });
  it('nothing stored gives []', () => {
    expect(readCustom()).toEqual([]);
  });
  it('malformed JSON, or not an array of strings, gives []', () => {
    for (const bad of ['{nope', '{"a":1}', '"hrv"', '[1,2]']) {
      localStorage.setItem(CUSTOM_KEY, bad);
      expect(readCustom()).toEqual([]);
    }
  });
  it('drops one unknown id among valid ones', () => {
    localStorage.setItem(CUSTOM_KEY, '["hrv","retired","weight"]');
    expect(readCustom()).toEqual(['hrv', 'weight']);
  });
  it('keeps the first four, canonically, of six valid ids', () => {
    localStorage.setItem(CUSTOM_KEY, '["steps","ascent","distance","weight","hrv","resting_hr"]');
    expect(readCustom()).toEqual(['resting_hr', 'hrv', 'weight', 'distance']);
  });
  it('collapses repeats', () => {
    expect(normaliseCustom(['hrv', 'hrv'])).toEqual(['hrv']);
  });
  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(readCustom()).toEqual([]);
    expect(() => writeCustom(['hrv'])).not.toThrow();
  });
  it('the group pref accepts custom', () => {
    localStorage.setItem('thrive-trends-group', 'custom');
    expect(readPref(GROUP_PREF)).toBe('custom');
  });
});
