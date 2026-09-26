// #201 — narration for thrive_body_measurements. Pure; run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeReading, describeBodyRange } from './body.js';

const FIELDS = [
  'grpid', 'date', 'time', 'measured_at_utc', 'kind', 'device_model',
  'weight_kg', 'fat_ratio_pct', 'fat_mass_kg', 'fat_free_mass_kg', 'muscle_mass_kg',
  'hydration_kg', 'bone_mass_kg', 'systolic_mmhg', 'diastolic_mmhg', 'pulse_bpm',
  'attrib', 'source', 'raw_ref', 'synced_at',
];
const reading = (o) => Object.fromEntries(FIELDS.map((f) => [f, o[f] ?? '']));

const scale = reading({
  grpid: '1001', date: '2026-09-24', time: '06:42', kind: 'scale', device_model: 'Body+',
  weight_kg: '72.3', fat_ratio_pct: '21.4', fat_mass_kg: '15.5', fat_free_mass_kg: '56.8',
  muscle_mass_kg: '55.1', hydration_kg: '45.1', bone_mass_kg: '3.3', pulse_bpm: '61',
  attrib: '0', source: 'withings',
});

const bp = reading({
  grpid: '1002', date: '2026-09-24', time: '07:05', kind: 'bp', device_model: 'BPM Connect',
  systolic_mmhg: '118', diastolic_mmhg: '76', pulse_bpm: '64', attrib: '5', source: 'withings',
});

test('a scale reading names every measure in kg and lb', () => {
  assert.equal(
    describeReading(scale),
    '06:42 scale: 72.3 kg (159.4 lb), fat 21.4 %, fat mass 15.5 kg (34.2 lb), ' +
      'fat-free 56.8 kg (125.2 lb), muscle 55.1 kg (121.5 lb), hydration 45.1 kg (99.4 lb), ' +
      'bone 3.3 kg (7.3 lb), pulse 61 bpm',
  );
});

test('a bp reading names systolic/diastolic and pulse', () => {
  assert.equal(describeReading(bp), '07:05 bp: 118/76 mmHg, pulse 64 bpm');
});

test('a blank measure shows as —, never 0, for both kinds', () => {
  const sparse = reading({ date: '2026-09-20', time: '06:00', kind: 'scale', weight_kg: '80' });
  const line = describeReading(sparse);
  assert.match(line, /80 kg \(176\.4 lb\)/);
  assert.match(line, /fat —,/);
  assert.match(line, /pulse —$/);
  assert.doesNotMatch(line.replace('80', ''), /\b0\b/);

  const sparseBp = reading({ date: '2026-09-20', time: '06:00', kind: 'bp' });
  assert.equal(describeReading(sparseBp), '06:00 bp: —, pulse —');
});

test('a bp reading with only one of systolic/diastolic shows — rather than a half pair', () => {
  const half = reading({ date: '2026-09-20', time: '06:00', kind: 'bp', systolic_mmhg: '118' });
  assert.equal(describeReading(half), '06:00 bp: —, pulse —');
});

test('describeBodyRange groups readings by local date, oldest first', () => {
  const text = describeBodyRange([scale, bp], { from: '2026-09-01', to: '2026-09-30' });
  assert.match(text, /^Body measurements, 2026-09-01 to 2026-09-30: 2 readings\./);
  assert.match(text, /- 2026-09-24:\n {2}06:42 scale:.*\n {2}07:05 bp:/);
});

test('describeBodyRange names the kind when filtered', () => {
  const text = describeBodyRange([scale], { from: '2026-09-01', to: '2026-09-30' }, 'scale');
  assert.match(text, /1 scale readings\./);
});

test('an empty range says so rather than printing nothing', () => {
  const text = describeBodyRange([], { from: '2026-09-01', to: '2026-09-30' });
  assert.match(text, /0 readings\./);
  assert.match(text, /No readings in this range\./);
});

test('an empty range names the filtered kind', () => {
  const text = describeBodyRange([], { from: '2026-09-01', to: '2026-09-30' }, 'bp');
  assert.match(text, /No bp readings in this range\./);
});
