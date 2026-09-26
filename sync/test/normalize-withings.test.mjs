// #198 AC2/AC3: archived Withings groups -> BodyMeasurements rows.
//
// The fixture is a `getmeas` body shaped as Withings returns one (group keys,
// `algo`/`fm` on measures, a hashed device ID, `model` text, a type outside
// the column set). Every value and ID in it is a fake: this repo is public.
// It holds a Body+ scale group, a BPM Connect group, a guest (attrib 1)
// group, a malformed group (a non-integer value), and a manual winter entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MEASURE_COLUMNS, WithingsGroupError, decimalString, normalizeWithingsGroup,
  normalizeWithingsGroups, skippedNotes,
} from '../src/normalize-withings.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/withings-getmeas-2026-09-24.json', import.meta.url), 'utf8'));
const [scaleGroup, bpGroup, guestGroup, malformedGroup, manualGroup] = fixture.measuregrps;

const BLANK_MEASURES = Object.fromEntries(Object.values(MEASURE_COLUMNS).map((c) => [c, '']));

const group = (measures, extra = {}) => ({ ...scaleGroup, measures, ...extra });

test('decimalString shifts the decimal point exactly, trimming zeros, never rounding', () => {
  const cases = [
    [72345, -3, '72.345'],
    [81234, -3, '81.234'],
    [18500, -3, '18.5'],
    [81000, -3, '81'],
    [330, -2, '3.3'],
    [5, -3, '0.005'],
    [50, -3, '0.05'],
    [0, -3, '0'],
    [121, 0, '121'],
    [12, 2, '1200'],
    [123456789, -9, '0.123456789'],
    // Floating point would give 0.30000000000000004 for 0.1 + 0.2, and
    // 1.0000000000000002 style tails for large scales. A string shift cannot.
    [9007199254740991, -15, '9.007199254740991'],
    [100000000000000, -14, '1'],
  ];
  for (const [value, unit, want] of cases) assert.equal(decimalString(value, unit), want, `${value}, ${unit}`);
});

test('decimalString refuses a non-integer, unsafe or negative value, and a non-integer unit', () => {
  assert.throws(() => decimalString(81.2, -3), /value is not a non-negative integer/);
  assert.throws(() => decimalString('81234', -3), /value is not a non-negative integer/);
  assert.throws(() => decimalString(2 ** 53, -3), /value is not a non-negative integer/);
  assert.throws(() => decimalString(-5, 0), /value is not a non-negative integer/);
  assert.throws(() => decimalString(5, -1.5), /unit is not an integer/);
  assert.throws(() => decimalString(5, '-3'), /unit is not an integer/);
});

test('AC2: a scale group becomes one row with exact values, every other measure blank', () => {
  const row = normalizeWithingsGroup(scaleGroup, 'drive-file-scale');
  assert.deepEqual(row, {
    grpid: '5901234567',
    date: '2026-09-24',
    time: '06:41',
    measured_at_utc: '2026-09-24T06:41:12-06:00',
    kind: 'scale',
    device_model: 'Body+',
    ...BLANK_MEASURES,
    weight_kg: '81.234',
    fat_ratio_pct: '18.502',
    fat_mass_kg: '15.03',
    fat_free_mass_kg: '66.204',
    muscle_mass_kg: '62.9',
    hydration_kg: '45.1',
    bone_mass_kg: '3.3',
    pulse_bpm: '61',
    attrib: '0',
    source: 'withings',
    raw_ref: 'drive-file-scale',
  });
  assert.equal(row.systolic_mmhg, '');
  assert.equal(row.diastolic_mmhg, '');
  // Type 170 is not a column: ignored, not an error.
  assert.ok(!Object.values(row).includes('8'));
});

test('AC2: a BP group is kind bp, and files an evening reading under its local date', () => {
  const row = normalizeWithingsGroup(bpGroup, 'drive-file-bp');
  assert.equal(row.kind, 'bp');
  assert.equal(row.device_model, 'BPM Connect');
  // 01:02 UTC on the 24th is 19:02 MDT on the 23rd.
  assert.equal(row.date, '2026-09-23');
  assert.equal(row.time, '19:02');
  assert.equal(row.measured_at_utc, '2026-09-23T19:02:00-06:00');
  assert.equal(row.systolic_mmhg, '121');
  assert.equal(row.diastolic_mmhg, '78');
  assert.equal(row.pulse_bpm, '64');
  assert.equal(row.weight_kg, '');
  assert.equal(row.fat_ratio_pct, '');
});

test('AC2: across DST, a winter reading takes MST, and a manual entry (attrib 2) is written', () => {
  const row = normalizeWithingsGroup(manualGroup, 'drive-file-manual');
  assert.equal(row.date, '2026-01-15');
  assert.equal(row.time, '07:05');
  assert.equal(row.measured_at_utc, '2026-01-15T07:05:00-07:00');
  assert.equal(row.weight_kg, '83');
  assert.equal(row.attrib, '2');
  assert.equal(row.device_model, '', 'a null model is blank');
});

test('AC2: every written attrib is written', () => {
  for (const attrib of [0, 2, 4, 5, 7, 8]) {
    assert.equal(normalizeWithingsGroup({ ...scaleGroup, attrib }, 'r').attrib, String(attrib));
  }
});

