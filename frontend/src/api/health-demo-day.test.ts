// #239 AC4, AC5 — the demo health data the Day view's panels need.
import { describe, it, expect } from 'vitest';
import { demoDailyHealth, demoBodyMeasurements, demoDailySummary, addDaysToDateStr } from './demo-data';
import { selectBodyMeasurementRange } from './health-api';
import { bodyDayOf } from './body-day';
import { todayInDenver } from '../day/dates';
import { HEALTH_METRICS, rangeCaption, seriesOf } from '../components/day/health-rows';

const NOWS = [
  new Date('2026-09-30T18:05:00Z'),
  new Date('2026-10-13T14:00:00Z'),
  new Date('2026-11-02T13:00:00Z'),
  new Date('2027-01-01T23:59:00Z'),
];

describe.each(NOWS.map((now) => [now.toISOString(), now] as const))('demo at %s', (_label, now) => {
  const today = todayInDenver(now);

  it('has, within the last 30 days, a resting HR above its range and an HRV below its range', () => {
    const rows = demoDailyHealth(now, 'ok');
    const found = (key: 'resting_hr' | 'hrv', zone: 'above' | 'below') => {
      const metric = HEALTH_METRICS.find((m) => m.key === key)!;
      const series = seriesOf(rows, metric.field);
      for (let i = 0; i < 30; i++) {
        const date = addDaysToDateStr(today, -i);
        const v = series.get(date);
        if (v === undefined) continue;
        const c = rangeCaption(metric, v, series, date);
        if (c.kind === 'range' && c.zone === zone && c.attention) return true;
      }
      return false;
    };
    expect(found('resting_hr', 'above')).toBe(true);
    expect(found('hrv', 'below')).toBe(true);
  });

  it('agrees with the demo DailySummary U:Y on every day (bodyDayOf mirrors the rebuild)', () => {
    const body = demoBodyMeasurements(now, 'ok');
    for (const s of demoDailySummary(now, 'ok')) {
      const d = bodyDayOf(selectBodyMeasurementRange(body, s.date, s.date));
      expect([d.weight_kg, d.fat_ratio_pct, d.systolic_mmhg, d.diastolic_mmhg, d.bp_count], s.date)
        .toEqual([s.weight_kg, s.fat_ratio_pct, s.systolic_mmhg, s.diastolic_mmhg, s.bp_count]);
    }
  });

  it('health=presync drops only today from DailyHealth and BodyMeasurements, and the summary follows', () => {
    const ok = demoDailyHealth(now, 'ok');
    const pre = demoDailyHealth(now, 'presync');
    expect(ok.some((r) => r.date === today)).toBe(true);
    expect(pre.some((r) => r.date === today)).toBe(false);
    expect(pre.length).toBe(ok.length - 1);
    expect(demoBodyMeasurements(now, 'presync').some((r) => r.date === today)).toBe(false);
    const summaryToday = demoDailySummary(now, 'presync').find((r) => r.date === today);
    if (summaryToday) {
      expect([summaryToday.steps, summaryToday.weight_kg, summaryToday.bp_count]).toEqual(['', '', '']);
    }
  });
});
