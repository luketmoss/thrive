// #243 AC1-AC3 — the Recovery, Sleep and Fitness registry entries.
import { describe, it, expect, beforeEach } from 'vitest';
import { TREND_GROUPS, SLEEP_TOTAL, SLEEP_DEEP, VO2MAX, TRAINING_LOAD, HRV } from './metrics';
import { dailyHealth } from '../../state/store';

const group = (id: string) => TREND_GROUPS.find((g) => g.id === id)!;

beforeEach(() => { dailyHealth.value = { state: 'idle' }; });

describe('registry', () => {
  it('has Recovery, Sleep, Fitness in order', () => {
    expect(TREND_GROUPS.map((g) => g.id)).toEqual(['recovery', 'sleep', 'fitness']);
    expect(TREND_GROUPS.map((g) => g.label)).toEqual(['Recovery', 'Sleep', 'Fitness']);
    expect(TREND_GROUPS.every((g) => g.metrics.length >= 1 && g.metrics.length <= 4)).toBe(true);
  });
  it('Recovery: resting HR then HRV, both banded', () => {
    expect(group('recovery').metrics.map((m) => [m.id, m.unit, m.band])).toEqual([
      ['resting_hr', 'bpm', true], ['hrv', 'ms', true],
    ]);
    expect(HRV.format(54.6)).toBe('55');
  });
  it('Sleep: total, deep, REM, score with the specified bands', () => {
    expect(group('sleep').metrics.map((m) => [m.id, m.band])).toEqual([
      ['sleep_total', true], ['sleep_deep', false], ['sleep_rem', false], ['sleep_score', true],
    ]);
    expect(group('sleep').metrics[3].unit).toBe('pts');
    expect(group('sleep').metrics.some((m) => m.excludesToday)).toBe(false);
  });
  it('Fitness: VO2max one decimal unbanded, training load banded', () => {
    expect(group('fitness').metrics.map((m) => [m.id, m.band])).toEqual([['vo2max', false], ['training_load', true]]);
    expect(VO2MAX.unit).toBe('mL/kg/min');
    expect(VO2MAX.format(52)).toBe('52.0');
    expect(TRAINING_LOAD.format(412.4)).toBe('412');
  });
});

describe('sleep points', () => {
  it('reads seconds as hours, and each blank stays blank on its own', () => {
    dailyHealth.value = {
      state: 'loaded',
      rows: [
        { date: '2026-09-01', sleep_total_s: '27000', sleep_deep_s: '', sleep_rem_s: '3600', sheetRow: 2 },
        { date: '2026-09-02', sleep_total_s: '', sleep_deep_s: '1800', sleep_rem_s: '', sheetRow: 3 },
      ] as never[],
    };
    expect(SLEEP_TOTAL.points()).toEqual([{ date: '2026-09-01', value: 7.5 }]);
    expect(SLEEP_DEEP.points()).toEqual([{ date: '2026-09-02', value: 0.5 }]);
    expect(SLEEP_TOTAL.format(7.5)).toBe('7h 30m');
  });
});
