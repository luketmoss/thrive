// #239 AC1–AC3 — the Health panel's row rules, without the DOM.
import { describe, it, expect } from 'vitest';
import { healthView, rangeCaption, captionText, activeMetrics, HEALTH_METRICS, seriesOf, type HealthRowView } from './health-rows';
import { DAILY_HEALTH_FIELDS, type DailyHealthRow } from '../../api/health-api';
import { addDays } from '../../day/dates';

const D = '2026-09-26'; // a Saturday

function hr(date: string, over: Partial<Record<string, string>> = {}): DailyHealthRow {
  const r = { sheetRow: 2 } as DailyHealthRow;
  for (const f of DAILY_HEALTH_FIELDS) (r as unknown as Record<string, string>)[f] = '';
  return { ...r, date, ...over } as DailyHealthRow;
}

const FULL = {
  resting_hr: '52', hrv: '38', steps: '9412',
  sleep_total_s: String(7 * 3600 + 12 * 60),
  sleep_deep_s: String(66 * 60), sleep_light_s: String(252 * 60), sleep_rem_s: String(102 * 60), sleep_awake_s: String(12 * 60),
  bed_time: '23:24', wake_time: '06:12',
  sleep_score: '88', recovery: '70', vo2max: '50', training_load: '90', calories: '2400',
  synced_at: '2026-09-26T13:17:04.000Z',
};

/** `k` days before `date` with value(i) for a field, i = 1..k. */
function history(date: string, k: number, field: string, value: (i: number) => string): DailyHealthRow[] {
  return Array.from({ length: k }, (_, j) => hr(addDays(date, -(j + 1)), { [field]: value(j + 1) }));
}

const rowsOf = (v: ReturnType<typeof healthView>) => {
  if (v.kind !== 'rows') throw new Error(`expected rows, got ${v.kind}`);
  return v.rows;
};
const byKey = (rows: HealthRowView[], key: string) => rows.find((r) => r.key === key)!;
const texts = (r: HealthRowView) => r.captions.map(captionText);

describe('AC1 — a past day', () => {
  it('shows sleep, resting HR, HRV, average stress (#231) and steps in order', () => {
    const rows = rowsOf(healthView([hr(D, { ...FULL, stress_avg: '31' })], D, false));
    expect(rows.map((r) => r.label)).toEqual(['Sleep', 'Resting HR', 'HRV', 'Average stress', 'Steps']);
    expect(rows.map((r) => r.value)).toEqual(['7h 12m', '52 bpm', '38 ms', '31', '9,412']);
    expect(byKey(rows, 'sleep').qualifier).toBe('Fri night');
  });

  it('lists the sleep stages in order and bed to wake', () => {
    const sleep = byKey(rowsOf(healthView([hr(D, FULL)], D, false)), 'sleep');
    expect(sleep.captions[0]).toEqual({ kind: 'stages', items: ['Deep 1h 06m', 'Light 4h 12m', 'REM 1h 42m', 'Awake 0h 12m'] });
    expect(texts(sleep)[1]).toBe('11:24 PM – 6:12 AM');
  });

  it('leaves out a blank stage and bed-to-wake without both times, and never recomputes the total', () => {
    const sleep = byKey(rowsOf(healthView([hr(D, { ...FULL, sleep_rem_s: '', wake_time: '', sleep_total_s: '100' })], D, false)), 'sleep');
    expect(sleep.captions[0]).toEqual({ kind: 'stages', items: ['Deep 1h 06m', 'Light 4h 12m', 'Awake 0h 12m'] });
    expect(texts(sleep).some((t) => t.includes('–') && t.includes('AM'))).toBe(false);
    expect(sleep.value).toBe('0h 02m');
  });

  it('shows a blank as blank with "No reading this day." and no range line; 0 is a value', () => {
    const history14 = history(D, 20, 'hrv', () => '40');
    const rows = rowsOf(healthView([...history14, hr(D, { ...FULL, hrv: '', steps: '0' })], D, false));
    const hrv = byKey(rows, 'hrv');
    expect(hrv.value).toBe('');
    expect(texts(hrv)).toEqual(['No reading this day.']);
    expect(byKey(rows, 'steps').value).toBe('0');
  });

  it('says "No watch data for this day." when there is no row', () => {
    expect(healthView([hr('2026-09-25', FULL)], D, false)).toEqual({ kind: 'note', note: 'No watch data for this day.' });
  });

  it('never shows sleep score, recovery, VO2 max, training load or calories', () => {
    const labels = HEALTH_METRICS.map((m) => m.field);
    for (const f of ['sleep_score', 'recovery', 'vo2max', 'training_load', 'calories']) expect(labels).not.toContain(f);
  });

  it('shows Average stress, before steps, now the field list has stress_avg (#231)', () => {
    const fields = DAILY_HEALTH_FIELDS;
    expect(activeMetrics().map((m) => m.key)).toEqual(['sleep', 'resting_hr', 'hrv', 'stress', 'steps']);
    // A field list without the column (before #231) leaves the row out.
    expect(activeMetrics(fields.filter((f) => f !== 'stress_avg')).map((m) => m.key)).toEqual(['sleep', 'resting_hr', 'hrv', 'steps']);
    const rows = rowsOf(healthView([hr(D, { ...FULL, stress_avg: '31' })], D, false, fields));
    expect(byKey(rows, 'stress').value).toBe('31');
    const blank = rowsOf(healthView([hr(D, FULL)], D, false, fields));
    expect(byKey(blank, 'stress').value).toBe('');
  });
});

