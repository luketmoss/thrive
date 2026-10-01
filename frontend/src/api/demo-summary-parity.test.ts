// #266 — the demo DailySummary's activity columns against the real rollup.
//
// demo-data.ts keeps its own port of buildDaySummary (summarizeDemoDay): the
// real function is Apps Script source and the SPA must not carry a third
// copy of it. A port can drift silently, so this test runs the REAL
// buildDaySummary, read as text from apps-script/src and evaluated in a
// node:vm context (the way apps-script/tests/apps-script-sandbox.ts does,
// and the way health-api.test.ts reads types.js), over the same activities
// the demo rolled up, and fails on the date and column of any difference.
// Health (M-Q) and body (U-Y) are pinned elsewhere; this is B-L, S and T.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  demoActivitiesByDate,
  demoDailyHealth,
  demoBodyMeasurements,
  demoDailySummary,
  DEMO_HEALTH_DAYS,
  type DemoActivity,
} from './demo-data';
import type { BodyMeasurementRow, DailyHealthRow, DailySummaryRow } from './health-api';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps-script/src');

type Rule = (src: string) => string;
type Body = { scale: BodyMeasurementRow[]; bp: BodyMeasurementRow[] };
type Rollup = (
  date: string, workouts: DemoActivity[], health: DailyHealthRow | null, computedAt: string, body: Body | null,
) => Record<string, string> | null;

/** Load the real rollup. `mutate` edits a sandbox copy of the source only. */
function loadRollup(mutate?: { file: 'types.js' | 'daily-summary.js'; edit: Rule }): Rollup {
  const ctx = createContext({});
  for (const file of ['types.js', 'daily-summary.js'] as const) {
    let src = readFileSync(resolve(SRC, file), 'utf8');
    if (mutate && mutate.file === file) {
      const edited = mutate.edit(src);
      if (edited === src) throw new Error(`mutation did not change ${file}`);
      src = edited;
    }
    runInContext(src, ctx, { filename: file });
  }
  return runInContext('buildDaySummary', ctx) as Rollup;
}

// Columns B-L, S, T of DailySummary, as the row's field names.
const ACTIVITY_COLUMNS: { col: string; field: keyof DailySummaryRow }[] = [
  ['B', 'activity_count'], ['C', 'activity_types'], ['D', 'total_moving_s'], ['E', 'total_elapsed_s'],
  ['F', 'total_distance_m'], ['G', 'total_ascent_m'], ['H', 'cardio_activity_count'],
  ['I', 'distance_withdata'], ['J', 'ascent_withdata'], ['K', 'max_effort'], ['L', 'effort_counts'],
  ['S', 'moving_withdata'], ['T', 'elapsed_withdata'],
].map(([col, field]) => ({ col, field: field as keyof DailySummaryRow }));

const COMPUTED_AT = '2026-01-01T00:00:00.000Z';

/** The real rollup's input for each demo day: its activities, its DailyHealth row, its body readings. */
function inputsFor(now: Date) {
  const health = new Map(demoDailyHealth(now, 'ok').map((h) => [h.date, h]));
  const body = new Map<string, Body>();
  for (const m of demoBodyMeasurements(now, 'ok')) {
    if (!body.has(m.date)) body.set(m.date, { scale: [], bp: [] });
    body.get(m.date)![m.kind === 'scale' ? 'scale' : 'bp'].push(m);
  }
  return [...demoActivitiesByDate(now).entries()].map(([date, ws]) => ({
    date, ws, health: health.get(date) ?? null, body: body.get(date) ?? null,
  }));
}

/** Every difference between the demo's rows and the rollup's, named by date and column. */
function mismatches(now: Date, build: Rollup): string[] {
  const demo = new Map(demoDailySummary(now, 'ok').map((r) => [r.date, r]));
  const out: string[] = [];
  for (const { date, ws, health, body } of inputsFor(now)) {
    const real = build(date, ws, health, COMPUTED_AT, body);
    const mine = demo.get(date);
    if (!real !== !mine) {
      out.push(`${date}: demo row ${mine ? 'exists' : 'is missing'}, the real rollup ${real ? 'returns one' : 'returns none'}`);
      continue;
    }
    if (!real || !mine) continue;
    for (const { col, field } of ACTIVITY_COLUMNS) {
      if (real[field] !== mine[field]) {
        out.push(`${date} column ${col} (${field}): demo '${mine[field]}', real '${real[field]}'`);
      }
    }
  }
  return out;
}

