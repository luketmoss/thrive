// #236 AC5 — the demo health history. The generator is checked by its
// invariants, not by snapshot, and at several `now`s (either side of both DST
// switches, early and late in the day), because the history moves with today.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayInDenver } from '../day/dates';
import {
  demoDailyHealth,
  demoBodyMeasurements,
  demoDailySummary,
  addDaysToDateStr,
  shiftDemoWorkouts,
  DEMO_HEALTH_DAYS,
} from './demo-data';
import { selectDailyRange, selectBodyMeasurementRange, type BodyMeasurementRow, type DailyHealthRow } from './health-api';

const NOWS = [
  new Date('2026-09-30T18:05:00Z'), // mid-afternoon in Denver
  new Date('2026-09-30T07:30:00Z'), // 01:30 in Denver: no readings yet today
  new Date('2026-11-02T13:00:00Z'), // the day after MDT -> MST
  new Date('2027-03-15T02:10:00Z'), // evening of the day after MST -> MDT
  new Date('2027-01-01T23:59:00Z'),
];

const n = (s: string) => (s === '' ? null : Number(s));

function windowOf(now: Date) {
  const today = todayInDenver(now);
  return { today, first: addDaysToDateStr(today, -(DEMO_HEALTH_DAYS - 1)) };
}

afterEach(() => vi.restoreAllMocks());

