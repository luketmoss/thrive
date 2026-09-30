// #239 AC4 — bodyDayOf, pinned by the fixtures of apps-script/tests/daily-summary.test.ts (#203 AC2–AC4).
import { describe, it, expect } from 'vitest';
import { bodyDayOf } from './body-day';
import { BODY_MEASUREMENT_FIELDS, type BodyMeasurementRow } from './health-api';

let row = 2;
function bodyRow(fields: Partial<BodyMeasurementRow>): BodyMeasurementRow {
  const r = { sheetRow: row++ } as BodyMeasurementRow;
  for (const f of BODY_MEASUREMENT_FIELDS) (r as Record<string, string | number>)[f] = '';
  return { ...r, ...fields };
}

const summaryOf = (rows: BodyMeasurementRow[]) => {
  const d = bodyDayOf(rows);
  return [d.weight_kg, d.fat_ratio_pct, d.systolic_mmhg, d.diastolic_mmhg, d.bp_count];
};

describe('bodyDayOf: weight and body fat from the first weigh-in (#203 AC2)', () => {
  it('takes the earliest scale reading by measured_at_utc, not sheet order', () => {
    const d = bodyDayOf([
      bodyRow({ grpid: '2', date: '2026-09-15', time: '19:10', measured_at_utc: '2026-09-15T19:10:00-06:00', kind: 'scale', weight_kg: '73.1' }),
      bodyRow({ grpid: '1', date: '2026-09-15', time: '06:40', measured_at_utc: '2026-09-15T06:40:00-06:00', kind: 'scale', weight_kg: '72.3', fat_ratio_pct: '21.4' }),
    ]);
    expect(d.weight_kg).toBe('72.3');
    expect(d.fat_ratio_pct).toBe('21.4');
    expect(d.weighIn!.time).toBe('06:40');
  });

  it('parses the instant, so an offset cannot reorder readings as text would', () => {
    const d = bodyDayOf([
      bodyRow({ grpid: '1', measured_at_utc: '2026-09-15T07:00:00-06:00', kind: 'scale', weight_kg: '73.0' }), // 13:00Z
      bodyRow({ grpid: '2', measured_at_utc: '2026-09-15T12:30:00Z', kind: 'scale', weight_kg: '72.0' }),
    ]);
    expect(d.weight_kg).toBe('72.0');
  });

  it('leaves fat blank when the first weigh-in had none, even though a later one does', () => {
    expect(summaryOf([
      bodyRow({ grpid: '1', measured_at_utc: '2026-09-15T06:40:00-06:00', kind: 'scale', weight_kg: '72.3' }),
      bodyRow({ grpid: '2', measured_at_utc: '2026-09-15T19:10:00-06:00', kind: 'scale', weight_kg: '73.1', fat_ratio_pct: '22.0' }),
    ]).slice(0, 2)).toEqual(['72.3', '']);
  });

  it('skips a first reading with no weight in favour of the next that has it', () => {
    expect(summaryOf([
      bodyRow({ grpid: '1', measured_at_utc: '2026-09-15T06:00:00-06:00', kind: 'scale', fat_ratio_pct: '20.0' }),
      bodyRow({ grpid: '2', measured_at_utc: '2026-09-15T06:40:00-06:00', kind: 'scale', weight_kg: '72.3', fat_ratio_pct: '21.4' }),
    ]).slice(0, 2)).toEqual(['72.3', '21.4']);
  });
});

describe('bodyDayOf: blood pressure is the mean, with its count (#203 AC3)', () => {
  const bp = (grpid: string, time: string, sys: string, dia: string) =>
    bodyRow({ grpid, time, measured_at_utc: `2026-09-15T${time}:00-06:00`, kind: 'bp', systolic_mmhg: sys, diastolic_mmhg: dia });

  it('means systolic and diastolic separately, rounded half up, counting readings', () => {
    expect(summaryOf([bp('1', '08:00', '121', '79'), bp('2', '08:05', '118', '76'), bp('3', '08:10', '116', '77')]).slice(2))
      .toEqual(['118', '77', '3']);
  });

  it('rounds a mean exactly at the half up, not to even', () => {
    expect(summaryOf([bp('1', '08:00', '120', '80'), bp('2', '08:05', '121', '81')]).slice(2)).toEqual(['121', '81', '2']);
  });

  it('a reading missing one value contributes only to the mean it has, but still counts', () => {
    expect(summaryOf([bp('1', '08:00', '120', '80'), bp('2', '08:05', '100', '')]).slice(2)).toEqual(['110', '80', '2']);
  });

  it('keeps the readings oldest first', () => {
    const d = bodyDayOf([bp('2', '08:05', '121', '81'), bp('1', '08:00', '120', '80')]);
    expect(d.bp.map((r) => r.grpid)).toEqual(['1', '2']);
  });
});

describe('bodyDayOf: blank, never 0 (#203 AC4)', () => {
  it('leaves weight blank on a day with only BP, and BP blank on a day with only a weigh-in', () => {
    expect(summaryOf([bodyRow({ grpid: '1', measured_at_utc: '2026-09-15T08:00:00-06:00', kind: 'bp', systolic_mmhg: '120', diastolic_mmhg: '80' })]).slice(0, 2))
      .toEqual(['', '']);
    expect(summaryOf([bodyRow({ grpid: '1', measured_at_utc: '2026-09-15T06:40:00-06:00', kind: 'scale', weight_kg: '72.3' })]).slice(2))
      .toEqual(['', '', '']);
  });

  it('is all blank for no readings', () => {
    expect(summaryOf([])).toEqual(['', '', '', '', '']);
    expect(bodyDayOf([]).weighIn).toBeNull();
  });
});
