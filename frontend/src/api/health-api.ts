// Health data (#236) — read-only. The SPA's mirror of DailyHealth,
// BodyMeasurements and DailySummary, the seam the Day view (#228) and Trends
// (#229) read through.
//
// Each field list mirrors its namesake in apps-script/src/types.js; change
// both together (CLAUDE.md). health-api.test.ts fails if they drift.
//
// Fields are strings, exactly as the sheet holds them, trimmed: '' is blank
// and '0' is a measured zero, and this layer never defaults, rounds,
// unit-converts or recomputes anything. Masses stay in kg. DailySummary is
// derived on the server and is never rebuilt or "corrected" here.
//
// Each tab is read once, whole, and ranges are selected from that copy in
// memory: the values API cannot filter by date, and one read serves every day
// the Day view swipes to and every Trends range.

import { sheetsGet, withReauth, isMissingTabError } from './sheets';
import { isDemo, demoDailyHealth, demoBodyMeasurements, demoDailySummary } from './demo-data';

export const DAILY_HEALTH_FIELDS = [
  'date',          // A  PK, local date; sleep is filed under its wake-up day
  'resting_hr',    // B
  'hrv',           // C
  'steps',         // D
  'calories',      // E
  'sleep_total_s', // F  INCLUDES awake time
  'sleep_deep_s',  // G
  'sleep_rem_s',   // H
  'sleep_light_s', // I
  'sleep_awake_s', // J
  'sleep_score',   // K
  'vo2max',        // L  current-state snapshot, only on some days
  'recovery',      // M  current-state snapshot, only on some days
  'training_load', // N
  'bed_time',      // O  local HH:mm
  'wake_time',     // P  local HH:mm
  'raw_ref',       // Q
  'synced_at',     // R
] as const;

export const BODY_MEASUREMENT_FIELDS = [
  'grpid',            // A  PK
  'date',             // B  local YYYY-MM-DD, America/Denver
  'time',             // C  local HH:mm
  'measured_at_utc',  // D  ISO 8601 with the offset then in effect
  'kind',             // E  scale | bp
  'device_model',     // F
  'weight_kg',        // G  kg, never lb
  'fat_ratio_pct',    // H
  'fat_mass_kg',      // I
  'fat_free_mass_kg', // J
  'muscle_mass_kg',   // K
  'hydration_kg',     // L
  'bone_mass_kg',     // M
  'systolic_mmhg',    // N
  'diastolic_mmhg',   // O
  'pulse_bpm',        // P
  'attrib',           // Q
  'source',           // R
  'raw_ref',          // S
  'synced_at',        // T
] as const;

export const DAILY_SUMMARY_FIELDS = [
  'date',                  // A  PK
  'activity_count',        // B
  'activity_types',        // C
  'total_moving_s',        // D  S is its coverage, out of B
  'total_elapsed_s',       // E  T is its coverage, out of B
  'total_distance_m',      // F  OUTDOOR ONLY; I is its coverage, out of H
  'total_ascent_m',        // G  OUTDOOR ONLY; J is its coverage, out of H
  'cardio_activity_count', // H  outdoor cardio
  'distance_withdata',     // I
  'ascent_withdata',       // J
  'max_effort',            // K
  'effort_counts',         // L
  'steps',                 // M  from DailyHealth
  'resting_hr',            // N
  'hrv',                   // O
  'sleep_total_s',         // P
  'training_load',         // Q
  'computed_at',           // R
  'moving_withdata',       // S
  'elapsed_withdata',      // T
  'weight_kg',             // U  the day's first scale reading with a weight
  'fat_ratio_pct',         // V  from that same reading
  'systolic_mmhg',         // W  mean of the day's BP readings, half up
  'diastolic_mmhg',        // X
  'bp_count',              // Y  BP readings (rows)
] as const;

export type DailyHealthField = typeof DAILY_HEALTH_FIELDS[number];
export type BodyMeasurementField = typeof BODY_MEASUREMENT_FIELDS[number];
export type DailySummaryField = typeof DAILY_SUMMARY_FIELDS[number];

export type DailyHealthRow = Record<DailyHealthField, string> & { sheetRow: number };
export type BodyMeasurementRow = Record<BodyMeasurementField, string> & { sheetRow: number };
export type DailySummaryRow = Record<DailySummaryField, string> & { sheetRow: number };

export const DAILY_HEALTH_SHEET = 'DailyHealth';
export const BODY_MEASUREMENTS_SHEET = 'BodyMeasurements';
export const DAILY_SUMMARY_SHEET = 'DailySummary';

/** A 1-based column number as its letter(s): 1 → A, 18 → R, 27 → AA. */
export function columnLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
}

/**
 * The read range for a tab, its last column derived from the field list, so
 * appending a column is a one-line change to the list.
 */