const NOWS = [
  new Date('2026-09-30T18:05:00Z'),
  new Date('2026-11-02T13:00:00Z'),
  new Date('2027-03-15T02:10:00Z'),
];

const cardio = (w: DemoActivity) => ['bike', 'hike', 'run', 'walk'].includes(w.type);
const indoor = (w: DemoActivity) => w.sub_type === 'indoor';

describe('demo DailySummary activity columns match the real rollup (#266)', () => {
  const real = loadRollup();

  it.each(NOWS.map((d) => [d.toISOString(), d] as const))('AC1: every day at %s', (_label, now) => {
    expect(demoActivitiesByDate(now).size).toBe(DEMO_HEALTH_DAYS);
    expect(mismatches(now, real)).toEqual([]);
  });

  it.each(NOWS.map((d) => [d.toISOString(), d] as const))('AC2: the days cover the cases where the rules bite, at %s', (_label, now) => {
    const rows = inputsFor(now)
      .map(({ date, ws, health, body }) => ({ ws, row: real(date, ws, health, COMPUTED_AT, body) }))
      .filter((r): r is { ws: DemoActivity[]; row: Record<string, string> } => r.row !== null);
    const has = (pred: (r: Record<string, string>, ws: DemoActivity[]) => boolean) => rows.some(({ ws, row }) => pred(row, ws));

    // an indoor-only cardio day: F, G, H and I blank, not 0
    expect(has((r, ws) => ws.length > 0 && ws.every((w) => cardio(w) && indoor(w))
      && r.total_distance_m === '' && r.total_ascent_m === '' && r.cardio_activity_count === '' && r.distance_withdata === '')).toBe(true);
    // partial coverage: I < H and S < B
    expect(has((r) => r.cardio_activity_count !== '' && Number(r.distance_withdata) < Number(r.cardio_activity_count)
      && Number(r.moving_withdata) < Number(r.activity_count))).toBe(true);
    // a measured 0 distance stays 0
    expect(has((r) => r.total_distance_m === '0')).toBe(true);
    // two effort levels, the hardest in K
    expect(has((r) => {
      const levels = r.effort_counts.split(',');
      return levels.length === 2 && r.max_effort === levels[0].split(':')[0];
    })).toBe(true);
    // an activity whose effort is blank
    expect(has((_r, ws) => ws.some((w) => w.effort === ''))).toBe(true);
    // indoor and outdoor cardio on one day
    expect(has((_r, ws) => ws.some((w) => cardio(w) && indoor(w)) && ws.some((w) => cardio(w) && !indoor(w)))).toBe(true);
    // a non-cardio activity, never counted in H
    expect(has((r, ws) => ws.length > 0 && ws.every((w) => !cardio(w)) && r.cardio_activity_count === '')).toBe(true);
  });

  describe('AC3: a changed rule is noticed', () => {
    const cases: [string, 'types.js' | 'daily-summary.js', Rule][] = [
      ['INDOOR_SUB_TYPES extended', 'daily-summary.js',
        (s) => s.replace("var INDOOR_SUB_TYPES = ['indoor'];", "var INDOOR_SUB_TYPES = ['indoor', 'outdoor', 'road', 'mountain'];")],
      ['CARDIO_TYPES widened', 'daily-summary.js',
        (s) => s.replace("var CARDIO_TYPES = ['bike', 'hike', 'run', 'walk'];", "var CARDIO_TYPES = ['bike', 'hike', 'run', 'walk', 'weight', 'stretch'];")],
      ['EFFORTS reordered', 'types.js',
        (s) => s.replace("var EFFORTS = ['Easy', 'Medium', 'Hard'];", "var EFFORTS = ['Hard', 'Medium', 'Easy'];")],
    ];
    it.each(cases)('%s', (_name, file, edit) => {
      expect(mismatches(NOWS[0], loadRollup({ file, edit })).length).toBeGreaterThan(0);
    });
  });
});
