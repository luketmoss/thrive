// #243 AC1-AC3 — the Recovery, Sleep and Fitness registry entries.
import { describe, it, expect, beforeEach } from 'vitest';
import { TREND_GROUPS, SLEEP_TOTAL, SLEEP_DEEP, VO2MAX, TRAINING_LOAD, HRV } from './metrics';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { ACTIVITY_COUNT, MOVING_TIME, DISTANCE, ASCENT } from './metrics';
import { WEIGHT, BODY_FAT, SYSTOLIC, DIASTOLIC, BP_READINGS } from './metrics';

const group = (id: string) => TREND_GROUPS.find((g) => g.id === id)!;

beforeEach(() => { dailyHealth.value = { state: 'idle' }; });

describe('registry', () => {
  it('has the six groups in order, then Custom', () => {
    expect(TREND_GROUPS.map((g) => g.id)).toEqual(['recovery', 'sleep', 'fitness', 'body', 'blood_pressure', 'activity', 'custom']);
    expect(TREND_GROUPS.map((g) => g.label)).toEqual(['Recovery', 'Sleep', 'Fitness', 'Body', 'Blood Pressure', 'Activity', 'Custom']);
    expect(TREND_GROUPS.filter((g) => g.id !== 'custom').every((g) => g.metrics.length >= 1 && g.metrics.length <= 4)).toBe(true);
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

// ── #244: Body and Blood Pressure ────────────────────────────────────
const reading = (o: Record<string, string>, i = 1) => ({
  grpid: `g${i}`, date: '2026-09-01', time: '07:00', measured_at_utc: '2026-09-01T13:00:00Z', kind: 'scale',
  weight_kg: '', fat_ratio_pct: '', systolic_mmhg: '', diastolic_mmhg: '', sheetRow: i + 1, ...o,
}) as never;

describe('Body and Blood Pressure registry', () => {
  it('declares the groups, tab and shape', () => {
    expect(group('body').metrics.map((m) => [m.id, m.unit, m.band, m.zeroBased])).toEqual([
      ['weight', 'lb', true, false], ['body_fat', '%', true, false],
    ]);
    expect(group('blood_pressure').metrics.map((m) => [m.id, m.unit, m.band, m.zeroBased])).toEqual([
      ['systolic', 'mmHg', true, false], ['diastolic', 'mmHg', true, false], ['bp_readings', '', false, true],
    ]);
    for (const id of ['body', 'blood_pressure']) {
      expect(group(id).metrics.every((m) => m.source === 'bodyMeasurements')).toBe(true);
    }
  });
  it('is empty until BodyMeasurements has loaded', () => {
    bodyMeasurements.value = { state: 'loading' };
    expect(WEIGHT.points()).toEqual([]);
  });
  it('weight is the first weigh-in in lb; fat comes from that same reading', () => {
    bodyMeasurements.value = { state: 'loaded', rows: [
      reading({ weight_kg: '80.9', fat_ratio_pct: '20.5', measured_at_utc: '2026-09-01T14:00:00Z' }, 1),
      reading({ weight_kg: '82', fat_ratio_pct: '25', measured_at_utc: '2026-09-01T16:00:00Z' }, 2),
      reading({ date: '2026-09-02', weight_kg: '81', measured_at_utc: '2026-09-02T14:00:00Z' }, 3),
      reading({ date: '2026-09-03', kind: 'bp', systolic_mmhg: '120', diastolic_mmhg: '80' }, 4),
    ] };
    expect(WEIGHT.points()).toEqual([{ date: '2026-09-01', value: 178.4 }, { date: '2026-09-02', value: 178.6 }]);
    expect(BODY_FAT.points()).toEqual([{ date: '2026-09-01', value: 20.5 }]);
    expect(WEIGHT.format(178.4)).toBe('178.4');
    expect(BODY_FAT.format(20.5)).toBe('20.5');
  });
  it('blood pressure is the day mean half up, with the reading count; blanks omitted, never 0', () => {
    bodyMeasurements.value = { state: 'loaded', rows: [
      reading({ kind: 'bp', systolic_mmhg: '120', diastolic_mmhg: '80', measured_at_utc: '2026-09-01T14:00:00Z' }, 1),
      reading({ kind: 'bp', systolic_mmhg: '123', diastolic_mmhg: '81', measured_at_utc: '2026-09-01T15:00:00Z' }, 2),
      reading({ date: '2026-09-02', weight_kg: '80' }, 3),
    ] };
    expect(SYSTOLIC.points()).toEqual([{ date: '2026-09-01', value: 122 }]);
    expect(DIASTOLIC.points()).toEqual([{ date: '2026-09-01', value: 81 }]);
    expect(BP_READINGS.points()).toEqual([{ date: '2026-09-01', value: 2 }]);
  });
  it('formats readings with a plural and picks axis precision from the ticks', () => {
    expect(BP_READINGS.format(1)).toBe('1 reading');
    expect(BP_READINGS.format(2)).toBe('2 readings');
    expect(WEIGHT.axisFormat!(178, [176, 178, 180])).toBe('178');
    expect(WEIGHT.axisFormat!(178.5, [178, 178.5, 179])).toBe('178.5');
  });
  it('does not read DailyHealth', () => {
    dailyHealth.value = { state: 'loaded', rows: [{ date: '2026-09-01', resting_hr: '50', sheetRow: 2 }] as never[] };
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    expect(WEIGHT.points()).toEqual([]);
  });
});

// -- #245: Activity ----------------------------------------------------
const day = (o: Record<string, string>, i = 1) => ({
  date: '2026-09-01', activity_count: '', total_moving_s: '', total_distance_m: '', total_ascent_m: '',
  cardio_activity_count: '', distance_withdata: '', ascent_withdata: '', moving_withdata: '', sheetRow: i + 1, ...o,
}) as never;

describe('Activity registry', () => {
  it('four metrics in order, unbanded and zero-based, reading only DailySummary', () => {
    expect(group('activity').metrics.map((m) => [m.id, m.label, m.unit, m.band, m.zeroBased, m.note, m.source])).toEqual([
      ['activity_count', 'Activities', '', false, true, undefined, 'dailySummary'],
      ['moving_time', 'Moving Time', 'min', false, true, undefined, 'dailySummary'],
      ['distance', 'Distance', 'mi', false, true, 'Outdoor only', 'dailySummary'],
      ['ascent', 'Ascent', 'ft', false, true, 'Outdoor only', 'dailySummary'],
    ]);
  });
  it('is empty until DailySummary has loaded, and never reads DailyHealth', () => {
    dailyHealth.value = { state: 'loaded', rows: [{ date: '2026-09-01', resting_hr: '50', sheetRow: 2 }] as never[] };
    dailySummary.value = { state: 'loading' };
    expect(ACTIVITY_COUNT.points()).toEqual([]);
  });
});

describe('Activity points', () => {
  const load = (rows: unknown[]) => { dailySummary.value = { state: 'loaded', rows: rows as never[] }; };
  it('count is B straight, a measured 0 kept, no row and blank omitted', () => {
    load([day({ activity_count: '2' }, 1), day({ date: '2026-09-02', activity_count: '0' }, 2), day({ date: '2026-09-03' }, 3)]);
    expect(ACTIVITY_COUNT.points()).toEqual([{ date: '2026-09-01', value: 2 }, { date: '2026-09-02', value: 0 }]);
  });
  it('moving time is minutes; partial only when S < B', () => {
    load([
      day({ activity_count: '2', total_moving_s: '3600', moving_withdata: '2' }, 1),
      day({ date: '2026-09-02', activity_count: '3', total_moving_s: '1800', moving_withdata: '2' }, 2),
      day({ date: '2026-09-03', activity_count: '1', total_moving_s: '', moving_withdata: '0' }, 3),
    ]);
    expect(MOVING_TIME.points()).toEqual([
      { date: '2026-09-01', value: 60 },
      { date: '2026-09-02', value: 30, partial: '2 of 3 activities recorded moving time' },
    ]);
  });
  it('distance in miles and ascent in feet, with outdoor coverage', () => {
    load([
      day({ cardio_activity_count: '2', total_distance_m: '16093', distance_withdata: '2', total_ascent_m: '304.8', ascent_withdata: '1' }, 1),
    ]);
    expect(DISTANCE.points()).toEqual([{ date: '2026-09-01', value: 10 }]);
    expect(ASCENT.points()).toEqual([{ date: '2026-09-01', value: 1000, partial: '1 of 2 outdoor activities recorded ascent' }]);
    expect(DISTANCE.format(10)).toBe('10.0');
    expect(ASCENT.format(1000)).toBe('1,000');
  });
  it('partial distance says N of M outdoor activities', () => {
    load([day({ cardio_activity_count: '3', total_distance_m: '1609', distance_withdata: '2' })]);
    expect(DISTANCE.points()).toEqual([{ date: '2026-09-01', value: 1, partial: '2 of 3 outdoor activities recorded distance' }]);
  });
  it('an indoor-only day (H = 0) has no point and no sentence, even if a value leaked in', () => {
    load([
      day({ activity_count: '1', cardio_activity_count: '0' }, 1),
      day({ date: '2026-09-02', activity_count: '1', cardio_activity_count: '0', total_distance_m: '500', distance_withdata: '0' }, 2),
    ]);
    expect(DISTANCE.points()).toEqual([]);
    expect(ASCENT.points()).toEqual([]);
  });
  it('a measured 0 distance is a point at 0, not a blank day', () => {
    load([day({ cardio_activity_count: '1', total_distance_m: '0', distance_withdata: '1', total_ascent_m: '0', ascent_withdata: '1' })]);
    expect(DISTANCE.points()).toEqual([{ date: '2026-09-01', value: 0 }]);
    expect(ASCENT.points()).toEqual([{ date: '2026-09-01', value: 0 }]);
  });
  it('the count formats whole, and fractional averages to one decimal', () => {
    expect(ACTIVITY_COUNT.format(2)).toBe('2');
    expect(ACTIVITY_COUNT.format(1.43)).toBe('1.4');
  });
});
