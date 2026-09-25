// The run's sheet step (#165): after the archive has landed, normalize from it
// and write to the sheet through the Thrive API, then rebuild the rollup once.
//
// Order matters (#165 AC5, #166 AC5): `rebuildDailySummary` runs exactly
// once, after every sheet write in the run — DailyHealth, then the window's
// activities (#166).

import { parseHealthBundle } from './normalize-health.mjs';
import { redact } from './redact.mjs';
import { syncActivities } from './sync-activities.mjs';

/**
 * Parse the run date's archived health bundle and upsert its rows.
 *
 * A date whose text the parser does not recognize is not written; the others
 * are (AC3). The archive is only ever read here, never written.
 *
 * @returns {Promise<{ rows: number, appended: number, updated: number, failures: string[] }>}
 */
export async function syncDailyHealth({ archive, api, runDate, syncedAt, log = console.log }) {
  const result = { rows: 0, appended: 0, updated: 0, failures: [] };
  const bundle = await archive.readHealth(runDate);
  if (!bundle) {
    result.failures.push(`health ${runDate}: no bundle in the archive, so DailyHealth was not updated`);
    log(`  FAILED ${result.failures[0]}`);
    return result;
  }

  const { rows, failures } = parseHealthBundle(bundle.data, { rawRef: bundle.fileId });
  for (const f of failures) {
    // Names the date, the tool and the line, so the fix to the parser is obvious.
    const message = `health ${f.date}: not written, unrecognized format in ${f.message}`;
    result.failures.push(message);
    log(`  FAILED ${message}`);
  }

  if (rows.length) {
    const { appended, updated, batches } = await api.upsertDailyHealth(rows, syncedAt);
    Object.assign(result, { rows: rows.length, appended, updated });
    log(`  DailyHealth: ${rows.length} dates (${appended} appended, ${updated} updated) in ${batches} batch(es), from ${bundle.fileId}`);
  } else {
    log('  DailyHealth: no date in the window carried health data');
  }
  return result;
}

/**
 * Every sheet write of a run, then the rollup, once, over D − 10 to D.
 *
 * A failed write is recorded, not thrown, so the rollup still recomputes the
 * dates that did land. The rollup itself failing is recorded the same way.
 *
 * @param {{ archive: object, api: object, window: { start: string, runDate: string },
 *   activityIds?: string[], syncedAt: string, log?: (line: string) => void }} opts
 *   `activityIds` is every activity the run's list named (ingest's summary).
 *   `fit` is the run's FIT step (src/fit.mjs, #154), or null for none.
 * @returns {Promise<{ health: object | null, activities: object | null,
 *   rollup: object | null, failures: string[] }>}
 */
export async function writeSheet({ archive, api, window, activityIds = [], syncedAt, fit = null, log = console.log }) {
  const out = { health: null, activities: null, rollup: null, failures: [] };

  try {
    out.health = await syncDailyHealth({ archive, api, runDate: window.runDate, syncedAt, log });
    out.failures.push(...out.health.failures);
  } catch (err) {
    const message = `DailyHealth: ${redact(err.message || String(err))}`;
    out.failures.push(message);
    log(`  FAILED ${message}`);
  }

  try {
    out.activities = await syncActivities({ archive, api, activityIds, syncedAt, fit, log });
    out.failures.push(...out.activities.failures);
    const a = out.activities;
    log(`  Workouts: ${a.created} created, ${a.updated} updated, ${a.unchanged} unchanged, ${a.deleted} deleted in Thrive and left so, ${a.skipped} skipped`);
  } catch (err) {
    const message = `Workouts: ${redact(err.message || String(err))}`;
    out.failures.push(message);
    log(`  FAILED ${message}`);
  }

  try {
    out.rollup = await api.rebuildDailySummary(window.start, window.runDate, syncedAt);
    const r = out.rollup ?? {};
    log(`  DailySummary ${window.start} to ${window.runDate}: ${r.written ?? 0} written, ${r.updated ?? 0} updated, ${r.removed ?? 0} removed`);
  } catch (err) {
    const message = `DailySummary rebuild: ${redact(err.message || String(err))}`;
    out.failures.push(message);
    log(`  FAILED ${message}`);
  }

  return out;
}