test('AC2: kind is scale for any one scale type', () => {
  for (const type of [1, 5, 6, 8, 76, 77, 88]) {
    const row = normalizeWithingsGroup(group([{ value: 1000, type, unit: -2 }]), 'r');
    assert.equal(row.kind, 'scale');
    assert.equal(row[MEASURE_COLUMNS[type]], '10');
  }
  for (const type of [9, 10]) {
    assert.equal(normalizeWithingsGroup(group([{ value: 80, type, unit: 0 }]), 'r').kind, 'bp');
  }
});

test('AC3: an ambiguous (attrib 1) or unlisted attrib is not written', () => {
  assert.equal(normalizeWithingsGroup(guestGroup, 'r'), null);
  for (const attrib of [3, 6, 9, 99, undefined, '0']) {
    assert.equal(normalizeWithingsGroup({ ...scaleGroup, attrib }, 'r'), null, `attrib ${attrib}`);
  }
});

test('AC3: an unexpected shape fails that group, naming its grpid and type', () => {
  const cases = [
    ['a non-integer value', malformedGroup, /group 5901232000 type 1: value is not a non-negative integer/],
    ['a string value', group([{ value: '81234', type: 1, unit: -3 }]), /type 1: value is not/],
    ['a non-integer unit', group([{ value: 81234, type: 1, unit: '-3' }]), /type 1: unit is not an integer/],
    ['a missing unit', group([{ value: 81234, type: 8 }]), /type 8: unit is not an integer/],
    ['a repeated type', group([{ value: 1, type: 6, unit: 0 }, { value: 2, type: 6, unit: 0 }]),
      /type 6: type appears twice/],
    ['scale and BP together', group([{ value: 81234, type: 1, unit: -3 }, { value: 120, type: 10, unit: 0 }]),
      /both scale and blood pressure/],
    ['pulse alone', group([{ value: 61, type: 11, unit: 0 }]), /no known type besides pulse/],
    ['only unknown types', group([{ value: 8, type: 170, unit: 0 }]), /no known type besides pulse/],
    ['no measures', group(undefined), /measures is not an array/],
    ['a date that is not an epoch', group([{ value: 1, type: 1, unit: 0 }], { date: '2026-09-24' }),
      /date is not an epoch/],
    ['a grpid that is not a number', group([{ value: 1, type: 1, unit: 0 }], { grpid: 'abc' }),
      /grpid is not a whole number/],
  ];
  for (const [name, g, error] of cases) {
    assert.throws(() => normalizeWithingsGroup(g, 'r'), (err) => {
      assert.ok(err instanceof WithingsGroupError, name);
      assert.match(err.message, error, name);
      return true;
    }, name);
  }
});

test('AC3: an unknown type is ignored even when its shape is odd', () => {
  const row = normalizeWithingsGroup(group([
    { value: 81234, type: 1, unit: -3 }, { value: 'x', type: 170, unit: null }, { value: 1, type: '1', unit: 0 },
  ]), 'r');
  assert.equal(row.weight_kg, '81.234');
});

test('AC3: the batch writes the good groups, skips the guest, fails the malformed one', () => {
  const entries = fixture.measuregrps.map((g) => ({ group: g, raw_ref: `drive-${g.grpid}` }));
  const { rows, skipped, failed } = normalizeWithingsGroups(entries);
  assert.deepEqual(rows.map((r) => [r.grpid, r.kind, r.raw_ref]), [
    ['5901234567', 'scale', 'drive-5901234567'],
    ['5901234001', 'bp', 'drive-5901234001'],
    ['5801234567', 'scale', 'drive-5801234567'],
  ]);
  assert.deepEqual(skipped, [{ grpid: '5901233000', attrib: '1' }]);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].grpid, '5901232000');
  assert.equal(failed[0].type, 1);
  assert.equal(skippedNotes(skipped), 'Skipped 1 unattributed Withings group(s): grpid 5901233000 (attrib 1)');
  assert.equal(skippedNotes([]), '');
});

test('every row names all 19 row fields, in the API\'s set, and no failure quotes a value', () => {
  const FIELDS = [
    'grpid', 'date', 'time', 'measured_at_utc', 'kind', 'device_model',
    'weight_kg', 'fat_ratio_pct', 'fat_mass_kg', 'fat_free_mass_kg', 'muscle_mass_kg',
    'hydration_kg', 'bone_mass_kg', 'systolic_mmhg', 'diastolic_mmhg', 'pulse_bpm',
    'attrib', 'source', 'raw_ref',
  ];
  const row = normalizeWithingsGroup(bpGroup, 'r');
  assert.deepEqual(Object.keys(row).sort(), [...FIELDS].sort());
  const { failed } = normalizeWithingsGroups([{ group: malformedGroup, raw_ref: 'r' }]);
  assert.doesNotMatch(failed[0].reason, /81\.2/);
});

test('the normalizer is pure: the archived group is not modified', () => {
  const before = JSON.stringify(scaleGroup);
  normalizeWithingsGroup(scaleGroup, 'r');
  assert.equal(JSON.stringify(scaleGroup), before);
});
