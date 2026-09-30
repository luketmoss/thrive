/**
 * Unit boundary for cardio attributes (#103).
 *
 * The sheet stores canonical **integer meters**; the user enters and reads
 * **miles and feet**. As with `duration.ts`, conversion happens only here.
 *
 * Empty is a first-class value: an unfilled field is not a zero one, and the
 * two must stay distinguishable in both directions. A deliberate `0` stores
 * and displays as `0`.
 */

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/** Elevation is recorded to this precision; see `feetToMeters`. */
export const ELEVATION_STEP_FT = 10;

/**
 * A sheet cell as a number: `''` (blank, nobody said) → `null`, `'0'` → `0`.
 * The one parse for stored numerics; Trends (#242) reads health cells with it.
 */
export function parse(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Distance ────────────────────────────────────────────────────────

/** Miles as typed → integer meters for storage. `''` for an empty entry. */
export function milesToMeters(miles: string): string {
  const n = parse(miles);
  return n === null ? '' : String(Math.round(n * METERS_PER_MILE));
}

/**
 * Meters as stored → miles to one decimal place, or `null` when unset.
 * One decimal is the entry granularity, so the round-trip is exact.
 */
export function metersToMiles(meters: string): number | null {
  const n = parse(meters);
  return n === null ? null : Math.round((n / METERS_PER_MILE) * 10) / 10;
}

// ── Elevation ───────────────────────────────────────────────────────

/**
 * Feet as typed → integer meters, **normalised to the nearest 10 feet first**.
 *
 * Normalising on entry rather than on display is what makes the round-trip
 * idempotent: 1495 ft stores as the metre value of 1500 ft and thereafter
 * displays as 1500, so re-saving never drifts. The cost is that the user may
 * see a number they did not type, which is why the form says so out loud.
 */
export function feetToMeters(feet: string): string {
  const n = parse(feet);
  if (n === null) return '';
  const normalised = Math.round(n / ELEVATION_STEP_FT) * ELEVATION_STEP_FT;
  return String(Math.round(normalised * METERS_PER_FOOT));
}

/** Meters as stored → whole feet, or `null` when unset. */
export function metersToFeet(meters: string): number | null {
  const n = parse(meters);
  if (n === null) return null;
  return Math.round(n / METERS_PER_FOOT / ELEVATION_STEP_FT) * ELEVATION_STEP_FT;
}

// ── Form helpers ────────────────────────────────────────────────────
// Seed an <input> without ever putting the text "null" in it.

export function metersToMilesInput(meters: string): string {
  const mi = metersToMiles(meters);
  return mi === null ? '' : String(mi);
}

export function metersToFeetInput(meters: string): string {
  const ft = metersToFeet(meters);
  return ft === null ? '' : String(ft);
}

/** Heart rate needs no conversion, only the same empty-vs-zero discipline. */
export function bpmToStored(bpm: string): string {
  const n = parse(bpm);
  return n === null ? '' : String(Math.round(n));
}

// ── Display ─────────────────────────────────────────────────────────

/** `"12.4 mi"`, or `''` when unset. */
export function formatDistance(meters: string): string {
  const mi = metersToMiles(meters);
  return mi === null ? '' : `${mi} mi`;
}

/** `"1,500 ft"`, or `''` when unset. */
export function formatElevation(meters: string): string {
  const ft = metersToFeet(meters);
  return ft === null ? '' : `${ft.toLocaleString('en-US')} ft`;
}

/** `"136 bpm"`, or `''` when unset. */
export function formatHeartRate(bpm: string): string {
  const n = parse(bpm);
  return n === null ? '' : `${Math.round(n)} bpm`;
}

// ── Body weight (#239, shared with #244) ────────────────────────────
// BodyMeasurements stores kg (CLAUDE.md); the kg → lb display is here, once.

const LB_PER_KG = 2.20462262185;

/** Stored kg → lb to 0.1, or `null` when unset. `'0'` → `0`. */
export function kgToLb(kg: string): number | null {
  const n = parse(kg);
  return n === null ? null : Math.round(n * LB_PER_KG * 10) / 10;
}

/** `"178.4 lb"`, or `''` when unset. Always one decimal. */
export function formatWeight(kg: string): string {
  const lb = kgToLb(kg);
  return lb === null ? '' : `${lb.toFixed(1)} lb`;
}
