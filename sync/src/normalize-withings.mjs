// Archived Withings measure groups (#197) -> BodyMeasurements rows (#198).
// Pure: no Drive, no network, no clock. The output is domain objects keyed by
// field name; the row layout lives in apps-script/src/types.js alone.
//
// One row per measure group, and a strict mapping:
//
// - A value is `value × 10^unit`, computed as an exact decimal string by
//   shifting the decimal point, never through floating point: `72345, -3` is
//   `72.345`. Trailing zeros are trimmed; nothing is rounded.
// - A measure type it does not know is ignored.
// - A group whose `attrib` is not one it writes (1, "ambiguous: a guest or
//   another user", or any code not listed) is skipped, not guessed at.
// - A known type with an unexpected shape fails that group only: it gets no
//   row, never one half-filled, and the failure names its grpid and type.
// - A column the group has no measure for is '', never 0.
//
// Every row names every field, because the API rewrites a row whole: a
// measure removed in a Withings edit must become blank.

import { localDateTime } from './dates.mjs';

/** Withings measure type -> BodyMeasurements column. */
export const MEASURE_COLUMNS = {
  1: 'weight_kg',
  6: 'fat_ratio_pct',
  8: 'fat_mass_kg',
  5: 'fat_free_mass_kg',
  76: 'muscle_mass_kg',
  77: 'hydration_kg',
  88: 'bone_mass_kg',
  10: 'systolic_mmhg',
  9: 'diastolic_mmhg',
  11: 'pulse_bpm', // the cuff's pulse, or the scale's standing heart rate
};

export const SCALE_TYPES = [1, 5, 6, 8, 76, 77, 88];
export const BP_TYPES = [9, 10];

/**
 * The `attrib` codes written, from Withings' published meanings:
 * 0 captured by a device and known to be this user's; 2 entered manually;
 * 4 entered manually at sign-up; 5 the BPM's computed best value; 7 confirmed
 * by the user; 8 as 0. Code 1 is ambiguous (a guest, or another user) and is
 * skipped, as is any code not listed here.
 */
export const WRITTEN_ATTRIBS = [0, 2, 4, 5, 7, 8];

/** A group this normalizer will not map. Names the grpid, and the type if one is to blame. */
export class WithingsGroupError extends Error {
  constructor(grpid, type, reason) {
    super(`group ${grpid}${type === undefined ? '' : ` type ${type}`}: ${reason}`);
    this.name = 'WithingsGroupError';
    this.grpid = String(grpid);
    this.type = type;
  }
}

/**
 * `value × 10^unit` as an exact decimal string. Both must be integers, and
 * `value` a safe, non-negative one: a number past 2^53 has already lost
 * digits in JSON.parse, and no body measure is negative.
 */
export function decimalString(value, unit) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('value is not a non-negative integer');
  if (!Number.isInteger(unit)) throw new Error('unit is not an integer');
  let digits = String(value);
  if (value === 0) return '0';
  if (unit >= 0) return digits + '0'.repeat(unit);
  const k = -unit;
  if (digits.length <= k) digits = '0'.repeat(k - digits.length + 1) + digits;
  const whole = digits.slice(0, digits.length - k);
  const frac = digits.slice(digits.length - k).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const isGrpid = (g) => (Number.isSafeInteger(g) && g >= 0) || (typeof g === 'string' && /^\d+$/.test(g));

/**
 * One archived group -> one BodyMeasurements row, or `null` when its attrib
 * says it is not to be written. Throws WithingsGroupError for a malformed one.
 *
 * @param {object} group  the group as Withings returned it (the archive's `payload`)
 * @param {string} rawRef  the Drive file ID of its archive file
 * @returns {object | null}
 */
export function normalizeWithingsGroup(group, rawRef) {
  const grpid = group?.grpid;
  if (!isGrpid(grpid)) throw new WithingsGroupError(grpid, undefined, 'grpid is not a whole number');
  if (!WRITTEN_ATTRIBS.includes(group.attrib)) return null;
  if (!Number.isSafeInteger(group.date) || group.date < 0) {
    throw new WithingsGroupError(grpid, undefined, 'date is not an epoch in whole seconds');
  }
  if (!Array.isArray(group.measures)) throw new WithingsGroupError(grpid, undefined, 'measures is not an array');

  const values = {};
  for (const m of group.measures) {
    const type = m?.type;
    const column = MEASURE_COLUMNS[type];
    if (!Number.isInteger(type) || !column) continue; // a type it does not know is ignored
    if (column in values) throw new WithingsGroupError(grpid, type, 'type appears twice in the group');
    try {
      values[column] = decimalString(m.value, m.unit);
    } catch (err) {
      throw new WithingsGroupError(grpid, type, err.message);
    }
  }

  const types = group.measures.map((m) => m?.type);
  const isScale = types.some((t) => SCALE_TYPES.includes(t));
  const isBp = types.some((t) => BP_TYPES.includes(t));
  if (isScale && isBp) throw new WithingsGroupError(grpid, undefined, 'group carries both scale and blood pressure types');
  if (!isScale && !isBp) throw new WithingsGroupError(grpid, undefined, 'group has no known type besides pulse');

  const { date, time, iso } = localDateTime(group.date * 1000);
  const row = {
    grpid: String(grpid),
    date,
    time,
    measured_at_utc: iso,
    kind: isBp ? 'bp' : 'scale',
    device_model: typeof group.model === 'string' ? group.model : '',
  };
  for (const column of Object.values(MEASURE_COLUMNS)) row[column] = values[column] ?? '';
  row.attrib = String(group.attrib);
  row.source = 'withings';
  row.raw_ref = String(rawRef);
  return row;
}

/**
 * Every archived group -> rows, with the skipped and failed kept apart. A
 * skip is not a failure; a failure costs its own group only.
 *
 * @param {{ group: object, raw_ref: string }[]} entries  archived groups only
 * @returns {{ rows: object[], skipped: { grpid: string, attrib: string }[],
 *   failed: { grpid: string, type: number | undefined, reason: string }[] }}
 */
export function normalizeWithingsGroups(entries) {
  const rows = [];
  const skipped = [];
  const failed = [];
  for (const { group, raw_ref: rawRef } of entries) {
    try {
      const row = normalizeWithingsGroup(group, rawRef);
      if (row) rows.push(row);
      else skipped.push({ grpid: String(group.grpid), attrib: String(group.attrib) });
    } catch (err) {
      if (!(err instanceof WithingsGroupError)) throw err;
      failed.push({ grpid: err.grpid, type: err.type, reason: err.message });
    }
  }
  return { rows, skipped, failed };
}

/** The run's notes for skipped groups: `grpid 123 (attrib 1), …`, or '' when none. */
export const skippedNotes = (skipped) =>
  skipped.length
    ? `Skipped ${skipped.length} unattributed Withings group(s): ` +
      skipped.map((s) => `grpid ${s.grpid} (attrib ${s.attrib})`).join(', ')
    : '';