describe.each(NOWS.map((now) => [now.toISOString(), now] as const))('demo health at %s', (_label, now) => {
  const { today, first } = windowOf(now);
  const health = demoDailyHealth(now, 'ok');
  const body = demoBodyMeasurements(now, 'ok');
  const summary = demoDailySummary(now, 'ok');
  const healthByDate = new Map(health.map((h) => [h.date, h]));

  it('spans 90 local days ending today, one DailyHealth row per date at most', () => {
    for (const rows of [health, body, summary]) {
      for (const r of rows) {
        expect(r.date >= first && r.date <= today, r.date).toBe(true);
      }
    }
    expect(new Set(health.map((h) => h.date)).size).toBe(health.length);
    expect(new Set(summary.map((s) => s.date)).size).toBe(summary.length);
    expect(new Set(body.map((b) => b.grpid)).size).toBe(body.length);
  });

  it('is not in date order in the sheet (a backfill), and sheetRow follows sheet order', () => {
    const dates = health.map((h) => h.date);
    expect(dates).not.toEqual([...dates].sort());
    expect(health.map((h) => h.sheetRow)).toEqual(health.map((_, i) => i + 2));
    expect(summary.map((s) => s.sheetRow)).toEqual(summary.map((_, i) => i + 2));
  });

  it('has days with no DailyHealth row, including a run of at least 3', () => {
    let run = 0;
    let longest = 0;
    for (let d = first; d <= today; d = addDaysToDateStr(d, 1)) {
      run = healthByDate.has(d) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('has rows with individual blanks: a charger night, a day without HRV', () => {
    expect(health.some((h) => h.sleep_total_s === '' && h.steps !== '')).toBe(true);
    expect(health.some((h) => h.hrv === '' && h.sleep_total_s !== '')).toBe(true);
  });

  it('has vo2max and recovery on some days only', () => {
    for (const f of ['vo2max', 'recovery'] as const) {
      const withIt = health.filter((h) => h[f] !== '').length;
      expect(withIt).toBeGreaterThan(0);
      expect(withIt).toBeLessThan(health.length);
    }
  });

  it('has a partial row for today: steps so far and last night\'s sleep', () => {
    const t = healthByDate.get(today);
    expect(t).toBeDefined();
    expect(t!.steps).not.toBe('');
    expect(t!.sleep_total_s).not.toBe('');
  });

  it('keeps every value plausible and blank rather than zero', () => {
    for (const h of health) {
      for (const f of ['resting_hr', 'hrv', 'steps', 'sleep_total_s'] as const) {
        if (h[f] !== '') expect(Number(h[f]), `${h.date} ${f}`).toBeGreaterThan(0);
      }
      if (h.sleep_total_s !== '') {
        const parts = n(h.sleep_deep_s)! + n(h.sleep_rem_s)! + n(h.sleep_light_s)! + n(h.sleep_awake_s)!;
        expect(parts).toBe(Number(h.sleep_total_s)); // total includes awake time
      }
    }
  });

  it('has plausible whole-number stress_avg, with its own gaps and a run of 3 blank days in rows', () => {
    const vals = health.filter((h) => h.stress_avg !== '');
    expect(vals.length).toBeGreaterThan(0);
    for (const h of vals) {
      expect(/^\d+$/.test(h.stress_avg), `${h.date} whole`).toBe(true);
      expect(Number(h.stress_avg), h.date).toBeGreaterThanOrEqual(15);
      expect(Number(h.stress_avg), h.date).toBeLessThanOrEqual(50);
    }
    // A day with a row and its other metrics, but no stress; and today's so-far value is present.
    expect(health.some((h) => h.stress_avg === '' && h.steps !== '' && h.resting_hr !== '')).toBe(true);
    expect(healthByDate.get(today)!.stress_avg).not.toBe('');
    let run = 0, longest = 0;
    for (let d = first; d <= today; d = addDaysToDateStr(d, 1)) {
      run = (healthByDate.get(d)?.stress_avg ?? '') === '' ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('gives resting_hr, hrv, sleep, steps and stress 14+ values in every 30-day window ending in the last 30 days', () => {
    for (let end = addDaysToDateStr(today, -29); end <= today; end = addDaysToDateStr(end, 1)) {
      const win = selectDailyRange(health, addDaysToDateStr(end, -29), end);
      for (const f of ['resting_hr', 'hrv', 'sleep_total_s', 'steps', 'stress_avg'] as const) {
        expect(win.filter((h) => h[f] !== '').length, `${f} in window ending ${end}`).toBeGreaterThanOrEqual(14);
      }
    }
  });

  const bodyByDate = new Map<string, BodyMeasurementRow[]>();
  for (const m of body) {
    if (!bodyByDate.has(m.date)) bodyByDate.set(m.date, []);
    bodyByDate.get(m.date)!.push(m);
  }
  const scales = (d: string) => selectBodyMeasurementRange(bodyByDate.get(d) ?? [], d, d).filter((m) => m.kind === 'scale');
  const bps = (d: string) => (bodyByDate.get(d) ?? []).filter((m) => m.kind === 'bp');
  const pastDays: string[] = [];
  for (let d = first; d < today; d = addDaysToDateStr(d, 1)) pastDays.push(d);

  it('has mornings with no scale reading', () => {
    expect(pastDays.some((d) => scales(d).length === 0)).toBe(true);
  });

  it('has a day with two scale readings, the first by measured_at_utc having a weight', () => {
    expect(pastDays.some((d) => {
      const s = scales(d);
      return s.length >= 2 && s[0].weight_kg !== '' && s.every((m) => m.weight_kg !== '');
    })).toBe(true);
  });

  it('has a scale reading with no weight', () => {
    expect(body.some((m) => m.kind === 'scale' && m.weight_kg === '')).toBe(true);
  });

  it('has days with 2+ BP readings and days with none', () => {
    expect(pastDays.some((d) => bps(d).length >= 2)).toBe(true);
    expect(pastDays.some((d) => bps(d).length === 0)).toBe(true);
  });

  it('stores readings as Withings would: kg, local date matching the instant, nothing in the future', () => {
    for (const m of body) {
      const t = Date.parse(m.measured_at_utc);
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBeLessThanOrEqual(now.getTime());
      expect(todayInDenver(new Date(t))).toBe(m.date);
      if (m.weight_kg !== '') expect(Number(m.weight_kg)).toBeGreaterThan(70);
      expect(['scale', 'bp']).toContain(m.kind);
    }
  });

  it('gives every day with health or body data a summary row', () => {
    const summaryDates = new Set(summary.map((s) => s.date));
    for (const d of [...healthByDate.keys(), ...bodyByDate.keys()]) expect(summaryDates.has(d), d).toBe(true);
  });

  it('agrees with DailyHealth and BodyMeasurements by the tab\'s own rules', () => {
    for (const s of summary) {
      const h: DailyHealthRow | undefined = healthByDate.get(s.date);
      for (const f of ['steps', 'resting_hr', 'hrv', 'sleep_total_s', 'training_load'] as const) {
        expect(s[f], `${s.date} ${f}`).toBe(h ? h[f] : '');
      }
      const firstWeighed = scales(s.date).find((m) => m.weight_kg !== '');
      expect(s.weight_kg, `${s.date} weight`).toBe(firstWeighed?.weight_kg ?? '');
      expect(s.fat_ratio_pct, `${s.date} fat`).toBe(firstWeighed?.fat_ratio_pct ?? '');
      const day = bps(s.date);
      const mean = (f: 'systolic_mmhg' | 'diastolic_mmhg') =>
        day.length ? String(Math.floor(day.reduce((a, m) => a + Number(m[f]), 0) / day.length + 0.5)) : '';
      expect(s.systolic_mmhg, `${s.date} sys`).toBe(mean('systolic_mmhg'));
      expect(s.diastolic_mmhg, `${s.date} dia`).toBe(mean('diastolic_mmhg'));
      expect(s.bp_count, `${s.date} bp_count`).toBe(day.length ? String(day.length) : '');
    }
  });

  it('shows half-up rounding of a .5 BP mean somewhere', () => {
    expect(pastDays.some((d) => {
      const day = bps(d);
      return day.length > 0 && (day.reduce((a, m) => a + Number(m.systolic_mmhg), 0) / day.length) % 1 === 0.5;
    })).toBe(true);
  });

  it('has activity coverage cases: partial, a measured 0, an indoor-only day', () => {
    const partial = summary.find((s) =>
      n(s.distance_withdata)! < n(s.cardio_activity_count)! && n(s.moving_withdata)! < n(s.activity_count)!);
    expect(partial, 'a day with I < H and S < B').toBeDefined();
    expect(summary.some((s) => s.total_distance_m === '0' && s.distance_withdata !== '0')).toBe(true);
    // Indoor only: F/G blank, and H blank too — the rebuild writes no count of
    // zero outdoor sessions (buildDaySummary), so neither does the demo.
    const indoorOnly = (types: string) => {
      const ts = types.split(',');
      return ts.some((t) => t.endsWith(':indoor'))
        && ts.every((t) => t.endsWith(':indoor') || !/^(bike|hike|run|walk)/.test(t));
    };
    const indoor = summary.find((s) => indoorOnly(s.activity_types));
    expect(indoor, 'an indoor-only day').toBeDefined();
    expect(indoor!.total_distance_m).toBe('');
    expect(indoor!.total_ascent_m).toBe('');
    expect(indoor!.cardio_activity_count).toBe('');
    expect(indoor!.distance_withdata).toBe('');
  });

  it('keeps coverage counts within their totals everywhere', () => {
    for (const s of summary) {
      if (s.activity_count === '') {
        expect([s.moving_withdata, s.elapsed_withdata, s.cardio_activity_count, s.total_distance_m]).toEqual(['', '', '', '']);
        continue;
      }
      expect(n(s.moving_withdata)!).toBeLessThanOrEqual(n(s.activity_count)!);
      expect(n(s.elapsed_withdata)!).toBeLessThanOrEqual(n(s.activity_count)!);
      if (s.cardio_activity_count !== '') {
        expect(n(s.distance_withdata)!).toBeLessThanOrEqual(n(s.cardio_activity_count)!);
        expect(n(s.ascent_withdata)!).toBeLessThanOrEqual(n(s.cardio_activity_count)!);
      }
      expect(s.total_moving_s === '').toBe(s.moving_withdata === '0');
    }
  });

  it('rolls the last week up from the demo Workouts, so a day agrees with its activity list', () => {
    const done = shiftDemoWorkouts(now).filter((w) => w.status !== 'planned');
    const bySum = new Map(summary.map((s) => [s.date, s]));
    for (let i = 0; i < 7; i++) {
      const d = addDaysToDateStr(today, -i);
      const count = done.filter((w) => w.date === d).length;
      expect(bySum.get(d)?.activity_count ?? '', d).toBe(count ? String(count) : '');
    }
  });
});

describe('demo health determinism', () => {
  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    demoDailyHealth(NOWS[0], 'ok');
    demoBodyMeasurements(NOWS[0], 'ok');
    demoDailySummary(NOWS[0], 'ok');
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows the same values for the same past date, whatever today is', () => {
    const a = new Date('2026-09-30T18:05:00Z');
    const b = new Date('2026-10-09T03:40:00Z');
    const strip = <T extends { sheetRow: number; synced_at: string }>({ sheetRow: _r, synced_at: _s, ...rest }: T) => rest;
    const { today: todayA } = windowOf(a);
    const { first: firstB } = windowOf(b);
    const overlap = (d: string) => d >= firstB && d < todayA;

    const hb = new Map(demoDailyHealth(b, 'ok').map((h) => [h.date, strip(h)]));
    const shared = demoDailyHealth(a, 'ok').filter((h) => overlap(h.date));
    expect(shared.length).toBeGreaterThan(50);
    for (const h of shared) expect(hb.get(h.date)).toEqual(strip(h));

    const bb = new Map(demoBodyMeasurements(b, 'ok').map((m) => [m.grpid, strip(m)]));
    const sharedBody = demoBodyMeasurements(a, 'ok').filter((m) => overlap(m.date));
    expect(sharedBody.length).toBeGreaterThan(50);
    for (const m of sharedBody) expect(bb.get(m.grpid)).toEqual(strip(m));
  });

  it('gives the same result for the same now', () => {
    expect(demoDailySummary(NOWS[2], 'ok')).toEqual(demoDailySummary(NOWS[2], 'ok'));
  });
});

describe('demo health scenarios (health=)', () => {
  it('empty loads all three tabs with no rows', () => {
    expect(demoDailyHealth(NOWS[0], 'empty')).toEqual([]);
    expect(demoBodyMeasurements(NOWS[0], 'empty')).toEqual([]);
    expect(demoDailySummary(NOWS[0], 'empty')).toEqual([]);
  });

  it('error fails all three', () => {
    expect(() => demoDailyHealth(NOWS[0], 'error')).toThrow();
    expect(() => demoBodyMeasurements(NOWS[0], 'error')).toThrow();
    expect(() => demoDailySummary(NOWS[0], 'error')).toThrow();
  });
});