describe('AC2 — your range', () => {
  const rhr = HEALTH_METRICS.find((m) => m.key === 'resting_hr')!;
  const hrv = HEALTH_METRICS.find((m) => m.key === 'hrv')!;
  const steps = HEALTH_METRICS.find((m) => m.key === 'steps')!;
  const sleep = HEALTH_METRICS.find((m) => m.key === 'sleep')!;
  // 49 and 55 alternating: mean 52, sd 3, range 49–55.
  const alt = (field: string) => seriesOf(history(D, 20, field, (i) => (i % 2 ? '49' : '55')), field);

  it('reads "in range" within, inclusive of the bounds', () => {
    expect(captionText(rangeCaption(rhr, 55, alt('resting_hr'), D))).toBe('Your range 49–55 bpm · in range');
  });

  it('flags the unwelcome direction for attention, and not the other', () => {
    const above = rangeCaption(rhr, 57, alt('resting_hr'), D);
    expect(above).toMatchObject({ zone: 'above', attention: true });
    expect(captionText(above)).toBe('Your range 49–55 bpm · above your range');
    expect(rangeCaption(rhr, 40, alt('resting_hr'), D)).toMatchObject({ zone: 'below', attention: false });
    expect(rangeCaption(hrv, 40, alt('hrv'), D)).toMatchObject({ zone: 'below', attention: true, bounds: '49–55 ms' });
    expect(rangeCaption(hrv, 60, alt('hrv'), D)).toMatchObject({ zone: 'above', attention: false });
    expect(rangeCaption(steps, 1, alt('steps'), D)).toMatchObject({ zone: 'below', attention: false });
    expect(rangeCaption(steps, 100, alt('steps'), D)).toMatchObject({ zone: 'above', attention: false });
  });

  it('says it is still building with fewer than 14 values', () => {
    const s = seriesOf(history(D, 9, 'resting_hr', () => '50'), 'resting_hr');
    expect(captionText(rangeCaption(rhr, 50, s, D))).toBe('Building your range — 9 of 14 days so far.');
  });

  it('decides on the displayed numbers: a value that rounds to the bound is within', () => {
    // 49.4 / 55.4 alternating: range 49.4–55.4 displays as 49–55; 55.3 displays as 55.
    const s = seriesOf(history(D, 20, 'resting_hr', (i) => (i % 2 ? '49.4' : '55.4')), 'resting_hr');
    expect(rangeCaption(rhr, 55.3, s, D)).toMatchObject({ zone: 'within', bounds: '49–55 bpm' });
    expect(rangeCaption(rhr, 55.6, s, D)).toMatchObject({ zone: 'above' });
  });

  it('rounds sleep to whole minutes, bounds included', () => {
    const s = seriesOf(history(D, 20, 'sleep_total_s', (i) => (i % 2 ? String(6 * 3600 + 40 * 60) : String(7 * 3600 + 50 * 60))), 'sleep_total_s');
    const c = rangeCaption(sleep, 6 * 3600 + 39 * 60 + 40, s, D); // 6h 39.67m → 6h 40m
    expect(c).toMatchObject({ zone: 'within', bounds: '6h 40m–7h 50m' });
  });

  it('writes one bound when every value is the same', () => {
    const s = seriesOf(history(D, 20, 'resting_hr', () => '52'), 'resting_hr');
    expect(captionText(rangeCaption(rhr, 52, s, D))).toBe('Your range 52 bpm · in range');
  });

  it('builds the range from the loaded rows for the viewed day', () => {
    const rows = rowsOf(healthView([...history(D, 20, 'resting_hr', (i) => (i % 2 ? '49' : '55')), hr(D, { ...FULL, resting_hr: '60' })], D, false));
    expect(texts(byKey(rows, 'resting_hr'))).toEqual(['Your range 49–55 bpm · above your range']);
  });
});

