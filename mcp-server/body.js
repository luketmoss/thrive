// Narration for thrive_body_measurements (#201): BodyMeasurements readings
// grouped by local date.
//
// Pure. Rows arrive from api.js as domain objects keyed by field name, oldest
// first by measured_at_utc; nothing here knows a column. Every measure field
// is nullable, and a blank is shown as "—" rather than dropped or printed as
// 0 — the same rule daily.js follows for DailyHealth and DailySummary. Mass
// is shown in kg and lb, through domain.js's one kgToLb boundary.

import { kgToLb } from './domain.js';
import { BLANK } from './daily.js';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/** "72.3" -> "72.3 kg (159.4 lb)"; blank -> "—". */
function mass(kg) {
  if (isBlank(kg)) return BLANK;
  return `${kg} kg (${kgToLb(kg)} lb)`;
}

/** `value` with a unit, or "—" when blank. */
const withUnit = (v, unit) => (isBlank(v) ? BLANK : `${v}${unit}`);

/** One scale reading -> one line, e.g. "06:42 scale: 72.3 kg (159.4 lb), fat 21.4 %, ...". */
function describeScaleReading(m) {
  return [
    `${m.time} scale:`, mass(m.weight_kg) + ',',
    `fat ${withUnit(m.fat_ratio_pct, ' %')},`,
    `fat mass ${mass(m.fat_mass_kg)},`,
    `fat-free ${mass(m.fat_free_mass_kg)},`,
    `muscle ${mass(m.muscle_mass_kg)},`,
    `hydration ${mass(m.hydration_kg)},`,
    `bone ${mass(m.bone_mass_kg)},`,
    `pulse ${withUnit(m.pulse_bpm, ' bpm')}`,
  ].join(' ');
}

/** One blood-pressure reading -> one line, e.g. "07:05 bp: 118/76 mmHg, pulse 64 bpm". */
function describeBpReading(m) {
  const bp = isBlank(m.systolic_mmhg) || isBlank(m.diastolic_mmhg)
    ? BLANK
    : `${m.systolic_mmhg}/${m.diastolic_mmhg} mmHg`;
  return `${m.time} bp: ${bp}, pulse ${withUnit(m.pulse_bpm, ' bpm')}`;
}

/** One BodyMeasurements reading -> one line, dispatched on `kind`. */
export function describeReading(m) {
  return m.kind === 'bp' ? describeBpReading(m) : describeScaleReading(m);
}

/** The thrive_body_measurements response: readings grouped by local date. */
export function describeBodyRange(rows, { from, to }, kind) {
  const scope = kind ? `${kind} readings` : 'readings';
  const out = [`Body measurements, ${from} to ${to}: ${rows.length} ${scope}.`];
  if (!rows.length) {
    out.push(`No ${kind ? `${kind} ` : ''}readings in this range.`);
    return out.join('\n');
  }
  out.push('"—" means Withings did not report that value for that reading; it is unknown, never zero.');

  const byDate = new Map();
  for (const m of rows) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  out.push('');
  for (const [date, readings] of byDate) {
    out.push(`- ${date}:`);
    for (const m of readings) out.push(`  ${describeReading(m)}`);
  }
  return out.join('\n');
}