export function readRange(sheet: string, fields: readonly string[]): string {
  return `${sheet}!A2:${columnLetter(fields.length)}`;
}

/**
 * One sheet row by position: '' where a cell is missing (Sheets drops
 * trailing empty cells), a cell beyond the list ignored, every value trimmed
 * text and nothing else.
 */
function rowToRecord<F extends string>(
  fields: readonly F[],
  row: unknown[],
  sheetRow: number,
): Record<F, string> & { sheetRow: number } {
  const rec = { sheetRow } as Record<F, string> & { sheetRow: number };
  fields.forEach((field, i) => {
    const v = row[i];
    (rec as Record<F, string>)[field] = v === undefined || v === null ? '' : String(v).trim();
  });
  return rec;
}

export function rowToDailyHealth(row: unknown[], sheetRow: number): DailyHealthRow {
  return rowToRecord(DAILY_HEALTH_FIELDS, row, sheetRow);
}

export function rowToBodyMeasurement(row: unknown[], sheetRow: number): BodyMeasurementRow {
  return rowToRecord(BODY_MEASUREMENT_FIELDS, row, sheetRow);
}

export function rowToDailySummary(row: unknown[], sheetRow: number): DailySummaryRow {
  return rowToRecord(DAILY_SUMMARY_FIELDS, row, sheetRow);
}

/**
 * Reads a whole tab, in sheet order, dropping rows without their key. A tab
 * that does not exist yet reads as empty, the same way DailySummary's rebuild
 * treats one; any other failure is thrown.
 */
async function readTab<T>(
  token: string,
  sheet: string,
  fields: readonly string[],
  map: (row: unknown[], sheetRow: number) => T,
  hasKey: (rec: T) => boolean,
): Promise<T[]> {
  return withReauth(token, async (t) => {
    let rows: unknown[][];
    try {
      rows = await sheetsGet(readRange(sheet, fields), t);
    } catch (err) {
      if (isMissingTabError(err)) return [];
      throw err;
    }
    return rows.map((row, i) => map(row, i + 2)).filter(hasKey);
  });
}

/** Every DailyHealth row with a date, in sheet order. */
export async function fetchDailyHealth(token: string): Promise<DailyHealthRow[]> {
  if (isDemo()) return demoDailyHealth(new Date());
  return readTab(token, DAILY_HEALTH_SHEET, DAILY_HEALTH_FIELDS, rowToDailyHealth, (r) => !!r.date);
}

/** Every BodyMeasurements row with a grpid, in sheet order. */
export async function fetchBodyMeasurements(token: string): Promise<BodyMeasurementRow[]> {
  if (isDemo()) return demoBodyMeasurements(new Date());
  return readTab(token, BODY_MEASUREMENTS_SHEET, BODY_MEASUREMENT_FIELDS, rowToBodyMeasurement, (r) => !!r.grpid);
}

/** Every DailySummary row with a date, in sheet order. */
export async function fetchDailySummary(token: string): Promise<DailySummaryRow[]> {
  if (isDemo()) return demoDailySummary(new Date());
  return readTab(token, DAILY_SUMMARY_SHEET, DAILY_SUMMARY_FIELDS, rowToDailySummary, (r) => !!r.date);
}

// ── Range selection ──────────────────────────────────────────────────
//
// Pure, over rows already loaded. Sheet order is not date order after a
// backfill, so both selectors sort. A day with no row is simply absent:
// nothing is ever synthesised or zero-filled.

/**
 * The DailyHealth or DailySummary rows whose `date` is in `from`..`to`
 * (inclusive, YYYY-MM-DD), oldest first. Rows without a date are skipped.
 */
export function selectDailyRange<T extends { date: string }>(rows: readonly T[], from: string, to: string): T[] {
  return rows
    .filter((r) => r.date && r.date >= from && r.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** `measured_at_utc` as an instant, or +Infinity when it does not parse, so a bad value sorts last. */
function instant(m: BodyMeasurementRow): number {
  const t = Date.parse(m.measured_at_utc);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Every BodyMeasurements reading whose local `date` is in `from`..`to`
 * (inclusive), oldest first by `measured_at_utc` parsed as an instant, as
 * `getBodyMeasurementsRows` sorts. A day's several readings stay separate.
 * Rows without a grpid are skipped.
 */
export function selectBodyMeasurementRange(
  rows: readonly BodyMeasurementRow[],
  from: string,
  to: string,
): BodyMeasurementRow[] {
  return rows
    .filter((r) => r.grpid && r.date && r.date >= from && r.date <= to)
    .sort((a, b) => {
      const ta = instant(a);
      const tb = instant(b);
      return ta === tb ? 0 : ta < tb ? -1 : 1;
    });
}