describe('AC3 — today', () => {
  it('says not synced yet, with one note, when today has no row', () => {
    expect(healthView([hr('2026-09-25', FULL)], D, true)).toEqual({
      kind: 'note',
      sub: 'Not synced yet today',
      note: "Last night's sleep and heart rate, and today's steps, arrive with the next sync.",
    });
  });

  it('says when it synced, and "last night"', () => {
    const v = healthView([hr(D, FULL)], D, true);
    expect(v.sub).toBe('Synced 7:17 AM');
    expect(byKey(rowsOf(v), 'sleep').qualifier).toBe('last night');
  });

  it('shows an earlier-day sync with its date, and nothing for a blank or bad synced_at', () => {
    expect(healthView([hr(D, { ...FULL, synced_at: '2026-09-26T00:17:00.000Z' })], D, true).sub).toBe('Synced Sep 25, 6:17 PM');
    expect(healthView([hr(D, { ...FULL, synced_at: '' })], D, true).sub).toBeUndefined();
    expect(healthView([hr(D, { ...FULL, synced_at: 'soon' })], D, true).sub).toBeUndefined();
  });

  it('treats a blank as pending', () => {
    const hrv = byKey(rowsOf(healthView([hr(D, { ...FULL, hrv: '' })], D, true)), 'hrv');
    expect(hrv.value).toBe('');
    expect(texts(hrv)).toEqual(['Arrives with the next sync.']);
  });

  it('shows steps and stress so far with no range line, and the others with one', () => {
    const fields = [...DAILY_HEALTH_FIELDS, 'stress_avg'];
    const rows = rowsOf(healthView(
      [...history(D, 20, 'steps', () => '9000'), ...history(D, 20, 'resting_hr', () => '52').map((r) => ({ ...r, date: r.date })),
        hr(D, { ...FULL, steps: '871', stress_avg: '31' })],
      D, true, fields,
    ));
    const steps = byKey(rows, 'steps');
    expect(steps.value).toBe('871 so far');
    expect(texts(steps)).toEqual(['As of the 7:17 AM sync']);
    const stress = byKey(rows, 'stress');
    expect(stress.value).toBe('31 so far');
    expect(stress.captions).toEqual([]);
    expect(byKey(rows, 'resting_hr').captions.slice(-1)[0].kind).toMatch(/range|building/);
  });
});
