// Where a workout came from (#157, sync plan §8). Three states, derived from
// the sync provenance columns and nothing else — no new UI state:
//
//   manual    source == '' and no source_activity_id — logged by hand
//   synced    source != ''                           — written by a sync
//   enriched  source == '' and source_activity_id    — logged by hand, then
//                                                      filled in from COROS (§7)
//
// "Synced then edited" is not a state here: which fields a user has edited is
// recorded in the Drive archive's `normalized.edited`, not in the sheet.

import type { Workout } from './types';

export type Provenance = 'manual' | 'synced' | 'enriched';

type ProvenanceFields = Pick<Workout, 'source' | 'source_activity_id'>;

export function provenanceOf(w: ProvenanceFields): Provenance {
  if (w.source) return 'synced';
  if (w.source_activity_id) return 'enriched';
  return 'manual';
}

/**
 * A `source` value's display name, or '' when it is one this build does not
 * know. Only COROS enriches (#155), so an enriched row is always COROS.
 */
export function sourceName(source: string): string {
  switch (source) {
    case 'coros': return 'COROS';
    case 'garmin_import': return 'Garmin';
    default: return '';
  }
}

/** The card's quiet mark: "COROS", "+ COROS", or null for a manual row. */
export function provenanceMark(w: ProvenanceFields): string | null {
  switch (provenanceOf(w)) {
    case 'synced': return sourceName(w.source) || 'Synced';
    case 'enriched': return '+ COROS';
    default: return null;
  }
}

/** What the card's aria-label says about provenance; '' for a manual row. */
export function provenanceSpeech(w: ProvenanceFields): string {
  switch (provenanceOf(w)) {
    case 'synced': {
      const name = sourceName(w.source);
      return name ? `synced from ${name}` : 'synced';
    }
    case 'enriched': return 'logged by hand, enriched from COROS';
    default: return '';
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * An ISO instant as local `YYYY-MM-DD HH:mm`, the app's date and time style.
 * '' when blank or unparseable, so the caller can drop the clause.
 */
export function formatLocalStamp(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The detail screen's provenance line, or null for a manual row. On an
 * enriched row `synced_at` is when it was last enriched: a re-run with nothing
 * new writes nothing, `synced_at` included (§7).
 */
export function provenanceDetail(w: ProvenanceFields & Pick<Workout, 'synced_at'>): string | null {
  const stamp = formatLocalStamp(w.synced_at);
  switch (provenanceOf(w)) {
    case 'synced': {
      const name = sourceName(w.source);
      const lead = name ? `Synced from ${name}` : 'Synced';
      return stamp ? `${lead} · last synced ${stamp}` : lead;
    }
    case 'enriched':
      return stamp
        ? `Logged by hand · enriched from COROS ${stamp}`
        : 'Logged by hand · enriched from COROS';
    default:
      return null;
  }
}
